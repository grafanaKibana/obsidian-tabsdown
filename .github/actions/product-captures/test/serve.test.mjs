import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

test('static capture server starts from a checkout path containing spaces and stops cleanly', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture server '));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let process;
  try {
    await cp(new URL('../serve.mjs', import.meta.url), path.join(directory, 'serve.mjs'));
    await writeFile(path.join(directory, 'index.html'), 'Portable preview');
    process = spawn(globalThis.process.execPath, [path.join(directory, 'serve.mjs'), '--dir', directory, '--port', String(port)], { stdio:['ignore','pipe','pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
      process.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      process.once('exit', code => { clearTimeout(timeout); reject(new Error(`Early exit ${code}`)); });
    });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'Portable preview');
  } finally {
    if (process && process.exitCode === null) {
      process.kill('SIGTERM');
      await new Promise(resolve => process.once('exit', resolve));
    }
    await rm(directory, { recursive:true, force:true });
  }
});
