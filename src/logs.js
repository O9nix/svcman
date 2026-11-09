'use strict';
const { spawn } = require('child_process');
const { isRoot } = require('./exec');
const { stripAnsi } = require('./util');

/**
 * Читает журнал службы через journalctl. Сначала последние `lines` строк, затем (follow) новые.
 * onLine(str) вызывается для каждой строки; onEnd(msg?) — когда процесс завершился.
 */
class LogStream {
  constructor(unit, { lines = 300, follow = true, priority = null } = {}, onLine, onEnd) {
    this.unit = unit;
    this.onLine = onLine;
    this.onEnd = onEnd || (() => {});
    this.buf = '';
    this.err = '';
    this.stopped = false;

    const args = ['-u', unit, '-n', String(lines), '--no-pager', '-o', 'short-iso'];
    if (priority) args.push('-p', priority);
    if (follow) args.push('-f');
    this.proc = spawn('journalctl', args, { env: { ...process.env, LC_ALL: 'C', SYSTEMD_COLORS: '0' } });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!this.stopped) this.onLine(stripAnsi(line));
      }
    });
    this.proc.stderr.on('data', (c) => (this.err += c));
    this.proc.on('error', (e) => {
      if (!this.stopped) this.onEnd(e.code === 'ENOENT' ? 'journalctl не найден' : e.message);
    });
    this.proc.on('close', () => {
      if (this.stopped) return;
      let msg = this.err.trim();
      if (!isRoot && /not seeing messages|No journal files|permission/i.test(msg)) {
        msg += '\nПодсказка: добавьте пользователя в группу systemd-journal или запустите через sudo.';
      }
      this.onEnd(msg || null);
    });
  }

  stop() {
    this.stopped = true;
    try {
      this.proc.kill('SIGTERM');
    } catch {
      /* уже завершён */
    }
  }
}

module.exports = { LogStream };
