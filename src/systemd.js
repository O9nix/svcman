'use strict';
const { run, runPrivileged } = require('./exec');

/**
 * Разбор вывода `systemctl list-units --type=service --all --plain --no-legend`.
 * Строка: UNIT LOAD ACTIVE SUB DESCRIPTION...
 */
function parseListUnits(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[●○×*\s]+/, '').trimEnd();
    if (!line) continue;
    const m = line.match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    out.push({ unit: m[1], load: m[2], active: m[3], sub: m[4], description: m[5] || '' });
  }
  return out;
}

/** Разбор вывода `systemctl list-unit-files --type=service`: UNIT STATE [PRESET]. */
function parseUnitFiles(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(/^(\S+\.service)\s+(\S+)/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Разбор вывода `systemctl show` (KEY=VALUE построчно). */
function parseShow(text) {
  const props = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) props[line.slice(0, i)] = line.slice(i + 1);
  }
  return props;
}

async function listServices() {
  const [units, files] = await Promise.all([
    run('systemctl', ['list-units', '--type=service', '--all', '--plain', '--no-legend', '--no-pager']),
    run('systemctl', ['list-unit-files', '--type=service', '--plain', '--no-legend', '--no-pager']),
  ]);
  if (units.code !== 0 && !units.stdout) {
    throw new Error(units.stderr.trim() || 'systemctl недоступен (это не systemd-система?)');
  }
  const list = parseListUnits(units.stdout);
  const states = parseUnitFiles(files.stdout);
  const seen = new Set(list.map((s) => s.unit));
  // Добавляем установленные, но не загруженные юниты (inactive, не в list-units)
  for (const [unit, state] of states) {
    if (!seen.has(unit) && !unit.endsWith('@.service')) {
      list.push({ unit, load: 'not-loaded', active: 'inactive', sub: 'dead', description: '' });
    }
  }
  for (const s of list) s.enabled = states.get(s.unit) || '—';
  list.sort((a, b) => a.unit.localeCompare(b.unit));
  return list;
}

const SHOW_PROPS = [
  'Id', 'Description', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'FragmentPath',
  'MainPID', 'ControlGroup', 'ExecStart', 'ExecMainStartTimestampMonotonic', 'ActiveEnterTimestamp',
  'MemoryCurrent', 'CPUUsageNSec', 'TasksCurrent', 'User', 'Result', 'NRestarts',
];

async function showService(unit) {
  const r = await run('systemctl', ['show', unit, '--no-pager', '-p', SHOW_PROPS.join(',')]);
  return parseShow(r.stdout);
}

async function serviceAction(unit, action) {
  const allowed = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!allowed.includes(action)) throw new Error('Неизвестное действие: ' + action);
  const r = await runPrivileged('systemctl', [action, unit, '--no-pager'], { timeout: 60000 });
  if (r.code !== 0) {
    let msg = (r.stderr || r.stdout).trim() || `код ${r.code}`;
    if (/sudo: a password is required|a terminal is required/.test(msg)) {
      msg = 'Нужны права root. Запустите svcman через sudo или настройте sudo без пароля.';
    }
    throw new Error(msg);
  }
  return true;
}

/** Статус (`systemctl status`) без цветов — для вкладки «Информация». */
async function statusText(unit) {
  const r = await run('systemctl', ['status', unit, '--no-pager', '-l', '--lines=0']);
  return r.stdout || r.stderr;
}

/** Содержимое unit-файла (`systemctl cat`). */
async function catUnit(unit) {
  const r = await run('systemctl', ['cat', unit, '--no-pager']);
  return r.stdout || r.stderr;
}

module.exports = {
  parseListUnits, parseUnitFiles, parseShow,
  listServices, showService, serviceAction, statusText, catUnit,
};
