'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const Moxley = require('..');

const evidence = process.env.MOXLEY_CLOSE_EVIDENCE_ROOT;
const root = fs.mkdtempSync(path.join(evidence || os.tmpdir(), 'moxley-close-'));
let sequence = 0;
const instances = new WeakMap();
function close(db) { return instances.get(db).close(); }
function database() {
  const dir = path.join(root, String(sequence++));
  const moxley = new Moxley(dir + path.sep);
  instances.set(moxley.db, moxley);
  return { dir, moxley, db: moxley.db };
}
function bytes(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel)).sort().flatMap(name => {
    const next = path.join(rel, name);
    return fs.statSync(path.join(dir, next)).isDirectory()
      ? bytes(dir, next) : [{ name: next, hex: fs.readFileSync(path.join(dir, next)).toString('hex') }];
  });
}
const closed = error => error.code === 'MOXLEY_CLOSED';
const busy = error => error.code === 'MOXLEY_BUSY';
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('construct then close and repeated close resolve without changing files', async () => {
  const { dir, db } = database();
  const before = bytes(dir);
  assert.equal(await close(db), undefined);
  assert.equal(await close(db), undefined);
  assert.deepEqual(bytes(dir), before);
});

test('awaited load followed by close preserves all populated persistent bytes', async () => {
  const { dir, db } = database();
  db._set({ payload: { n: 1, text: 'é東京' } });
  db._create('child')._set({ value: 2 });
  db._createCollection('items')._saveState();
  await db._loadFromDir();
  const before = bytes(dir);
  await close(db);
  assert.deepEqual(bytes(dir), before);
  assert.equal(before.some(f => /lifecycle|closed|publish.*tmp/.test(f.name)), false);
});

test('pending root load refuses close deterministically and keeps instance open', async () => {
  const { db } = database();
  const gate = deferred();
  const load = db._loadState;
  db._loadState = async function (...args) { await gate.promise; return load.apply(this, args); };
  const loading = db._loadFromDir();
  await assert.rejects(close(db), busy);
  assert.equal(db._id, '0');
  gate.resolve();
  await loading;
  delete db._loadState;
  await close(db);
});

test('pending descendant load belongs to the same root activity count', { timeout: 5000 }, async () => {
  const seeded = database();
  seeded.db._create('child');
  const loadingOwner = new Moxley(seeded.dir + path.sep);
  const db = loadingOwner.db;
  instances.set(db, loadingOwner);
  const gate = deferred();
  const requested = deferred();
  const load = db._loadState;
  const rootLocation = path.resolve(db._loc);
  db._loadState = async function (location) {
    if (path.resolve(location) !== rootLocation) { requested.resolve(); await gate.promise; }
    return load.call(this, location);
  };
  const loading = db._loadFromDir();
  await requested.promise;
  await assert.rejects(close(db), busy);
  gate.resolve();
  await loading;
  delete db._loadState;
  await close(db);
});

test('a direct child load also refuses root close until settled', async () => {
  const { db } = database();
  const child = db._create('child');
  const loading = child._loadFromDir();
  await assert.rejects(close(db), busy);
  await loading;
  await close(db);
});

test('collection constructor metadata work cannot race successful close', async () => {
  const { db } = database();
  db._createCollection('items')._saveState();
  const collection = db._createCollection('items');
  await assert.rejects(close(db), busy);
  // An awaited explicit metadata load also drains the earlier constructor load.
  await collection._loadState();
  await close(db);
});

test('CSV lifecycle work stays busy through its returned promise', async () => {
  const { dir, db } = database();
  const csv = path.join(root, 'input.csv');
  fs.writeFileSync(csv, 'name,value\r\nfirst,1');
  const loading = db._loadFromCSV(csv);
  await assert.rejects(close(db), busy);
  await loading;
  assert.ok(fs.readdirSync(dir).includes('0'));
  await close(db);
});

test('reentrant close during a synchronous query is refused while busy', async () => {
  const { db } = database();
  db._create('child');
  let closing;
  db._query(() => { closing = close(db); return true; });
  await assert.rejects(closing, busy);
  await close(db);
});

for (const [name, operation] of [
  ['direct assignment', db => { db.payload = 2; }],
  ['set', db => db._set({ payload: 2 })],
  ['create', db => db._create('later')],
  ['store', db => db._store({ payload: 2 })],
  ['create collection', db => db._createCollection('later')],
  ['lazy read', db => db.payload],
  ['snapshot', db => db._getSnapshot()],
  ['query', db => db._query(() => true)],
  ['metadata save', db => db._saveState()],
  ['template mutation', db => db._createTemplate({ keys: {} })],
  ['defineProperty', db => Object.defineProperty(db, 'later', { value: 2 })],
  ['deleteProperty', db => { delete db.payload; }],
  ['own keys', db => Object.keys(db)],
  ['membership', db => 'payload' in db],
]) {
  test(`${name} after close is refused without changing persistent bytes`, async () => {
    const { dir, db } = database();
    db._set({ payload: 1 });
    const before = bytes(dir);
    await close(db);
    assert.throws(() => operation(db), closed);
    assert.deepEqual(bytes(dir), before);
  });
}

test('retained synchronous and asynchronous methods cannot bypass closed root', async () => {
  const { db } = database();
  const set = db._set.bind(db);
  const load = db._loadFromDir.bind(db);
  const raw = db._root;
  const rawSave = raw._saveState.bind(raw);
  const closeOwner = instances.get(db).close.bind(instances.get(db));
  await closeOwner();
  assert.throws(() => set({ later: 1 }), closed);
  assert.throws(rawSave, closed);
  await assert.rejects(load(), closed);
  await closeOwner();
});

test('retained child and collection operations share root invalidation', async () => {
  const { db } = database();
  const child = db._create('child');
  const collection = db._createCollection('items');
  collection._add(child);
  const add = collection._add.bind(collection);
  const load = collection._loadState.bind(collection);
  await close(db);
  assert.throws(() => child._set({ later: 1 }), closed);
  assert.throws(() => child.data, closed);
  assert.throws(() => collection._queryItems(() => true), closed);
  assert.throws(() => add(child), closed);
  await assert.rejects(load(), closed);
});

test('closing the facade invalidates nested descendants of the owning database', async () => {
  const { db } = database();
  const child = db._create('child');
  await close(db);
  assert.throws(() => db.payload, closed);
  await close(db);
});

test('a new instance reopens independently with exact root and child content', async () => {
  const { dir, db } = database();
  const value = { n: 42, nested: [true, null, 'text'] };
  db._set({ payload: value });
  db._create('child')._set({ value: 'child' });
  const before = bytes(dir);
  await close(db);
  const reopenedOwner = new Moxley(dir + path.sep);
  const reopened = reopenedOwner.db;
  await reopened._loadFromDir();
  assert.deepEqual(reopened.payload, value);
  assert.equal(reopened.child.value, 'child');
  assert.deepEqual(bytes(dir), before);
  await reopenedOwner.close();
});

test('a different live instance remains open when another instance closes', async () => {
  const { dir, db } = database();
  db._set({ payload: 7 });
  const otherOwner = new Moxley(dir + path.sep);
  const other = otherOwner.db;
  await other._loadFromDir();
  await close(db);
  assert.equal(other.payload, 7);
  await otherOwner.close();
});

test('the additive facade API preserves a user value named close and the old object shape', async () => {
  const { dir, moxley, db } = database();
  assert.deepEqual(Object.keys(moxley), ['db']);
  db._set({ close: { value: 'user data' } });
  assert.deepEqual(db.close, { value: 'user data' });
  await moxley.close();
  const reopened = new Moxley(dir + path.sep);
  await reopened.db._loadFromDir();
  assert.deepEqual(reopened.db.close, { value: 'user data' });
  await reopened.close();
});

test('failed load and repeated close preserve exact original cause and invalidate', async () => {
  const { dir, db } = database();
  const original = fs.readFileSync;
  const cause = new Error('original lifecycle read error');
  fs.readFileSync = (file, ...args) => {
    if (file === dir + path.sep + '_state.ms') throw cause;
    return original(file, ...args);
  };
  try { await assert.rejects(db._loadFromDir(), e => e === cause); }
  finally { fs.readFileSync = original; }
  await assert.rejects(close(db), e => e === cause);
  await assert.rejects(close(db), e => e === cause);
  assert.throws(() => db.payload, closed);
});

test('detached collection load failure is retained by close without unhandled rejection', async () => {
  const { dir, db } = database();
  db._createCollection('items')._saveState();
  const original = fs.readFileSync;
  const cause = new Error('original collection read error');
  fs.readFileSync = (file, ...args) => {
    if (file === dir + path.sep + 'items/_colstate.mc') throw cause;
    return original(file, ...args);
  };
  let collection;
  try { collection = db._createCollection('items'); }
  finally { fs.readFileSync = original; }
  await collection._loadState();
  await assert.rejects(close(db), e => e === cause);
});

test('synchronous persistence error preserves its cause and does not fake a lifecycle failure', async () => {
  const { db } = database();
  const original = fs.renameSync;
  const cause = new Error('original publication error');
  fs.renameSync = () => { throw cause; };
  try { assert.throws(() => db._set({ payload: 1 }), e => e === cause); }
  finally { fs.renameSync = original; }
  await close(db);
});

test('closed worker exits naturally and reopens persisted content in a fresh process', () => {
  const { dir, db } = database();
  db._set({ payload: { answer: 42 } });
  const code = `const M=require(process.argv[1]);(async()=>{const m=new M(process.argv[2]);await m.db._loadFromDir();const value=m.db.payload;await m.close();console.log(JSON.stringify({value,handles:process._getActiveHandles().map(x=>x.constructor.name)}));})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const result = spawnSync(process.execPath, ['-e', code, path.resolve(__dirname, '..'), dir + path.sep], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { value: { answer: 42 }, handles: [] });
});
