'use strict';

function fmtBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1)) + units[i];
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(n >= 100 ? 0 : 1) + '%';
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}д ${h}ч`;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s}с`;
  return `${s}с`;
}

function truncate(str, width) {
  str = String(str);
  if (width <= 0) return '';
  if (str.length <= width) return str;
  return width > 1 ? str.slice(0, width - 1) + '…' : str.slice(0, width);
}

function pad(str, width) {
  str = truncate(str, width);
  return str + ' '.repeat(Math.max(0, width - str.length));
}

/** Экранирует теги blessed ({...}) в произвольном тексте. */
function esc(str) {
  return String(str).replace(/[{}]/g, (c) => (c === '{' ? '{open}' : '{close}'));
}

/** Убирает ANSI/управляющие последовательности из вывода (journalctl, ss). */
function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

module.exports = { fmtBytes, fmtPct, fmtDuration, truncate, pad, esc, stripAnsi };
