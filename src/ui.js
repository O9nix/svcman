'use strict';
const blessed = require('neo-blessed');

const TABS = [
  { id: 'overview', key: '1', label: ' 1 Обзор ' },
  { id: 'logs', key: '2', label: ' 2 Логи ' },
  { id: 'unit', key: '3', label: ' 3 Unit-файл ' },
];

const BUTTONS = [
  { id: 'start', label: ' s Старт ', bg: 'green' },
  { id: 'stop', label: ' x Стоп ', bg: 'red' },
  { id: 'restart', label: ' r Рестарт ', bg: 'yellow' },
  { id: 'enable', label: ' e Автозапуск ', bg: 'blue' },
  { id: 'search', label: ' / Поиск ', bg: 'cyan' },
  { id: 'filter', label: ' f Фильтр ', bg: 'cyan' },
  { id: 'follow', label: ' w Следить ', bg: 'magenta' },
  { id: 'quit', label: ' q Выход ', bg: 'gray' },
];

function buildUI() {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'svcman',
    dockBorders: true,
  });

  const header = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: 1,
    tags: true, style: { fg: 'white', bg: 'blue' },
  });

  const list = blessed.list({
    parent: screen, top: 1, left: 0, width: '42%', bottom: 2,
    label: ' Службы ', border: 'line', tags: true,
    keys: true, vi: true, mouse: true, scrollable: true,
    scrollbar: { ch: ' ', style: { bg: 'cyan' }, track: { bg: 'black' } },
    style: {
      border: { fg: 'cyan' },
      selected: { bg: 'white', fg: 'black', bold: true },
      item: { fg: 'white' },
    },
  });

  const tabBar = blessed.box({
    parent: screen, top: 1, left: '42%', width: '58%', height: 1, tags: true,
  });
  const tabButtons = {};
  let left = 0;
  for (const t of TABS) {
    tabButtons[t.id] = blessed.box({
      parent: tabBar, top: 0, left, height: 1, width: t.label.length,
      content: t.label, mouse: true, tags: true,
    });
    left += t.label.length + 1;
  }

  const content = blessed.box({
    parent: screen, top: 2, left: '42%', width: '58%', bottom: 2,
    border: 'line', tags: true, mouse: true, keys: true, vi: true,
    scrollable: true, alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'cyan' }, track: { bg: 'black' } },
    style: { border: { fg: 'cyan' } },
  });

  const status = blessed.box({
    parent: screen, bottom: 1, left: 0, width: '100%', height: 1, tags: true,
    style: { fg: 'white' },
  });

  const bar = blessed.box({
    parent: screen, bottom: 0, left: 0, width: '100%', height: 1, style: { bg: 'black' },
  });
  const buttons = {};
  left = 0;
  for (const b of BUTTONS) {
    buttons[b.id] = blessed.box({
      parent: bar, top: 0, left, height: 1, width: b.label.length,
      content: b.label, mouse: true,
      style: { bg: b.bg, fg: 'black', hover: { bg: 'white' } },
    });
    left += b.label.length + 1;
  }

  const question = blessed.question({
    parent: screen, border: 'line', height: 'shrink', width: 'half',
    top: 'center', left: 'center', label: ' Подтверждение ', tags: true, keys: true, mouse: true,
    style: { border: { fg: 'yellow' } },
  });

  const prompt = blessed.prompt({
    parent: screen, border: 'line', height: 'shrink', width: 'half',
    top: 'center', left: 'center', label: ' Поиск ', tags: true, keys: true, mouse: true,
    style: { border: { fg: 'cyan' } },
  });

  return { screen, header, list, tabButtons, content, status, buttons, question, prompt };
}

module.exports = { buildUI, TABS, BUTTONS };
