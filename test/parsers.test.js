'use strict';
const assert = require('assert');
const sd = require('../src/systemd');
const proc = require('../src/proc');
const { fmtBytes, truncate, pad, esc, stripAnsi } = require('../src/util');
const R = require('../src/render');

// list-units
const units = sd.parseListUnits(
  [
    'ssh.service                loaded active   running OpenBSD Secure Shell server',
    '● foo.service              loaded failed   failed  Broken thing',
    'systemd-fsck@dev-sda1.service loaded inactive dead File System Check',
    '',
  ].join('\n')
);
assert.strictEqual(units.length, 3);
assert.deepStrictEqual(units[0], { unit: 'ssh.service', load: 'loaded', active: 'active', sub: 'running', description: 'OpenBSD Secure Shell server' });
assert.strictEqual(units[1].active, 'failed');
assert.strictEqual(units[2].unit, 'systemd-fsck@dev-sda1.service');

// list-unit-files
const files = sd.parseUnitFiles('ssh.service enabled enabled\nfoo.service disabled enabled\n');
assert.strictEqual(files.get('ssh.service'), 'enabled');
assert.strictEqual(files.get('foo.service'), 'disabled');

// show
const show = sd.parseShow('Id=ssh.service\nMainPID=812\nExecStart={ path=/usr/sbin/sshd ; argv[]=/usr/sbin/sshd -D ; }\n');
assert.strictEqual(show.MainPID, '812');
assert.ok(show.ExecStart.includes('argv[]=/usr/sbin/sshd -D'));

// /proc/pid/stat с пробелами и скобками в имени
const st = proc.parseStat('812 (my (odd) name) S 1 812 812 0 -1 4194560 100 0 0 0 150 50 0 0 20 0 3 0 12345 1000000 777 18446744073709551615');
assert.strictEqual(st.comm, 'my (odd) name');
assert.strictEqual(st.state, 'S');
assert.strictEqual(st.ppid, 1);
assert.strictEqual(st.utime, 150);
assert.strictEqual(st.stime, 50);
assert.strictEqual(st.threads, 3);
assert.strictEqual(st.rssPages, 777);

// ss
const ss = proc.parseSs(
  [
    'tcp   LISTEN 0 128 0.0.0.0:22   0.0.0.0:*  users:(("sshd",pid=812,fd=3))',
    'tcp   LISTEN 0 128 [::]:22      [::]:*     users:(("sshd",pid=812,fd=4))',
    'udp   UNCONN 0 0   127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=500,fd=13))',
    'tcp   LISTEN 0 511 *:80  *:* users:(("nginx",pid=900,fd=6),("nginx",pid=901,fd=6))',
    'tcp   LISTEN 0 4096 127.0.0.1:631 0.0.0.0:*',
  ].join('\n')
);
assert.strictEqual(ss.length, 5);
assert.deepStrictEqual(ss[0], { proto: 'tcp', state: 'LISTEN', addr: '0.0.0.0', port: 22, pids: [812] });
assert.strictEqual(ss[1].addr, '::');
assert.deepStrictEqual(ss[3].pids, [900, 901]);
assert.deepStrictEqual(ss[4].pids, []);

// collectStats: сопоставление портов по PID (используем собственный процесс)
const fakeShow = { Id: 'test.service', ControlGroup: '/nonexistent', MainPID: String(process.pid), MemoryCurrent: '1048576', CPUUsageNSec: '1000000000', TasksCurrent: '2' };
const sockets = [{ proto: 'tcp', state: 'LISTEN', addr: '0.0.0.0', port: 8080, pids: [process.pid] }, { proto: 'tcp', state: 'LISTEN', addr: '0.0.0.0', port: 9, pids: [1] }];
const s1 = proc.collectStats(fakeShow, sockets, null);
assert.strictEqual(s1.ports.length, 1);
assert.strictEqual(s1.ports[0].port, 8080);
assert.strictEqual(s1.memory, 1048576);
assert.strictEqual(s1.procs.length, 1);
assert.strictEqual(s1.cpu, null); // нет предыдущего снимка
const prev = { ...s1.snapshot, t: Date.now() - 1000, cpuNs: 1000000000 }; // +0.5с CPU за 1с => ~50%
const s2 = proc.collectStats({ ...fakeShow, CPUUsageNSec: '1500000000' }, sockets, prev);
assert.ok(s2.cpu > 40 && s2.cpu < 60, 'cpu% ~50, получено ' + s2.cpu);

// util
assert.strictEqual(fmtBytes(1536), '1.5K');
assert.strictEqual(fmtBytes(null), '—');
assert.strictEqual(truncate('abcdef', 4), 'abc…');
assert.strictEqual(pad('ab', 4), 'ab  ');
assert.strictEqual(esc('a{b}'), 'a{open}b{close}');
assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m'), 'red');

// render
assert.ok(R.listRow(units[0], 40).includes('ssh'));
assert.ok(R.overview({ Id: 'x.service', ActiveState: 'active', SubState: 'running', MainPID: '1' }, s1, 80).includes('Открытые порты'));

console.log('Все тесты пройдены');
