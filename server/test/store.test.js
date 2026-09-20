import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, isSafeKey } from '../store.js';
import { JsonFileStore } from '../store-file.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'agrav-store-'));

test('store: a record survives a restart, and reads come back from disk', async () => {
  const dir = await tmp();
  const a = new JsonFileStore(dir);
  a.set('rally', 'KEY_ONE', { money: 500, car: 'vagabond' });
  assert.deepEqual(await a.get('rally', 'KEY_ONE'), { money: 500, car: 'vagabond' }, 'readable before the disk write lands');
  await a.flush();
  a.close();

  const b = new JsonFileStore(dir);           // a fresh process: nothing cached
  assert.deepEqual(await b.get('rally', 'KEY_ONE'), { money: 500, car: 'vagabond' });
  assert.equal(await b.get('rally', 'MISSING'), null);
  assert.deepEqual(await b.list('rally'), ['KEY_ONE']);
  b.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: the newest value wins and no temp files are left behind', async () => {
  const dir = await tmp();
  const s = new JsonFileStore(dir);
  for (let i = 1; i <= 20; i++) s.set('rally', 'KEY', { money: i });
  await s.flush();
  assert.deepEqual(await s.get('rally', 'KEY'), { money: 20 });
  const names = await fs.readdir(path.join(dir, 'rally'));
  assert.deepEqual(names, ['KEY.json'], 'the rename is atomic: only the record itself remains');
  s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: keys are path segments, so anything else is refused', async () => {
  assert.ok(isSafeKey('aZ0_-'));
  for (const bad of ['../escape', 'a/b', '', 'x'.repeat(129), 'sp ace', null, 42]) assert.ok(!isSafeKey(bad), `${bad} is not a key`);
  const dir = await tmp();
  const s = new JsonFileStore(dir);
  s.set('rally', '../../etc/passwd', { pwned: true });
  assert.equal(await s.get('rally', '../../etc/passwd'), null);
  await s.flush();
  assert.deepEqual(await fs.readdir(dir), [], 'nothing was written at all');
  s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: a disk that cannot be written is logged, not thrown', async () => {
  const dir = await tmp();
  await fs.writeFile(path.join(dir, 'rally'), 'a file where the namespace directory should be');
  const s = new JsonFileStore(dir);
  s.set('rally', 'KEY', { money: 1 });
  await s.flush();                                   // the mkdir fails; flush still resolves
  assert.deepEqual(await s.get('rally', 'KEY'), { money: 1 }, 'the cache still answers');
  assert.deepEqual(await s.list('rally'), [], 'and a listing of the broken namespace is empty, not a throw');
  s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: idle records are dropped from the cache, live ones are not', async () => {
  const dir = await tmp();
  const s = new JsonFileStore(dir);
  s.set('rally', 'OLD', { money: 1 });
  s.set('rally', 'NEW', { money: 2 });
  await s.flush();
  s.cache.get('rally/OLD').at = Date.now() - 2 * 60 * 60 * 1000;
  s.sweep();
  assert.ok(!s.cache.has('rally/OLD'));
  assert.ok(s.cache.has('rally/NEW'));
  assert.deepEqual(await s.get('rally', 'OLD'), { money: 1 }, 'and it is still on disk');
  s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: the memory store honours the same contract', async () => {
  const s = new MemoryStore();
  s.set('rally', 'KEY', { money: 3 });
  assert.deepEqual(await s.get('rally', 'KEY'), { money: 3 });
  assert.deepEqual(await s.list('rally'), ['KEY']);
  assert.equal(await s.get('rally', 'NOPE'), null);
});
