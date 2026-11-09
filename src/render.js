'use strict';
const { fmtBytes, fmtPct, fmtDuration, truncate, pad, esc } = require('./util');

function stateColor(active, sub) {
  if (active === 'failed' || sub === 'failed') return 'red-fg';
  if (active === 'active') return 'green-fg';
  if (active === 'activating' || active === 'deactivating' || active === 'reloading') return 'yellow-fg';
  return 'gray-fg';
}

function stateIcon(active) {
  if (active === 'active') return '●';
  if (active === 'failed') return '✖';
  if (active === 'activating' || active === 'deactivating' || active === 'reloading') return '◐';
  return '○';
}

function bar(frac, width) {
  frac = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  const filled = Math.round(frac * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Строка списка служб. */
function listRow(s, width) {
  const color = stateColor(s.active, s.sub);
  const icon = stateIcon(s.active);
  const name = pad(s.unit.replace(/\.service$/, ''), Math.max(10, width - 25));
  const sub = pad(s.sub, 9);
  const en = pad(s.enabled, 9);
  return `{${color}}${icon}{/} ${esc(name)} {${color}}${esc(sub)}{/} {gray-fg}${esc(en)}{/}`;
}

/** Вкладка «Обзор»: состояние, ресурсы, процессы, порты. */
function overview(show, stats, width) {
  if (!show) return '{gray-fg}Загрузка…{/}';
  const L = [];
  const color = stateColor(show.ActiveState, show.SubState);
  L.push(`{bold}${esc(show.Id || '')}{/bold}  {${color}}${stateIcon(show.ActiveState)} ${esc(show.ActiveState)} (${esc(show.SubState)}){/}`);
  if (show.Description) L.push(`{gray-fg}${esc(show.Description)}{/}`);
  L.push('');

  const since = show.ActiveEnterTimestamp ? Date.parse(show.ActiveEnterTimestamp.replace(/^\w+\s/, '').replace(/\s[A-Z]{2,5}$/, '')) : NaN;
  const uptime = show.ActiveState === 'active' && Number.isFinite(since) ? fmtDuration((Date.now() - since) / 1000) : '—';
  const kv = (k, v) => L.push(`{cyan-fg}${pad(k, 14)}{/}${v}`);
  kv('Автозапуск', esc(show.UnitFileState || '—'));
  kv('Unit-файл', esc(show.FragmentPath || '—'));
  kv('Пользователь', esc(show.User || 'root'));
  kv('Main PID', Number(show.MainPID) > 0 ? show.MainPID : '—');
  kv('Работает', uptime);
  if (show.NRestarts && show.NRestarts !== '0') kv('Перезапусков', show.NRestarts);
  if (show.Result && show.Result !== 'success') kv('Результат', `{red-fg}${esc(show.Result)}{/}`);
  if (show.ExecStart) {
    const m = show.ExecStart.match(/path=([^;]+);/);
    const argv = show.ExecStart.match(/argv\[\]=([^;]+);/);
    kv('ExecStart', esc(truncate(argv ? argv[1].trim() : m ? m[1].trim() : show.ExecStart, width - 16)));
  }
  L.push('');

  L.push('{bold}Ресурсы{/bold}');
  if (!stats) {
    L.push('{gray-fg}  нет данных{/}');
  } else {
    const barW = Math.max(8, Math.min(24, width - 40));
    const cpuFrac = stats.cpu !== null ? stats.cpu / 100 / Math.max(1, require('os').cpus().length) : 0;
    L.push(`  CPU     ${bar(cpuFrac, barW)} ${pad(fmtPct(stats.cpu), 7)} {gray-fg}(100% = 1 ядро){/}`);
    const memFrac = stats.memory && stats.totalMem ? stats.memory / stats.totalMem : 0;
    L.push(`  Память  ${bar(memFrac, barW)} ${pad(fmtBytes(stats.memory), 7)} {gray-fg}RSS процессов: ${fmtBytes(stats.rss)}{/}`);
    L.push(`  Задач   ${stats.tasks}   Процессов: ${stats.procs.length}`);
  }
  L.push('');

  L.push(`{bold}Открытые порты{/bold} {gray-fg}(слушающие){/}`);
  if (!stats || !stats.ports.length) {
    L.push('{gray-fg}  нет (или недостаточно прав для просмотра чужих сокетов){/}');
  } else {
    for (const p of stats.ports) {
      L.push(`  {green-fg}${pad(p.proto, 4)}{/} ${pad(p.addr, 24)} {bold}${p.port}{/bold}`);
    }
  }
  L.push('');

  L.push('{bold}Процессы{/bold} {gray-fg}(что запущено){/}');
  if (!stats || !stats.procs.length) {
    L.push('{gray-fg}  процессов нет{/}');
  } else {
    L.push(`{gray-fg}  ${pad('PID', 8)}${pad('ПАМЯТЬ', 8)}${pad('ПОТОКОВ', 8)}КОМАНДА{/}`);
    for (const p of stats.procs) {
      L.push(`  ${pad(String(p.pid), 8)}${pad(fmtBytes(p.rss), 8)}${pad(String(p.threads), 8)}${esc(truncate(p.cmdline, Math.max(10, width - 28)))}`);
    }
  }
  return L.join('\n');
}

/** Подсветка строки журнала по уровню. */
function logLine(line) {
  const t = esc(line);
  if (/\b(error|failed|fatal|panic|critical)\b/i.test(line)) return `{red-fg}${t}{/}`;
  if (/\b(warn|warning)\b/i.test(line)) return `{yellow-fg}${t}{/}`;
  return t;
}

module.exports = { stateColor, stateIcon, listRow, overview, logLine };
