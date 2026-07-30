'use strict';

const assert = require('node:assert/strict');
const {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  after,
  before,
  describe,
  it,
} = require('node:test');

const TASK_PREFIX = 'moxley-platform-capability-';
const STATUS = Object.freeze({
  confirmed: 'confirmed',
  gap: 'capability-gap',
  notApplicable: 'not-applicable',
});
const OPTIONAL_LINK_GAP_CODES = new Set([
  'EACCES',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
]);
const RAW_NAME_GAP_CODES = new Set([
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_OPT_VALUE_ENCODING',
]);

// Characterization only. These tests do not qualify generic Windows reparse
// detection, race-free or handle-relative traversal, locking, concurrent
// writers, atomic creation or rollback, recovery, durability, cross-platform
// equivalence, or production runtime safety.
const receipt = {
  platform: process.platform,
  nodeVersion: process.version,
  ordinaryMetadata: STATUS.gap,
  nativeRealpath: STATUS.gap,
  createNewCollisionSemantics: STATUS.gap,
  separatorAwareContainment: STATUS.gap,
  canonicalAsciiOrdering: STATUS.gap,
  rawNameByteOrdering: STATUS.gap,
  deviceIdentity: STATUS.gap,
  objectIdentity: STATUS.gap,
  ordinaryLinkCount: STATUS.gap,
  hardLinkCount: STATUS.gap,
  hardLinkSharedIdentity: STATUS.gap,
  linkLikeNonFollowingEvidence: STATUS.gap,
  genericReparseDetection:
    process.platform === 'win32' ? STATUS.gap : STATUS.notApplicable,
  cleanup: STATUS.gap,
  overallQualification: 'no-go',
};

let normalizedTempRoot;
let ownedRoot;
let ordinaryDirectory;
let ordinaryFile;
let cleanupCompleted = false;

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'NO_CODE';
}

async function mustSucceed(label, operation) {
  try {
    return await operation();
  } catch (error) {
    assert.fail(`${label} failed with code ${errorCode(error)}`);
  }
}

async function requireErrorCode(label, operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    assert.equal(
      errorCode(error),
      expectedCode,
      `${label} must expose ${expectedCode}`,
    );
    return;
  }

  assert.fail(`${label} must fail`);
}

async function attemptOptional(label, operation, gapCodes) {
  try {
    return {
      status: STATUS.confirmed,
      value: await operation(),
    };
  } catch (error) {
    const code = errorCode(error);
    if (gapCodes.has(code)) {
      return {
        status: STATUS.gap,
        code,
      };
    }

    assert.fail(`${label} failed with unexpected code ${code}`);
  }
}

function isNumericIdentity(value) {
  return (
    (typeof value === 'bigint' || typeof value === 'number') &&
    value !== 0 &&
    value !== 0n &&
    Number.isFinite(Number(value))
  );
}

function stableUsableField(samples, field) {
  const values = samples.map((sample) => sample[field]);
  return (
    values.every(isNumericIdentity) &&
    values.every((value) => value === values[0])
  );
}

function isStrictRelativeResult(relativeResult) {
  return (
    relativeResult !== '' &&
    !path.isAbsolute(relativeResult) &&
    relativeResult !== '..' &&
    !relativeResult.startsWith(`..${path.sep}`)
  );
}

function isStrictDescendant(root, candidate) {
  return isStrictRelativeResult(path.relative(root, candidate));
}

function assertOwnedRootSafety(candidate) {
  assert.equal(
    typeof candidate,
    'string',
    'owned root must be the exact returned string',
  );
  assert.equal(
    path.isAbsolute(candidate),
    true,
    'owned root must be absolute',
  );

  const normalizedCandidate = path.resolve(candidate);
  const repositoryRoot = path.resolve(__dirname, '..');
  const workingDirectory = path.resolve(process.cwd());
  const homeDirectory = path.resolve(os.homedir());
  const driveRoot = path.parse(normalizedCandidate).root;

  assert.equal(
    isStrictDescendant(normalizedTempRoot, normalizedCandidate),
    true,
    'owned root must be a strict temporary descendant',
  );
  assert.equal(
    path.dirname(normalizedCandidate),
    normalizedTempRoot,
    'owned root must be an immediate temporary child',
  );
  assert.equal(
    path.basename(normalizedCandidate).startsWith(TASK_PREFIX),
    true,
    'owned root must retain the task prefix',
  );
  assert.notEqual(
    normalizedCandidate,
    normalizedTempRoot,
    'owned root must not equal the temporary root',
  );
  assert.notEqual(
    normalizedCandidate,
    repositoryRoot,
    'owned root must not equal the repository',
  );
  assert.notEqual(
    normalizedCandidate,
    workingDirectory,
    'owned root must not equal the working directory',
  );
  assert.notEqual(
    normalizedCandidate,
    homeDirectory,
    'owned root must not equal the home directory',
  );
  assert.notEqual(
    normalizedCandidate,
    driveRoot,
    'owned root must not equal a drive root',
  );
}

async function readRepeatedMetadata(target) {
  return [
    await mustSucceed('first non-following metadata read', () => (
      lstat(target, { bigint: true })
    )),
    await mustSucceed('second non-following metadata read', () => (
      lstat(target, { bigint: true })
    )),
  ];
}

async function removeOwnedRoot() {
  assertOwnedRootSafety(ownedRoot);
  await mustSucceed('owned temporary cleanup', () => (
    rm(ownedRoot, {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 50,
    })
  ));
  await requireErrorCode(
    'owned root absence confirmation',
    () => lstat(ownedRoot),
    'ENOENT',
  );
  cleanupCompleted = true;
  receipt.cleanup = STATUS.confirmed;
}

describe(
  'filesystem platform capability characterization',
  { concurrency: false },
  () => {
    before(async () => {
      normalizedTempRoot = path.resolve(os.tmpdir());
      ownedRoot = await mustSucceed('owned temporary creation', () => (
        mkdtemp(path.join(os.tmpdir(), TASK_PREFIX))
      ));
      assertOwnedRootSafety(ownedRoot);
    });

    after(async () => {
      if (ownedRoot === undefined || cleanupCompleted) {
        return;
      }

      await removeOwnedRoot();
    });

    it(
      'ordinary metadata and native realpath expose stable task-owned identities',
      async () => {
        ordinaryDirectory = path.join(ownedRoot, 'ordinary-directory');
        ordinaryFile = path.join(ownedRoot, 'ordinary-file');

        await mustSucceed('ordinary directory creation', () => (
          mkdir(ordinaryDirectory)
        ));
        await mustSucceed('ordinary file creation', () => (
          writeFile(ordinaryFile, 'moxley-platform-capability', 'utf8')
        ));

        const rootSamples = await readRepeatedMetadata(ownedRoot);
        const directorySamples =
          await readRepeatedMetadata(ordinaryDirectory);
        const fileSamples = await readRepeatedMetadata(ordinaryFile);

        assert.equal(rootSamples[0].isDirectory(), true);
        assert.equal(directorySamples[0].isDirectory(), true);
        assert.equal(directorySamples[0].isFile(), false);
        assert.equal(fileSamples[0].isFile(), true);
        assert.equal(fileSamples[0].isDirectory(), false);
        receipt.ordinaryMetadata = STATUS.confirmed;

        const resolvedRoot = await mustSucceed('root realpath', () => (
          realpath(ownedRoot)
        ));
        const resolvedDirectory = await mustSucceed(
          'directory realpath',
          () => realpath(ordinaryDirectory),
        );
        const resolvedFile = await mustSucceed('file realpath', () => (
          realpath(ordinaryFile)
        ));

        for (
          const resolvedPath of [
            resolvedRoot,
            resolvedDirectory,
            resolvedFile,
          ]
        ) {
          assert.equal(path.isAbsolute(resolvedPath), true);
        }
        assert.equal(
          path.resolve(resolvedRoot) === path.resolve(ownedRoot),
          true,
        );
        assert.equal(
          path.resolve(resolvedDirectory) ===
            path.resolve(ordinaryDirectory),
          true,
        );
        assert.equal(
          path.resolve(resolvedFile) === path.resolve(ordinaryFile),
          true,
        );
        receipt.nativeRealpath = STATUS.confirmed;

        const sampleGroups = [
          rootSamples,
          directorySamples,
          fileSamples,
        ];
        const stableDevices = sampleGroups.every((samples) => (
          stableUsableField(samples, 'dev')
        ));
        const oneDevice = stableDevices && sampleGroups.every(
          (samples) => samples[0].dev === rootSamples[0].dev,
        );
        receipt.deviceIdentity = oneDevice
          ? STATUS.confirmed
          : STATUS.gap;

        const stableObjects = sampleGroups.every((samples) => (
          stableUsableField(samples, 'ino')
        ));
        const distinctObjects = stableObjects && new Set(
          sampleGroups.map((samples) => samples[0].ino),
        ).size === sampleGroups.length;
        receipt.objectIdentity = distinctObjects
          ? STATUS.confirmed
          : STATUS.gap;

        receipt.ordinaryLinkCount =
          stableUsableField(fileSamples, 'nlink')
            ? STATUS.confirmed
            : STATUS.gap;
      },
    );

    it(
      'create-new characterization distinguishes absent existing and collision targets',
      async () => {
        const target = path.join(ownedRoot, 'create-target');
        const missingParentTarget = path.join(
          ownedRoot,
          'missing-parent',
          'child',
        );

        await requireErrorCode(
          'absent target inspection',
          () => lstat(target),
          'ENOENT',
        );
        await mustSucceed('final target creation', () => mkdir(target));
        const targetMetadata = await mustSucceed(
          'created target inspection',
          () => lstat(target),
        );
        assert.equal(targetMetadata.isDirectory(), true);
        await requireErrorCode(
          'existing target collision',
          () => mkdir(target),
          'EEXIST',
        );
        await requireErrorCode(
          'missing intermediate parent',
          () => mkdir(missingParentTarget),
          'ENOENT',
        );
        receipt.createNewCollisionSemantics = STATUS.confirmed;
      },
    );

    it(
      'separator-aware containment rejects parent and sibling-prefix escapes',
      () => {
        const nestedDescendant = path.join(
          ordinaryDirectory,
          'nested',
          'descendant',
        );
        const parent = path.dirname(ownedRoot);
        const sibling = path.join(parent, 'independent-sibling');
        const siblingPrefix = path.join(
          parent,
          `${path.basename(ownedRoot)}-sibling`,
        );
        const syntheticAbsoluteResult = path.resolve(
          path.parse(ownedRoot).root,
          'synthetic-absolute-result',
        );

        assert.equal(
          isStrictDescendant(ownedRoot, ordinaryDirectory),
          true,
        );
        assert.equal(
          isStrictDescendant(ownedRoot, nestedDescendant),
          true,
        );
        assert.equal(isStrictDescendant(ownedRoot, ownedRoot), false);
        assert.equal(isStrictDescendant(ownedRoot, parent), false);
        assert.equal(isStrictDescendant(ownedRoot, sibling), false);
        assert.equal(isStrictDescendant(ownedRoot, siblingPrefix), false);
        assert.equal(
          isStrictRelativeResult(syntheticAbsoluteResult),
          false,
        );
        assert.equal(
          isStrictRelativeResult(`..${path.sep}escape`),
          false,
        );
        receipt.separatorAwareContainment = STATUS.confirmed;
      },
    );

    it(
      'peer ordering is deterministic independently of filesystem enumeration order',
      async () => {
        const orderingDirectory = path.join(ownedRoot, 'ordering');
        const creationOrder = [
          'n_10',
          'k_61.ml',
          'n_0',
          'n_1',
        ];
        const expectedOrder = [
          'k_61.ml',
          'n_0',
          'n_1',
          'n_10',
        ];

        await mustSucceed(
          'ordering directory creation',
          () => mkdir(orderingDirectory),
        );
        for (const entryName of creationOrder) {
          await mustSucceed(
            'ordering entry creation',
            () => mkdir(path.join(orderingDirectory, entryName)),
          );
        }

        const enumerated = await mustSucceed(
          'string directory enumeration',
          () => readdir(orderingDirectory),
        );
        const deterministic = [...enumerated].sort((left, right) => (
          Buffer.compare(
            Buffer.from(left, 'utf8'),
            Buffer.from(right, 'utf8'),
          )
        ));
        assert.deepEqual(deterministic, expectedOrder);
        receipt.canonicalAsciiOrdering = STATUS.confirmed;

        const rawNameResult = await attemptOptional(
          'buffer directory enumeration',
          () => readdir(orderingDirectory, { encoding: 'buffer' }),
          RAW_NAME_GAP_CODES,
        );
        if (rawNameResult.status === STATUS.confirmed) {
          assert.equal(
            rawNameResult.value.every(Buffer.isBuffer),
            true,
          );
          const deterministicBytes = [...rawNameResult.value]
            .sort(Buffer.compare)
            .map((entry) => entry.toString('utf8'));
          assert.deepEqual(deterministicBytes, expectedOrder);
          receipt.rawNameByteOrdering = STATUS.confirmed;
        } else {
          receipt.rawNameByteOrdering = STATUS.gap;
        }
      },
    );

    it(
      'task-owned hard links expose link counts and shared object identity',
      async () => {
        const source = path.join(ownedRoot, 'hard-link-source');
        const alias = path.join(ownedRoot, 'hard-link-alias');

        await mustSucceed('hard-link source creation', () => (
          writeFile(source, 'hard-link-evidence', 'utf8')
        ));
        const linkResult = await attemptOptional(
          'hard-link creation',
          () => link(source, alias),
          OPTIONAL_LINK_GAP_CODES,
        );

        if (linkResult.status === STATUS.gap) {
          receipt.hardLinkCount = STATUS.gap;
          receipt.hardLinkSharedIdentity = STATUS.gap;
          return;
        }

        const sourceMetadata = await mustSucceed(
          'hard-link source inspection',
          () => lstat(source, { bigint: true }),
        );
        const aliasMetadata = await mustSucceed(
          'hard-link alias inspection',
          () => lstat(alias, { bigint: true }),
        );
        assert.equal(sourceMetadata.isFile(), true);
        assert.equal(aliasMetadata.isFile(), true);

        const usableLinkCounts = (
          isNumericIdentity(sourceMetadata.nlink) &&
          isNumericIdentity(aliasMetadata.nlink)
        );
        if (usableLinkCounts) {
          assert.equal(sourceMetadata.nlink >= 2n, true);
          assert.equal(aliasMetadata.nlink >= 2n, true);
          assert.equal(sourceMetadata.nlink, aliasMetadata.nlink);
          receipt.hardLinkCount = STATUS.confirmed;
        } else {
          receipt.hardLinkCount = STATUS.gap;
        }

        const usableSharedDevice = (
          isNumericIdentity(sourceMetadata.dev) &&
          isNumericIdentity(aliasMetadata.dev)
        );
        const usableSharedObject = (
          isNumericIdentity(sourceMetadata.ino) &&
          isNumericIdentity(aliasMetadata.ino)
        );
        if (usableSharedDevice && usableSharedObject) {
          assert.equal(sourceMetadata.dev, aliasMetadata.dev);
          assert.equal(sourceMetadata.ino, aliasMetadata.ino);
          receipt.hardLinkSharedIdentity = STATUS.confirmed;
        } else {
          receipt.hardLinkSharedIdentity = STATUS.gap;
        }

        await mustSucceed(
          'hard-link alias removal',
          () => unlink(alias),
        );
        await requireErrorCode(
          'hard-link alias absence',
          () => lstat(alias),
          'ENOENT',
        );
        const retainedSource = await mustSucceed(
          'hard-link source retention',
          () => lstat(source),
        );
        assert.equal(retainedSource.isFile(), true);
      },
    );

    it(
      'task-owned link-like entries expose non-following metadata or an explicit capability gap',
      async () => {
        const target = path.join(ownedRoot, 'link-like-target');
        const alias = path.join(ownedRoot, 'link-like-alias');
        const linkType = process.platform === 'win32'
          ? 'junction'
          : 'dir';

        await mustSucceed(
          'link-like target creation',
          () => mkdir(target),
        );
        const linkResult = await attemptOptional(
          'link-like creation',
          () => symlink(target, alias, linkType),
          OPTIONAL_LINK_GAP_CODES,
        );

        if (linkResult.status === STATUS.gap) {
          receipt.linkLikeNonFollowingEvidence = STATUS.gap;
          return;
        }

        const aliasMetadata = await mustSucceed(
          'link-like non-following inspection',
          () => lstat(alias),
        );
        assert.equal(aliasMetadata.isSymbolicLink(), true);
        const resolvedAlias = await mustSucceed(
          'link-like native realpath',
          () => realpath(alias),
        );
        const resolvedTarget = await mustSucceed(
          'link-like target realpath',
          () => realpath(target),
        );
        assert.equal(path.isAbsolute(resolvedAlias), true);
        assert.equal(
          path.resolve(resolvedAlias) === path.resolve(resolvedTarget),
          true,
        );
        receipt.linkLikeNonFollowingEvidence = STATUS.confirmed;

        await mustSucceed(
          'link-like alias removal',
          () => unlink(alias),
        );
        await requireErrorCode(
          'link-like alias absence',
          () => lstat(alias),
          'ENOENT',
        );
        const retainedTarget = await mustSucceed(
          'link-like target retention',
          () => lstat(target),
        );
        assert.equal(retainedTarget.isDirectory(), true);
      },
    );

    it(
      'platform capability receipt preserves the no-go and removes the task-owned tree',
      async () => {
        const requiredConfirmed = [
          receipt.ordinaryMetadata,
          receipt.nativeRealpath,
          receipt.createNewCollisionSemantics,
          receipt.separatorAwareContainment,
          receipt.canonicalAsciiOrdering,
        ];
        for (const status of requiredConfirmed) {
          assert.equal(status, STATUS.confirmed);
        }

        const confirmedOrGap = [
          receipt.deviceIdentity,
          receipt.objectIdentity,
          receipt.ordinaryLinkCount,
          receipt.rawNameByteOrdering,
          receipt.hardLinkCount,
          receipt.hardLinkSharedIdentity,
          receipt.linkLikeNonFollowingEvidence,
        ];
        for (const status of confirmedOrGap) {
          assert.equal(
            status === STATUS.confirmed || status === STATUS.gap,
            true,
          );
        }

        if (process.platform === 'win32') {
          assert.equal(
            receipt.genericReparseDetection,
            STATUS.gap,
          );
        } else {
          assert.equal(
            receipt.genericReparseDetection,
            STATUS.notApplicable,
          );
        }
        assert.equal(receipt.overallQualification, 'no-go');
        assertOwnedRootSafety(ownedRoot);

        await removeOwnedRoot();
        assert.equal(receipt.cleanup, STATUS.confirmed);
        assert.equal(receipt.overallQualification, 'no-go');

        console.log(JSON.stringify({
          filesystemCapabilityReceipt: receipt,
        }));
      },
    );
  },
);
