#!/usr/bin/env node
'use strict';
const { buildUI, TABS } = require('./ui');
const sd = require('./systemd');
const proc = require('./proc');
const { LogStream } = require('./logs');
const { isRoot } = require('./exec');
const R = require('./render');
const { esc } = require('./util');

if (process.platform !== 'linux') {
  console.error('svcman работает только в Linux с systemd.');
  process.exit(1);
}

const FILTERS = [
  { id: 'all', label: 'все', test: () => true },
  { id: 'active', label: 'активные', test: (s) => s.active === 'active' },
  { id: 'failed', label: 'упавшие', test: (s) => s.active === 'failed' || s.sub === 'failed' },
  { id: 'inactive', label: 'неактивные', test: (s) => s.active === 'inactive' },
];

const ui = buildUI();
const { screen, header, list, content, status, buttons, tabButtons, question, searchBox } = ui;

const state = {
  all: [],            // все службы
  view: [],           // после фильтра/поиска
  selected: null,     // имя выбранной службы
  search: '',
  filterIdx: 0,
  tab: 'overview',
  show: null,
  stats: null,
  prevSnap: null,
  logs: [],           // строки журнала
  logStream: null,
  follow: true,
  unitText: '',
  busy: false,
  modal: false,       // открыто окно поиска/подтверждения: хоткеи отключены
};

let statusTimer = null;
function setStatus(msg, color = 'white', ms = 4000) {
  status.setContent(` {${color}-fg}${msg}{/}`);
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => { status.setContent(''); screen.render(); }, ms);
  screen.render();
}

function renderHeader() {
  const f = FILTERS[state.filterIdx];
  const failed = state.all.filter((s) => s.active === 'failed' || s.sub === 'failed').length;
  const running = state.all.filter((s) => s.sub === 'running').length;
  header.setContent(
    ` {bold}svcman{/bold} │ служб: ${state.all.length} │ работает: ${running} │ упало: ${failed}` +
    ` │ фильтр: ${f.label}${state.search ? ` │ поиск: "${esc(state.search)}"` : ''}` +
    (isRoot ? '' : ' │ {yellow-fg}не root: управление через sudo{/}')
  );
}

function renderTabs() {
  for (const t of TABS) {
    const on = t.id === state.tab;
    tabButtons[t.id].style = on ? { bg: 'cyan', fg: 'black', bold: true } : { bg: 'black', fg: 'white' };
  }
  buttons.follow.style.bg = state.follow ? 'magenta' : 'gray';
}

// ---------- Список служб ----------
function applyView() {
  const f = FILTERS[state.filterIdx];
  const q = state.search.toLowerCase();
  state.view = state.all.filter((s) => f.test(s) && (!q || s.unit.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)));
  const width = list.width - 4;
  list.setItems(state.view.map((s) => R.listRow(s, width)));
  let idx = state.view.findIndex((s) => s.unit === state.selected);
  if (idx < 0 && state.view.length) {
    idx = 0;
    selectUnit(state.view[0].unit);
  }
  if (idx >= 0) list.select(idx);
  list.setLabel(` Службы (${state.view.length}) `);
  renderHeader();
  screen.render();
}

async function refreshList() {
  try {
    state.all = await sd.listServices();
    applyView();
  } catch (e) {
    setStatus('Ошибка: ' + esc(e.message), 'red', 0);
  }
}

// ---------- Выбор службы и детали ----------
let selTimer = null;
function selectUnit(unit) {
  if (unit === state.selected && state.show) return;
  state.selected = unit;
  state.show = null;
  state.stats = null;
  state.prevSnap = null;
  state.unitText = '';
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    refreshDetails();
    if (state.tab === 'logs') startLogs();
    if (state.tab === 'unit') loadUnitText();
  }, 120);
  if (state.tab === 'logs') stopLogs();
  drawContent();
}

async function refreshDetails() {
  const unit = state.selected;
  if (!unit) return;
  const show = await sd.showService(unit);
  if (unit !== state.selected) return; // выбор изменился, пока ждали
  const sockets = await proc.listeningSockets();
  if (unit !== state.selected) return;
  const stats = proc.collectStats(show, sockets, state.prevSnap);
  state.prevSnap = stats.snapshot;
  state.show = show;
  state.stats = stats;
  if (state.tab === 'overview') drawContent();
}

// ---------- Логи ----------
let logTimer = null;
function scheduleLogDraw() {
  if (logTimer) return;
  logTimer = setTimeout(() => {
    logTimer = null;
    if (state.tab === 'logs') drawContent();
  }, 100);
}

function stopLogs() {
  if (state.logStream) state.logStream.stop();
  state.logStream = null;
}

function startLogs() {
  stopLogs();
  state.logs = [];
  if (!state.selected) return;
  const unit = state.selected;
  state.logStream = new LogStream(
    unit,
    { lines: 400, follow: true },
    (line) => {
      if (unit !== state.selected) return;
      state.logs.push(line);
      if (state.logs.length > 3000) state.logs.splice(0, state.logs.length - 3000);
      scheduleLogDraw();
    },
    (msg) => {
      if (msg) state.logs.push('{yellow-fg}' + esc(msg) + '{/}');
      scheduleLogDraw();
    }
  );
  drawContent();
}

async function loadUnitText() {
  const unit = state.selected;
  const text = await sd.catUnit(unit);
  if (unit !== state.selected) return;
  state.unitText = text;
  if (state.tab === 'unit') drawContent();
}

// ---------- Отрисовка правой панели ----------
function drawContent() {
  renderTabs();
  const w = content.width - 3;
  if (!state.selected) {
    content.setContent('{gray-fg}Нет выбранной службы{/}');
  } else if (state.tab === 'overview') {
    content.setContent(R.overview(state.show, state.stats, w));
  } else if (state.tab === 'logs') {
    const body = state.logs.length ? state.logs.map(R.logLine).join('\n') : '{gray-fg}Журнал пуст или загружается…{/}';
    content.setContent(body);
    if (state.follow) content.setScrollPerc(100);
  } else {
    content.setContent(state.unitText ? esc(state.unitText) : '{gray-fg}Загрузка…{/}');
  }
  content.setLabel(` ${state.selected ? esc(state.selected) : ''} `);
  screen.render();
}

function setTab(id) {
  if (state.tab === id) return;
  state.tab = id;
  content.scrollTo(0);
  if (id === 'logs') startLogs();
  else stopLogs();
  if (id === 'unit') loadUnitText();
  if (id === 'overview') refreshDetails();
  drawContent();
}

// ---------- Действия ----------
function confirm(text) {
  state.modal = true;
  return new Promise((resolve) =>
    question.ask(text, (err, ok) => {
      state.modal = false;
      resolve(!err && ok);
    })
  );
}

async function act(action) {
  const unit = state.selected;
  if (!unit || state.busy) return;
  const titles = { start: 'запуск', stop: 'остановка', restart: 'перезапуск', enable: 'включение автозапуска', disable: 'отключение автозапуска' };
  if (['stop', 'restart', 'disable'].includes(action)) {
    list.focus();
    if (!(await confirm(`${titles[action]} службы\n{bold}${esc(unit)}{/bold}?`))) return;
  }
  state.busy = true;
  setStatus(`⏳ ${titles[action]} ${esc(unit)}…`, 'yellow', 0);
  try {
    await sd.serviceAction(unit, action);
    setStatus(`✔ ${titles[action]}: ${esc(unit)}`, 'green');
  } catch (e) {
    setStatus('✖ ' + esc(e.message.split('\n')[0]), 'red', 8000);
  }
  state.busy = false;
  list.focus();
  await refreshList();
  state.prevSnap = null;
  await refreshDetails();
}

function toggleEnable() {
  const cur = state.view.find((s) => s.unit === state.selected);
  if (!cur) return;
  act(cur.enabled === 'enabled' ? 'disable' : 'enable');
}

// Поиск реализован без blessed-prompt: поле не зависит от фокуса, поэтому обновления и
// посторонние события терминала не могут его закрыть. Закрывается только Enter / Esc.
let searchOld = '';
function drawSearch() {
  searchBox.setContent(` Поиск: ${esc(state.search)}█   {bold}Enter{/bold} — оставить, {bold}Esc{/bold} — отмена, Ctrl+U — очистить`);
  screen.render();
}

function openSearch() {
  if (state.modal) return;
  state.modal = true;
  searchOld = state.search;
  screen.lockKeys = true; // экран и списки больше не обрабатывают клавиши (Ctrl+C остаётся)
  searchBox.show();
  drawSearch();
}

function closeSearch(keep) {
  if (!state.modal) return;
  if (!keep) state.search = searchOld;
  state.modal = false;
  screen.lockKeys = false;
  searchBox.hide();
  list.focus();
  applyView();
}

screen.program.on('keypress', (ch, key) => {
  if (!state.modal || !screen.lockKeys) return; // только когда открыт поиск
  key = key || {};
  if (key.name === 'enter' || key.name === 'return') return closeSearch(true);
  if (key.name === 'escape') return closeSearch(false);
  if (key.name === 'backspace') state.search = state.search.slice(0, -1);
  else if (key.full === 'C-u') state.search = '';
  else if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ' && ch !== '\x7f') state.search += ch;
  else return;
  applyView(); // фильтр применяется по мере набора
  drawSearch();
});

function cycleFilter() {
  state.filterIdx = (state.filterIdx + 1) % FILTERS.length;
  applyView();
}

function toggleFollow() {
  state.follow = !state.follow;
  setStatus(state.follow ? 'Автопрокрутка журнала включена' : 'Автопрокрутка выключена', 'cyan', 2000);
  drawContent();
}

function quit() {
  stopLogs();
  screen.destroy();
  process.exit(0);
}

// ---------- Привязки ----------
// Хоткеи не должны срабатывать, пока пользователь печатает в окне поиска/подтверждения.
function hotkey(keys, fn) {
  screen.key(keys, (...args) => {
    if (state.modal) return;
    fn(...args);
  });
}

list.on('select item', (_item, idx) => {
  const s = state.view[idx];
  if (s) selectUnit(s.unit);
});

for (const t of TABS) {
  tabButtons[t.id].on('click', () => setTab(t.id));
  hotkey(t.key, () => setTab(t.id));
}

const handlers = {
  start: () => act('start'),
  stop: () => act('stop'),
  restart: () => act('restart'),
  enable: toggleEnable,
  search: openSearch,
  filter: cycleFilter,
  follow: toggleFollow,
  quit,
};
for (const [id, fn] of Object.entries(handlers)) buttons[id].on('click', () => { if (!state.modal) fn(); });

hotkey(['s'], handlers.start);
hotkey(['x'], handlers.stop);
hotkey(['r'], handlers.restart);
hotkey(['e'], handlers.enable);
hotkey(['/'], handlers.search);
hotkey(['f'], handlers.filter);
hotkey(['w'], handlers.follow);
hotkey(['l'], () => setTab('logs'));
hotkey(['q'], quit);
screen.key(['C-c'], quit);
hotkey(['tab'], () => {
  const i = TABS.findIndex((t) => t.id === state.tab);
  setTab(TABS[(i + 1) % TABS.length].id);
});
hotkey(['pageup'], () => { state.follow = false; renderTabs(); content.scroll(-(content.height >> 1)); screen.render(); });
hotkey(['pagedown'], () => { content.scroll(content.height >> 1); screen.render(); });
hotkey(['g'], () => { state.follow = false; content.scrollTo(0); screen.render(); });
hotkey(['S-g'], () => { content.setScrollPerc(100); screen.render(); });
hotkey(['escape'], () => { if (state.search) { state.search = ''; applyView(); } });
screen.on('resize', () => { applyView(); drawContent(); });

// Колёсико вверх в журнале отключает автопрокрутку
content.on('wheelup', () => { if (state.tab === 'logs' && state.follow) { state.follow = false; renderTabs(); } });

// ---------- Старт ----------
list.focus();
renderTabs();
setStatus('Клик мышью — выбор, колёсико — прокрутка. Подсказка внизу: кнопки кликабельны.', 'gray', 6000);
refreshList();
setInterval(refreshList, 4000);
setInterval(() => { if (state.tab === 'overview') refreshDetails(); }, 1500);
