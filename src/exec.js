'use strict';
const { execFile } = require('child_process');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * Запускает команду и возвращает { code, stdout, stderr }. Никогда не отклоняет промис.
 */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout || 8000, maxBuffer: opts.maxBuffer || 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', SYSTEMD_COLORS: '0' } },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || (err && !stdout ? err.message : '')),
        });
      }
    );
  });
}

/**
 * Команда с повышением привилегий (для start/stop/restart): root -> напрямую, иначе sudo -n.
 */
function runPrivileged(cmd, args = [], opts = {}) {
  if (isRoot) return run(cmd, args, opts);
  return run('sudo', ['-n', cmd, ...args], opts);
}

module.exports = { run, runPrivileged, isRoot };
