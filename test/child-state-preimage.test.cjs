'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { TextDecoder } = require('node:util');
const { parse, stringify } = require('flatted');

const Moxley = require('..');

const CLEANUP_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;
const CHARACTERIZATION_SENTINEL_ROOT =
  '/__moxley_characterization_sentinel__/database/';
const STATE_PREIMAGE_FIXTURE_ROOT = path.join(
  __dirname,
  'fixtures',
  'state-preimages',
);
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// The fixed _loc values are characterization sentinels, not user paths.
// These fixture trees are synthetic exemplars, not archived user databases,
// and are deliberately never passed to the Moxley constructor or loader.
const CHARACTERIZATION_FIXTURES = Object.freeze({
  'historical-root-shape/_state.ms': {
    byteLength: 131,
    finalByte: 0x5d,
    sha256:
      '4136bde5fef8548251396b18e97d6ad608f8d5a58af75bc3f2ffa029a6013ec2',
  },
  'historical-nested-shape/_state.ms': {
    byteLength: 147,
    finalByte: 0x5d,
    sha256:
      '3ef2a6b9ca26954a8e9b37152a1318169edc6939992b5ef11b8c690133eae972',
  },
  'historical-nested-shape/0/_state.ms': {
    byteLength: 133,
    finalByte: 0x5d,
    sha256:
      'f4a05c797078c4e379e555677fb6aa051078435919da5f1bf8268b8e3687836a',
  },
  'historical-nested-shape/descendant.ml': {
    byteLength: 3,
    finalByte: 0x30,
    sha256:
      '5513e3eabba6d75402c1c34c7365c6fac01024589d0a6996329255cd18fec5cc',
  },
  'post-pr11-unversioned/_state.ms': {
    byteLength: 147,
    finalByte: 0x5d,
    sha256:
      '3ef2a6b9ca26954a8e9b37152a1318169edc6939992b5ef11b8c690133eae972',
  },
  'post-pr11-unversioned/0/_state.ms': {
    byteLength: 141,
    finalByte: 0x5d,
    sha256:
      '49464a6f8c29e53934ccf77ce6ec8c8ba9286d568d83d3717c392e1c810a51a4',
  },
  'post-pr11-unversioned/descendant.ml': {
    byteLength: 3,
    finalByte: 0x30,
    sha256:
      '5513e3eabba6d75402c1c34c7365c6fac01024589d0a6996329255cd18fec5cc',
  },
  'proposed-v1-marker/_state.ms': {
    byteLength: 192,
    finalByte: 0x5d,
    sha256:
      '81729fa1cd0872a1838e68083a77d4287bd49a2b22a7b32f17bb1a142d46c60a',
  },
  'proposed-v1-marker/0/_state.ms': {
    byteLength: 141,
    finalByte: 0x5d,
    sha256:
      '49464a6f8c29e53934ccf77ce6ec8c8ba9286d568d83d3717c392e1c810a51a4',
  },
  'proposed-v1-marker/descendant.ml': {
    byteLength: 3,
    finalByte: 0x30,
    sha256:
      '5513e3eabba6d75402c1c34c7365c6fac01024589d0a6996329255cd18fec5cc',
  },
});

const PROPOSED_MARKER_CLASSIFICATION = Object.freeze({
  exact: 'exact-proposed-version-1-root-marker',
  unversioned: 'unversioned-root',
  invalid: 'invalid-or-unsupported-marker',
  nonRoot: 'marker-in-non-root-context',
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function classifyProposedRootMarkerForCharacterization(
  logicalValue,
  { rootContext = true } = {},
) {
  if (
    logicalValue === null ||
    typeof logicalValue !== 'object' ||
    Array.isArray(logicalValue)
  ) {
    return PROPOSED_MARKER_CLASSIFICATION.invalid;
  }

  const hasFormat = hasOwn(logicalValue, '_format');
  const hasFormatVersion = hasOwn(logicalValue, '_formatVersion');

  if (!rootContext && (hasFormat || hasFormatVersion)) {
    return PROPOSED_MARKER_CLASSIFICATION.nonRoot;
  }

  if (!hasFormat && !hasFormatVersion) {
    return PROPOSED_MARKER_CLASSIFICATION.unversioned;
  }

  if (!hasFormat || !hasFormatVersion) {
    return PROPOSED_MARKER_CLASSIFICATION.invalid;
  }

  if (
    logicalValue._format === 'moxley-db' &&
    Number.isInteger(logicalValue._formatVersion) &&
    logicalValue._formatVersion === 1
  ) {
    return PROPOSED_MARKER_CLASSIFICATION.exact;
  }

  return PROPOSED_MARKER_CLASSIFICATION.invalid;
}

async function enumerateCharacterizationFixturePaths(
  directory = STATE_PREIMAGE_FIXTURE_ROOT,
) {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await enumerateCharacterizationFixturePaths(entryPath));
    } else {
      paths.push(
        path
          .relative(STATE_PREIMAGE_FIXTURE_ROOT, entryPath)
          .split(path.sep)
          .join('/'),
      );
    }
  }

  return paths.sort();
}

async function readCharacterizationFixture(relativePath) {
  return readFile(
    path.join(
      STATE_PREIMAGE_FIXTURE_ROOT,
      ...relativePath.split('/'),
    ),
  );
}

function parseCharacterizationState(bytes) {
  return parse(STRICT_UTF8_DECODER.decode(bytes));
}

function fixtureSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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

async function createChildStateScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-child-state-preimage-'),
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
  const database = new Moxley(databasePath);

  return {
    databaseDirectory,
    databasePath,
    root: database.db,
  };
}

test(
  'named child state is persisted with finalized id and name',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root } =
      await createChildStateScenario(t);
    const childDirectory = path.join(databaseDirectory, '0');
    const childStatePath = path.join(childDirectory, '_state.ms');
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootStatePath = path.join(databaseDirectory, '_state.ms');

    const child = root._create('descendant');
    const entries = (await readdir(databaseDirectory)).sort();
    const persistedChildState = parse(
      (await readFile(childStatePath)).toString('utf8'),
    );
    const rootState = parse(
      (await readFile(rootStatePath)).toString('utf8'),
    );
    const namedLinkBytes = await readFile(namedLinkPath);

    assert.equal(path.resolve(child._loc), path.resolve(childDirectory));
    assert.equal(child._id, '0/0');
    assert.equal(child._name, 'descendant');
    assert.deepEqual(child._keys, []);
    assert.deepEqual(child._bindings, []);

    assert.equal((await stat(childStatePath)).isFile(), true);
    assert.equal(persistedChildState._loc, child._loc);
    assert.equal(
      path.resolve(persistedChildState._loc),
      path.resolve(childDirectory),
    );
    assert.equal(persistedChildState._id, '0/0');
    assert.equal(persistedChildState._name, 'descendant');
    assert.deepEqual(persistedChildState._keys, []);
    assert.deepEqual(persistedChildState._bindings, []);

    assert.equal(root._children.length, 1);
    assert.strictEqual(root._children[0], child);
    assert.strictEqual(root.descendant, child);
    assert.equal(namedLinkBytes.toString('utf8'), '0/0');
    assert.deepEqual(entries, ['0', '_state.ms', 'descendant.ml']);
    assert.equal(rootState._id, '0');
    assert.equal(rootState._name, 'root');
    assert.deepEqual(rootState._keys, ['descendant']);
    assert.deepEqual(rootState._bindings, []);
  },
);

test(
  'reopen preserves the finalized child name without a root binding artifact',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, databasePath, root } =
      await createChildStateScenario(t);
    const rootStatePath = path.join(databaseDirectory, '_state.ms');
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootLinkPath = path.join(databaseDirectory, 'root.ml');
    const secondDirectory = path.join(databaseDirectory, '1');

    root._create('descendant');
    const beforeEntries = (await readdir(databaseDirectory)).sort();
    const beforeRootStateBytes = await readFile(rootStatePath);

    const reopenedDatabase = new Moxley(databasePath);
    const reopenedRoot = reopenedDatabase.db;
    const loadResult = await reopenedRoot._loadFromDir();
    const reconstructedChild = reopenedRoot._children[0];
    const afterEntries = (await readdir(databaseDirectory)).sort();
    const afterRootStateBytes = await readFile(rootStatePath);
    const reparsedRootState = parse(
      afterRootStateBytes.toString('utf8'),
    );

    assert.strictEqual(loadResult, reopenedRoot);
    assert.equal(reopenedRoot._children.length, 1);
    assert.equal(reconstructedChild._id, '0/0');
    assert.equal(reconstructedChild._name, 'descendant');
    assert.deepEqual(reconstructedChild._keys, []);
    assert.deepEqual(reconstructedChild._bindings, []);
    assert.strictEqual(reopenedRoot.descendant, reconstructedChild);
    assert.deepEqual(reopenedRoot._keys, ['descendant']);

    assert.deepEqual(beforeEntries, [
      '0',
      '_state.ms',
      'descendant.ml',
    ]);
    assert.deepEqual(afterEntries, beforeEntries);
    assert.equal((await readFile(namedLinkPath, 'utf8')), '0/0');
    await assert.rejects(
      stat(rootLinkPath),
      (error) => error && error.code === 'ENOENT',
    );
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );
    assert.deepEqual(afterRootStateBytes, beforeRootStateBytes);
    assert.deepEqual(reparsedRootState._keys, ['descendant']);
  },
);

test(
  'reopen leaves historical provisional child state bytes unchanged',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, databasePath, root } =
      await createChildStateScenario(t);
    const childStatePath = path.join(
      databaseDirectory,
      '0',
      '_state.ms',
    );
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootLinkPath = path.join(databaseDirectory, 'root.ml');
    const secondDirectory = path.join(databaseDirectory, '1');

    const child = root._create('descendant');
    await writeFile(
      childStatePath,
      stringify({
        _loc: child._loc,
        _id: '0',
        _name: 'root',
        _keys: [],
        _bindings: [],
      }),
    );
    const historicalChildStateBytes = await readFile(childStatePath);
    const namedLinkBytes = await readFile(namedLinkPath);

    const reopenedDatabase = new Moxley(databasePath);
    const reopenedRoot = reopenedDatabase.db;
    const loadResult = await reopenedRoot._loadFromDir();
    const reconstructedChild = reopenedRoot._children[0];
    const afterChildStateBytes = await readFile(childStatePath);
    const afterNamedLinkBytes = await readFile(namedLinkPath);

    assert.strictEqual(loadResult, reopenedRoot);
    assert.equal(reopenedRoot._children.length, 1);
    assert.equal(reconstructedChild._name, 'root');
    assert.deepEqual(afterChildStateBytes, historicalChildStateBytes);
    assert.deepEqual(afterNamedLinkBytes, namedLinkBytes);
    assert.equal(afterNamedLinkBytes.toString('utf8'), '0/0');
    assert.equal((await stat(rootLinkPath)).isFile(), true);
    assert.equal((await readFile(rootLinkPath, 'utf8')), '0/0');
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );
  },
);

test(
  'historical and post-PR11 root preimages remain unversioned',
  async () => {
    const expectedPaths = Object.keys(CHARACTERIZATION_FIXTURES).sort();
    assert.deepEqual(
      await enumerateCharacterizationFixturePaths(),
      expectedPaths,
    );

    for (const relativePath of expectedPaths) {
      const expectation = CHARACTERIZATION_FIXTURES[relativePath];
      const bytes = await readCharacterizationFixture(relativePath);

      assert.equal(bytes.length, expectation.byteLength, relativePath);
      assert.equal(bytes.at(-1), expectation.finalByte, relativePath);
      assert.equal(fixtureSha256(bytes), expectation.sha256, relativePath);
      assert.equal(
        bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        false,
        relativePath,
      );
      assert.equal(bytes.includes(0x0a), false, relativePath);
      assert.equal(bytes.includes(0x0d), false, relativePath);
      assert.notEqual(bytes.at(-1), 0x20, relativePath);
      assert.doesNotThrow(
        () => STRICT_UTF8_DECODER.decode(bytes),
        relativePath,
      );
    }

    const rootPaths = [
      'historical-root-shape/_state.ms',
      'historical-nested-shape/_state.ms',
      'post-pr11-unversioned/_state.ms',
    ];

    for (const rootPath of rootPaths) {
      const root = parseCharacterizationState(
        await readCharacterizationFixture(rootPath),
      );
      assert.equal(hasOwn(root, '_format'), false, rootPath);
      assert.equal(hasOwn(root, '_formatVersion'), false, rootPath);
      assert.equal(
        classifyProposedRootMarkerForCharacterization(root),
        PROPOSED_MARKER_CLASSIFICATION.unversioned,
        rootPath,
      );
    }

    assert.deepEqual(
      await readCharacterizationFixture(
        'historical-nested-shape/_state.ms',
      ),
      await readCharacterizationFixture(
        'post-pr11-unversioned/_state.ms',
      ),
    );
  },
);

test(
  'historical nested preimage preserves provisional child metadata',
  async () => {
    const root = parseCharacterizationState(
      await readCharacterizationFixture(
        'historical-nested-shape/_state.ms',
      ),
    );
    const child = parseCharacterizationState(
      await readCharacterizationFixture(
        'historical-nested-shape/0/_state.ms',
      ),
    );
    const namedLink = await readCharacterizationFixture(
      'historical-nested-shape/descendant.ml',
    );

    assert.deepEqual(root, {
      _loc: CHARACTERIZATION_SENTINEL_ROOT,
      _id: '0',
      _name: 'root',
      _keys: ['descendant'],
      _bindings: [],
    });
    assert.deepEqual(child, {
      _loc: `${CHARACTERIZATION_SENTINEL_ROOT}0/`,
      _id: '0',
      _name: 'root',
      _keys: [],
      _bindings: [],
    });
    assert.deepEqual(namedLink, Buffer.from('0/0', 'utf8'));
  },
);

test(
  'post-PR11 nested preimage preserves finalized child metadata',
  async () => {
    const historicalChildBytes = await readCharacterizationFixture(
      'historical-nested-shape/0/_state.ms',
    );
    const postPr11ChildBytes = await readCharacterizationFixture(
      'post-pr11-unversioned/0/_state.ms',
    );
    const historicalChild =
      parseCharacterizationState(historicalChildBytes);
    const postPr11Child =
      parseCharacterizationState(postPr11ChildBytes);
    const {
      _id: historicalId,
      _name: historicalName,
      ...historicalShared
    } = historicalChild;
    const {
      _id: postPr11Id,
      _name: postPr11Name,
      ...postPr11Shared
    } = postPr11Child;

    assert.notDeepEqual(postPr11ChildBytes, historicalChildBytes);
    assert.deepEqual(historicalShared, postPr11Shared);
    assert.deepEqual(
      { _id: historicalId, _name: historicalName },
      { _id: '0', _name: 'root' },
    );
    assert.deepEqual(
      { _id: postPr11Id, _name: postPr11Name },
      { _id: '0/0', _name: 'descendant' },
    );
    assert.deepEqual(
      await readCharacterizationFixture(
        'historical-nested-shape/descendant.ml',
      ),
      await readCharacterizationFixture(
        'post-pr11-unversioned/descendant.ml',
      ),
    );
    assert.equal(
      (
        await readCharacterizationFixture(
          'post-pr11-unversioned/descendant.ml',
        )
      ).toString('utf8'),
      '0/0',
    );
  },
);

test(
  'proposed version-1 preimage differs only through the root marker',
  async () => {
    const postPr11RootBytes = await readCharacterizationFixture(
      'post-pr11-unversioned/_state.ms',
    );
    const proposedRootBytes = await readCharacterizationFixture(
      'proposed-v1-marker/_state.ms',
    );
    const postPr11Root = parseCharacterizationState(postPr11RootBytes);
    const proposedRoot = parseCharacterizationState(proposedRootBytes);
    const {
      _format,
      _formatVersion,
      ...proposedWithoutMarker
    } = proposedRoot;

    assert.notDeepEqual(proposedRootBytes, postPr11RootBytes);
    assert.equal(_format, 'moxley-db');
    assert.equal(_formatVersion, 1);
    assert.deepEqual(proposedWithoutMarker, postPr11Root);
    assert.equal(
      classifyProposedRootMarkerForCharacterization(proposedRoot),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );

    const reorderedMarker = {
      _formatVersion: 1,
      _bindings: [],
      _keys: ['descendant'],
      _name: 'root',
      _id: '0',
      _loc: CHARACTERIZATION_SENTINEL_ROOT,
      _format: 'moxley-db',
    };
    assert.notDeepEqual(
      Object.keys(reorderedMarker),
      Object.keys(proposedRoot),
    );
    assert.equal(
      classifyProposedRootMarkerForCharacterization(reorderedMarker),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );

    assert.deepEqual(
      await readCharacterizationFixture(
        'proposed-v1-marker/0/_state.ms',
      ),
      await readCharacterizationFixture(
        'post-pr11-unversioned/0/_state.ms',
      ),
    );
    assert.deepEqual(
      await readCharacterizationFixture(
        'proposed-v1-marker/descendant.ml',
      ),
      await readCharacterizationFixture(
        'post-pr11-unversioned/descendant.ml',
      ),
    );
  },
);

test(
  'marker name case type and version mismatches do not classify as proposed version 1',
  async () => {
    const unversionedRoot = parseCharacterizationState(
      await readCharacterizationFixture(
        'post-pr11-unversioned/_state.ms',
      ),
    );
    const mutationMatrix = [
      {
        name: 'wrong _format property case',
        value: {
          ...unversionedRoot,
          _Format: 'moxley-db',
          _formatVersion: 1,
        },
      },
      {
        name: 'wrong _formatVersion property case',
        value: {
          ...unversionedRoot,
          _format: 'moxley-db',
          _formatversion: 1,
        },
      },
      {
        name: 'wrong format name',
        value: {
          ...unversionedRoot,
          _format: 'other-db',
          _formatVersion: 1,
        },
      },
      {
        name: 'wrong format value case',
        value: {
          ...unversionedRoot,
          _format: 'Moxley-db',
          _formatVersion: 1,
        },
      },
      {
        name: 'string version',
        value: {
          ...unversionedRoot,
          _format: 'moxley-db',
          _formatVersion: '1',
        },
      },
      {
        name: 'non-integer version',
        value: {
          ...unversionedRoot,
          _format: 'moxley-db',
          _formatVersion: 1.5,
        },
      },
      {
        name: 'unsupported version',
        value: {
          ...unversionedRoot,
          _format: 'moxley-db',
          _formatVersion: 2,
        },
      },
      {
        name: 'missing version companion field',
        value: {
          ...unversionedRoot,
          _format: 'moxley-db',
        },
      },
      {
        name: 'missing format companion field',
        value: {
          ...unversionedRoot,
          _formatVersion: 1,
        },
      },
    ];

    for (const mutation of mutationMatrix) {
      assert.equal(
        classifyProposedRootMarkerForCharacterization(mutation.value),
        PROPOSED_MARKER_CLASSIFICATION.invalid,
        mutation.name,
      );
    }
  },
);

test(
  'the proposed format marker is root-owned characterization evidence',
  async () => {
    const proposedRoot = parseCharacterizationState(
      await readCharacterizationFixture(
        'proposed-v1-marker/_state.ms',
      ),
    );
    const proposedChild = parseCharacterizationState(
      await readCharacterizationFixture(
        'proposed-v1-marker/0/_state.ms',
      ),
    );
    const markedChildMutation = {
      ...proposedChild,
      _format: 'moxley-db',
      _formatVersion: 1,
    };

    assert.equal(
      classifyProposedRootMarkerForCharacterization(proposedRoot),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );
    assert.equal(hasOwn(proposedChild, '_format'), false);
    assert.equal(hasOwn(proposedChild, '_formatVersion'), false);
    assert.equal(
      classifyProposedRootMarkerForCharacterization(proposedChild),
      PROPOSED_MARKER_CLASSIFICATION.unversioned,
    );
    assert.equal(
      classifyProposedRootMarkerForCharacterization(
        markedChildMutation,
        { rootContext: false },
      ),
      PROPOSED_MARKER_CLASSIFICATION.nonRoot,
    );
    assert.notEqual(
      classifyProposedRootMarkerForCharacterization(
        markedChildMutation,
        { rootContext: false },
      ),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );
  },
);
