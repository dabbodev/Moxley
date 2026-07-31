'use strict';

const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const { internal } = require('./build-windows-native.cjs');

const MAX_LOCK_BYTES = 2048;

class NativeCleanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NativeCleanError';
    this.code = code;
  }
}

function cleanError(code, message) {
  return new NativeCleanError(code, message);
}

async function existingMetadata(target) {
  try {
    return await fsp.lstat(target, { bigint: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'A native clean path could not be authenticated.',
    );
  }
}

async function authenticateExisting(target, expectedType) {
  try {
    return await internal.authenticatePath(target, expectedType);
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'A native clean path is unsafe or has an unexpected type.',
    );
  }
}

function repositoryRelative(root, target) {
  const relative = path.relative(root, target);
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'A native clean path is outside the package boundary.',
    );
  }
  return relative.split(path.sep).join('/');
}

async function connectLeaseOnce(pipeName) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipeName);
    let settled = false;
    function finish(active) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(active);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function authenticateRoot() {
  try {
    await internal.authenticatePath(internal.PACKAGE_ROOT, 'directory');
    await internal.authenticatePath(__dirname, 'directory');
    await internal.authenticatePath(__filename, 'file');
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'The native clean package root could not be authenticated.',
    );
  }
  const canonicalRoot = await fsp.realpath(internal.PACKAGE_ROOT);
  if (!internal.sameWindowsPath(canonicalRoot, internal.PACKAGE_ROOT)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'The native clean package root identity changed.',
    );
  }
  const manifestPath = path.join(canonicalRoot, 'package.json');
  await authenticateExisting(manifestPath, 'file');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'The native clean package manifest could not be authenticated.',
    );
  }
  if (
    manifest.name !== 'moxley-db' ||
    manifest.version !== '3.1.1' ||
    manifest.scripts?.['clean:native:windows'] !==
      'node scripts/clean-windows-native.cjs'
  ) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'The native clean package manifest could not be authenticated.',
    );
  }
  const key = internal.repositoryKey(canonicalRoot);
  return Object.freeze({
    canonicalRoot,
    repositoryKey: key,
    pipeName: internal.pipeNameForKey(key),
  });
}

async function authenticateLock(context, paths) {
  const metadata = await existingMetadata(paths.lock);
  if (metadata === null) return null;
  await authenticateExisting(paths.lock, 'file');
  if (metadata.size <= 0n || metadata.size > BigInt(MAX_LOCK_BYTES)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  let record;
  try {
    const bytes = await fsp.readFile(paths.lock);
    record = internal.decodeLockBytes(
      bytes,
      context.repositoryKey,
      context.pipeName,
    );
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  return Object.freeze({
    record,
    identity: internal.identityOf(metadata),
  });
}

async function authenticateRemovalFile(target) {
  const metadata = await existingMetadata(target);
  if (metadata === null) return null;
  await authenticateExisting(target, 'file');
  return Object.freeze({
    target,
    identity: internal.identityOf(metadata),
  });
}

async function authenticateStaging(root, release, lock) {
  const staging = path.join(release, lock.record.stagingName);
  if (!internal.isStrictDescendant(release, staging)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
      'Native build staging is outside the clean boundary.',
    );
  }
  const metadata = await existingMetadata(staging);
  if (metadata === null) return null;
  await authenticateExisting(staging, 'directory');
  let inventory;
  try {
    inventory = await internal.inventoryStagingTree(
      staging,
      new Set(internal.STAGING_FILE_NAMES),
    );
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
      'Native build staging contains an unexpected entry.',
    );
  }
  const files = inventory.files.map((item) =>
    Object.freeze({
      ...item,
      relative: repositoryRelative(root, item.target),
    }),
  );
  const directories = inventory.directories.map((item) =>
    Object.freeze({
      ...item,
      relative: repositoryRelative(root, item.target),
    }),
  );
  return Object.freeze({
    target: staging,
    relative: repositoryRelative(root, staging),
    identity: internal.identityOf(metadata),
    files: Object.freeze(files),
    directories: Object.freeze(directories),
  });
}

async function requireSameIdentity(item, includeSize = true) {
  const metadata = await existingMetadata(item.target);
  if (
    metadata === null ||
    !internal.sameIdentity(metadata, item.identity, includeSize)
  ) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_IDENTITY_CHANGED',
      'A native clean target identity changed.',
    );
  }
  try {
    await internal.assertNoReparse(item.target);
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'A native clean target became unsafe.',
    );
  }
}

async function removeFile(item, removed) {
  await requireSameIdentity(item);
  try {
    await fsp.unlink(item.target);
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
      'A native clean target could not be removed.',
    );
  }
  if (await internal.exists(item.target)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
      'A native clean target remained after removal.',
    );
  }
  removed.push(item.relative);
}

async function removeStaging(staging, removed) {
  if (staging === null) return;
  for (const file of staging.files) await removeFile(file, removed);
  for (const directory of staging.directories) {
    await requireSameIdentity(directory, false);
    try {
      await fsp.rmdir(directory.target);
    } catch {
      throw cleanError(
        'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
        'Native compiler temporary state could not be removed.',
      );
    }
    if (await internal.exists(directory.target)) {
      throw cleanError(
        'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
        'Native compiler temporary state remained after removal.',
      );
    }
    removed.push(directory.relative);
  }
  await requireSameIdentity(staging, false);
  try {
    await fsp.rmdir(staging.target);
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
      'Native build staging could not be removed.',
    );
  }
  if (await internal.exists(staging.target)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
      'Native build staging remained after removal.',
    );
  }
  removed.push(staging.relative);
}

async function runClean() {
  const context = await authenticateRoot();
  const placeholder = `${internal.STAGING_PREFIX}${'a'.repeat(32)}`;
  const paths = internal.packagePaths(context.canonicalRoot, placeholder);
  for (const target of [paths.build, paths.release]) {
    const metadata = await existingMetadata(target);
    if (metadata !== null) await authenticateExisting(target, 'directory');
  }
  if (!(await internal.exists(paths.release))) {
    return { status: 'clean', removed: [] };
  }

  const lock = await authenticateLock(context, paths);
  const entries = await fsp.readdir(paths.release, { withFileTypes: true });
  const stagingNames = entries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(internal.STAGING_PREFIX))
    .sort(internal.ordinalCompare);
  if (
    (lock === null && stagingNames.length !== 0) ||
    (lock !== null &&
      stagingNames.some((name) => name !== lock.record.stagingName))
  ) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
      'Unauthenticated native build staging exists.',
    );
  }

  if (await connectLeaseOnce(context.pipeName)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_BUSY',
      'An active cooperating native build exists.',
    );
  }

  const artifact = await authenticateRemovalFile(paths.artifact);
  const receipt = await authenticateRemovalFile(paths.receipt);
  const staging =
    lock === null
      ? null
      : await authenticateStaging(
          context.canonicalRoot,
          paths.release,
          lock,
        );
  const lockItem =
    lock === null
      ? null
      : Object.freeze({
          target: paths.lock,
          relative: internal.LOCK_RELATIVE,
          identity: lock.identity,
        });

  const removed = [];
  await removeStaging(staging, removed);
  if (artifact !== null) {
    await removeFile(
      Object.freeze({
        ...artifact,
        relative: internal.ARTIFACT_RELATIVE,
      }),
      removed,
    );
  }
  if (receipt !== null) {
    await removeFile(
      Object.freeze({
        ...receipt,
        relative: internal.RECEIPT_RELATIVE,
      }),
      removed,
    );
  }
  if (lockItem !== null) await removeFile(lockItem, removed);

  for (const target of [
    paths.artifact,
    paths.receipt,
    paths.lock,
    ...(staging === null ? [] : [staging.target]),
  ]) {
    if (await internal.exists(target)) {
      throw cleanError(
        'MOXLEY_NATIVE_CLEAN_REMOVE_FAILED',
        'Native generated state remained after clean.',
      );
    }
  }
  removed.sort(internal.ordinalCompare);
  return { status: 'clean', removed };
}

function formatDiagnostic(error) {
  const code =
    error instanceof NativeCleanError && typeof error.code === 'string'
      ? error.code
      : 'MOXLEY_NATIVE_CLEAN_FAILED';
  const message =
    error instanceof NativeCleanError && typeof error.message === 'string'
      ? error.message
      : 'Native clean failed.';
  return `${code}: ${message}`
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
}

module.exports = Object.freeze({
  __test: Object.freeze({
    connectLeaseOnce,
    runClean,
  }),
});

if (require.main === module) {
  if (process.argv.length !== 2) {
    process.stderr.write(
      'MOXLEY_NATIVE_CLEAN_ARGUMENT_INVALID: Native clean accepts no arguments.\n',
    );
    process.exitCode = 1;
  } else {
    runClean()
      .then((result) => {
        process.stdout.write(internal.canonicalJson(result));
      })
      .catch((error) => {
        process.stderr.write(`${formatDiagnostic(error)}\n`);
        process.exitCode = 1;
      });
  }
}
