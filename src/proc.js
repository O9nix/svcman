'use strict';
const fs = require('fs');
const os = require('os');
const { run } = require('./exec');

const CLK_TCK = 100; // стандартное значение на Linux
const PAGE_SIZE = 4096;

function readFile(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** PID'ы всех процессов службы из её cgroup (рекурсивно по подгруппам). */
function cgroupPids(controlGroup) {
  if (!controlGroup) return [];
  const base = '/sys/fs/cgroup' + controlGroup;
  const pids = new Set();
  const walk = (dir, depth) => {
    const txt = readFile(dir + '/cgroup.procs');
    if (txt) for (const l of txt.split('\n')) if (/^\d+$/.test(l)) pids.add(Number(l));
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(dir + '/' + e.name, depth + 1);
  };
  walk(base, 0);
  return [...pids].sort((a, b) => a - b);
}

/** Разбор /proc/<pid>/stat: учитываем, что comm может содержать пробелы и скобки. */
function parseStat(text) {
  const end = text.lastIndexOf(')');
  const start = text.indexOf('(');
  if (end < 0 || start < 0) return null;
  const comm = text.slice(start + 1, end);
  const f = text.slice(end + 2).split(' ');
  // f[0] = state (поле 3), поле N => f[N-3]
  return {
    comm,
    state: f[0],
    ppid: Number(f[1]),
    utime: Number(f[11]),
    stime: Number(f[12]),
    threads: Number(f[17]),
    rssPages: Number(f[21]),
  };
}

function processInfo(pid) {
  const stat = readFile(`/proc/${pid}/stat`);
  if (!stat) return null;
  const st = parseStat(stat);
  if (!st) return null;
  let cmdline = (readFile(`/proc/${pid}/cmdline`) || '').split('\0').filter(Boolean).join(' ');
  if (!cmdline) cmdline = `[${st.comm}]`;
  let exe = '';
  try {
    exe = fs.readlinkSync(`/proc/${pid}/exe`);
  } catch {
    /* нет прав или поток ядра */
  }
  let fds = null;
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    /* нет прав */
  }
  return {
    pid,
    ppid: st.ppid,
    name: st.comm,
    state: st.state,
    threads: st.threads,
    rss: st.rssPages * PAGE_SIZE,
    cpuTicks: st.utime + st.stime,
    cmdline,
    exe,
    fds,
  };
}

/**
 * Разбор `ss -H -tulnp`. Колонки: Netid State Recv-Q Send-Q Local:Port Peer:Port [Process]
 * Process: users:(("nginx",pid=123,fd=6),("nginx",pid=124,fd=6))
 */
function parseSs(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 5) continue;
    const proto = parts[0];
    const local = parts[4];
    const idx = local.lastIndexOf(':');
    if (idx < 0) continue;
    const addr = local.slice(0, idx).replace(/^\[|\]$/g, '');
    const port = Number(local.slice(idx + 1));
    if (!Number.isFinite(port)) continue;
    const pids = [];
    const re = /pid=(\d+)/g;
    let m;
    while ((m = re.exec(t))) pids.push(Number(m[1]));
    rows.push({ proto, state: parts[1], addr, port, pids });
  }
  return rows;
}

async function listeningSockets() {
  const r = await run('ss', ['-H', '-tulnp']);
  return parseSs(r.stdout);
}

/**
 * Собирает всё о ресурсах службы. `prev` — предыдущий снимок для расчёта CPU%.
 * show — результат showService().
 */
function collectStats(show, sockets, prev) {
  const now = Date.now();
  const pids = cgroupPids(show.ControlGroup);
  if (!pids.length && Number(show.MainPID) > 0) pids.push(Number(show.MainPID));
  const procs = pids.map(processInfo).filter(Boolean);

  const rssSum = procs.reduce((a, p) => a + p.rss, 0);
  const ticks = procs.reduce((a, p) => a + p.cpuTicks, 0);
  const cpuNs = show.CPUUsageNSec && /^\d+$/.test(show.CPUUsageNSec) ? Number(show.CPUUsageNSec) : null;
  const mem = show.MemoryCurrent && /^\d+$/.test(show.MemoryCurrent) ? Number(show.MemoryCurrent) : null;

  // CPU% (100% = одно ядро). Предпочитаем счётчик cgroup, иначе сумма тиков процессов.
  let cpu = null;
  if (prev && prev.unit === show.Id) {
    const dt = (now - prev.t) / 1000;
    if (dt > 0.2) {
      if (cpuNs !== null && prev.cpuNs !== null) cpu = ((cpuNs - prev.cpuNs) / 1e9 / dt) * 100;
      else cpu = ((ticks - prev.ticks) / CLK_TCK / dt) * 100;
      if (cpu < 0) cpu = 0;
    }
  }

  const pidSet = new Set(pids);
  const ports = sockets
    .filter((s) => s.pids.some((p) => pidSet.has(p)))
    .map((s) => ({ proto: s.proto, addr: s.addr, port: s.port }));
  const seen = new Set();
  const uniquePorts = ports.filter((p) => {
    const k = `${p.proto}/${p.addr}/${p.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniquePorts.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));

  return {
    snapshot: { unit: show.Id, t: now, cpuNs, ticks },
    cpu,
    memory: mem !== null ? mem : rssSum || null,
    rss: rssSum,
    tasks: show.TasksCurrent && /^\d+$/.test(show.TasksCurrent) ? Number(show.TasksCurrent) : procs.reduce((a, p) => a + p.threads, 0),
    procs,
    ports: uniquePorts,
    totalMem: os.totalmem(),
  };
}

module.exports = { cgroupPids, parseStat, processInfo, parseSs, listeningSockets, collectStats };
