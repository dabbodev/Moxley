'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const Moxley = require('..');

const CLEANUP_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;

function withTimeout(promise, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function createRepeatedLoadScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-repeated-load-'),
  );

  t.after(async () => {
    await withTimeout(
      rm(testDirectory, { recursive: true, force: true, maxRetries: 3 }),
      'temporary directory cleanup',
      CLEANUP_TIMEOUT_MS,
    );
  });

  const databaseDirectory = path.join(testDirectory, 'database');
  const databasePath = `${databaseDirectory}${path.sep}`;
  const seeded = new Moxley(databasePath);
  seeded.db._create('descendant');

  const reopened = new Moxley(databasePath);
  return {
    databaseDirectory,
    root: reopened.db,
  };
}

test(
  'calling _loadFromDir twice appends another reconstructed child',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { root } = await createRepeatedLoadScenario(t);

    const firstResult = await root._loadFromDir();
    const firstSnapshot = [...root._children];
    const firstChild = firstSnapshot[0];

    assert.strictEqual(firstResult, root);
    assert.equal(firstSnapshot.length, 1);
    assert.equal(firstChild._id, '0/0');

    const secondResult = await root._loadFromDir();
    const secondSnapshot = [...root._children];
    const appendedChild = secondSnapshot[1];

    assert.strictEqual(secondResult, root);
    assert.equal(secondSnapshot.length, 2);
    assert.strictEqual(secondSnapshot[0], firstChild);
    assert.notStrictEqual(appendedChild, firstChild);
    assert.equal(firstChild._id, '0/0');
    assert.equal(appendedChild._id, '0/1');
  },
);

test(
  'repeated _loadFromDir keeps named lookup on the first child while creating a new directory',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root } =
      await createRepeatedLoadScenario(t);

    await root._loadFromDir();
    const firstChild = root._children[0];
    const firstNamedLookup = root.descendant;
    const firstEntries = (await readdir(databaseDirectory)).sort();
    const secondDirectory = path.join(databaseDirectory, '1');

    assert.strictEqual(firstNamedLookup, firstChild);
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );

    await root._loadFromDir();
    const appendedChild = root._children[1];
    const secondEntries = (await readdir(databaseDirectory)).sort();
    const firstEntrySet = new Set(firstEntries);
    const secondEntrySet = new Set(secondEntries);
    const removedEntries = firstEntries.filter(
      (entry) => !secondEntrySet.has(entry),
    );
    const addedEntries = secondEntries.filter(
      (entry) => !firstEntrySet.has(entry),
    );

    assert.equal((await stat(secondDirectory)).isDirectory(), true);
    assert.deepEqual(removedEntries, []);
    assert.deepEqual(addedEntries, ['1']);
    assert.strictEqual(root.descendant, firstChild);
    assert.notStrictEqual(root.descendant, appendedChild);
  },
);
