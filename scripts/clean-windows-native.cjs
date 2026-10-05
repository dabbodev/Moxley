'use strict';

const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { internal } = require('./build-windows-native.cjs');

const RETENTION_REQUIRED_MESSAGE =
  'Native build evidence requires retention; clean removal is not authorized.';
const DISPOSITION_INVALID_MESSAGE =
  'Native build disposition evidence is invalid.';
const PHYSICAL_CLEANUP_DEFERRED_MESSAGE =
  'Secure physical cleanup is unavailable; native build state was retained.';
const CLEAN_SCENARIO_MODES = Object.freeze([
  'absent',
  'artifact-only',
  'receipt-only',
  'artifact-and-receipt',
  'staging-without-lock',
  'v2-active',
  'legacy-v1',
  'legacy-v1-sidecar',
  'termination-unconfirmed',
  'invalid-sidecar-zero',
  'invalid-sidecar-partial',
  'invalid-sidecar-bom',
  'invalid-sidecar-crlf',
  'invalid-sidecar-embedded-lf',
  'invalid-sidecar-padding',
  'invalid-sidecar-reordered-keys',
  'invalid-sidecar-extra-key',
  'invalid-sidecar-unknown-state',
  'invalid-sidecar-invalid-reason',
  'orphan-sidecar',
  'invalid-sidecar-lock-version-mismatch',
  'invalid-sidecar-repository-key-mismatch',
  'invalid-sidecar-pipe-name-mismatch',
  'invalid-sidecar-staging-name-mismatch',
  'invalid-sidecar-nonce-mismatch',
  'unknown-lock-version',
  'positive',
]);

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

function identityChangedError() {
  return cleanError(
    'MOXLEY_NATIVE_CLEAN_IDENTITY_CHANGED',
    'A native clean target identity changed.',
  );
}

function retentionRequiredError() {
  return cleanError(
    'MOXLEY_NATIVE_CLEAN_RETENTION_REQUIRED',
    RETENTION_REQUIRED_MESSAGE,
  );
}

function dispositionInvalidError() {
  return cleanError(
    'MOXLEY_NATIVE_CLEAN_DISPOSITION_INVALID',
    DISPOSITION_INVALID_MESSAGE,
  );
}

function physicalCleanupDeferredError() {
  return cleanError(
    'MOXLEY_NATIVE_CLEAN_PHYSICAL_CLEANUP_DEFERRED',
    PHYSICAL_CLEANUP_DEFERRED_MESSAGE,
  );
}

function recordEvent(control, event) {
  if (control !== null) control.events.push(event);
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
  let rootMetadata;
  try {
    rootMetadata = await internal.authenticatePath(
      internal.PACKAGE_ROOT,
      'directory',
    );
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
    rootIdentity: internal.identityOf(rootMetadata),
    repositoryKey: key,
    pipeName: internal.pipeNameForKey(key),
  });
}

async function authenticateOptionalExisting(
  root,
  target,
  expectedType,
  control,
) {
  const relative = repositoryRelative(root, target);
  const before = await existingMetadata(target);
  if (before === null) {
    recordEvent(control, `authenticate-absent:${relative}`);
    return null;
  }
  const authenticated = await authenticateExisting(target, expectedType);
  const beforeIdentity = internal.identityOf(before);
  if (
    !internal.sameIdentity(
      authenticated,
      beforeIdentity,
      expectedType === 'file',
    )
  ) {
    throw identityChangedError();
  }
  const item = Object.freeze({
    target,
    relative,
    identity: internal.identityOf(authenticated),
  });
  recordEvent(control, `authenticate:${relative}`);
  return item;
}

async function readCarrierItem(item) {
  if (
    item.identity.size <= 0n ||
    item.identity.size > BigInt(internal.MAX_CARRIER_BYTES)
  ) {
    return Object.freeze({ ...item, bytes: null });
  }

  let handle;
  let bytes = null;
  let readFailed = false;
  try {
    handle = await fsp.open(item.target, 'r');
    const metadata = await handle.stat({ bigint: true });
    if (!internal.sameIdentity(metadata, item.identity)) {
      throw identityChangedError();
    }
    bytes = await internal.readBoundedCarrier(handle);
  } catch (error) {
    if (error instanceof NativeCleanError) throw error;
    readFailed = true;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        readFailed = true;
      }
    }
  }

  await requireSameIdentity(item);
  return Object.freeze({
    ...item,
    bytes: readFailed || !Buffer.isBuffer(bytes) ? null : bytes,
  });
}

async function authenticateLock(context, paths, control) {
  const item = await authenticateOptionalExisting(
    context.canonicalRoot,
    paths.lock,
    'file',
    control,
  );
  if (item === null) return null;

  const carrier = await readCarrierItem(item);
  let classification;
  try {
    if (carrier.bytes === null) throw new Error();
    classification = internal.classifyLockCarrierBytes(
      carrier.bytes,
      context.repositoryKey,
      context.pipeName,
    );
    if (
      classification === null ||
      typeof classification !== 'object' ||
      !['LEGACY_V1', 'ACTIVE_V2'].includes(classification.kind) ||
      classification.record === null ||
      typeof classification.record !== 'object'
    ) {
      throw new Error();
    }
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  return Object.freeze({ ...carrier, classification });
}

async function authenticateDisposition(context, paths, shouldRead, control) {
  const item = await authenticateOptionalExisting(
    context.canonicalRoot,
    paths.disposition,
    'file',
    control,
  );
  if (item === null || !shouldRead) return item;
  return readCarrierItem(item);
}

async function authenticateRemovalFile(root, target, control) {
  return authenticateOptionalExisting(root, target, 'file', control);
}

async function authenticateStaging(root, release, lock, control) {
  const staging = path.join(release, lock.record.stagingName);
  if (!internal.isStrictDescendant(release, staging)) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
      'Native build staging is outside the clean boundary.',
    );
  }
  const metadata = await existingMetadata(staging);
  if (metadata === null) {
    recordEvent(
      control,
      `authenticate-absent:${repositoryRelative(root, staging)}`,
    );
    return null;
  }
  const authenticated = await authenticateExisting(staging, 'directory');
  if (!internal.sameIdentity(authenticated, internal.identityOf(metadata), false)) {
    throw identityChangedError();
  }
  let inventory;
  try {
    inventory = await internal.inventoryStagingTree(
      staging,
      new Set(internal.STAGING_FILE_NAMES),
      true,
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
  const result = Object.freeze({
    target: staging,
    relative: repositoryRelative(root, staging),
    identity: internal.identityOf(authenticated),
    files: Object.freeze(files),
    directories: Object.freeze(directories),
  });
  recordEvent(control, `authenticate:${result.relative}`);
  for (const item of result.files) {
    recordEvent(control, `authenticate:${item.relative}`);
  }
  for (const item of result.directories) {
    recordEvent(control, `authenticate:${item.relative}`);
  }
  return result;
}

async function requireSameIdentity(item, includeSize = true) {
  const metadata = await existingMetadata(item.target);
  if (
    metadata === null ||
    !internal.sameIdentity(metadata, item.identity, includeSize)
  ) {
    throw identityChangedError();
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

async function confirmIdentity(item, phase, control) {
  await requireSameIdentity(item, item.identity.type === 'file');
  recordEvent(control, `${phase}:${item.relative}`);
}

function stagingTargetItems(staging) {
  if (staging === null) return [];
  return [...staging.files, ...staging.directories, staging];
}

function plannedTargetItems(plan) {
  return [
    ...stagingTargetItems(plan.staging),
    ...(plan.artifact === null ? [] : [plan.artifact]),
    ...(plan.receipt === null ? [] : [plan.receipt]),
    ...(plan.disposition === null ? [] : [plan.disposition]),
    ...(plan.lock === null ? [] : [plan.lock]),
  ];
}

async function confirmSafetyPlan(plan, control) {
  const items = [
    plan.root,
    ...(plan.build === null ? [] : [plan.build]),
    ...(plan.release === null ? [] : [plan.release]),
    ...(plan.lock === null ? [] : [plan.lock]),
    ...(plan.disposition === null ? [] : [plan.disposition]),
    ...(plan.artifact === null ? [] : [plan.artifact]),
    ...(plan.receipt === null ? [] : [plan.receipt]),
    ...stagingTargetItems(plan.staging),
  ];
  for (const item of items) await confirmIdentity(item, 'confirm', control);
}

async function reauthenticateRetentionPlan(plan, control) {
  await confirmIdentity(plan.root, 'ancestor', control);
  if (plan.build !== null) {
    await confirmIdentity(plan.build, 'ancestor', control);
  }
  if (plan.release !== null) {
    await confirmIdentity(plan.release, 'ancestor', control);
  }
  for (const item of plannedTargetItems(plan)) {
    await confirmIdentity(item, 'reauthenticate', control);
  }
}

async function createSafetyPlan(context, control) {
  const placeholder = `${internal.STAGING_PREFIX}${'a'.repeat(32)}`;
  const paths = internal.packagePaths(context.canonicalRoot, placeholder);
  const root = Object.freeze({
    target: context.canonicalRoot,
    relative: '.',
    identity: context.rootIdentity,
  });
  const build = await authenticateOptionalExisting(
    context.canonicalRoot,
    paths.build,
    'directory',
    control,
  );
  const release = await authenticateOptionalExisting(
    context.canonicalRoot,
    paths.release,
    'directory',
    control,
  );
  if (release === null) {
    return Object.freeze({
      paths,
      root,
      build,
      release,
      lock: null,
      disposition: null,
      artifact: null,
      receipt: null,
      staging: null,
    });
  }

  const lock = await authenticateLock(context, paths, control);
  const disposition = await authenticateDisposition(
    context,
    paths,
    lock === null || lock.classification.kind === 'ACTIVE_V2',
    control,
  );
  const artifact = await authenticateRemovalFile(
    context.canonicalRoot,
    paths.artifact,
    control,
  );
  const receipt = await authenticateRemovalFile(
    context.canonicalRoot,
    paths.receipt,
    control,
  );

  let entries;
  try {
    entries = await fsp.readdir(paths.release, { withFileTypes: true });
  } catch {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_PATH_INVALID',
      'A native clean path could not be authenticated.',
    );
  }
  const stagingNames = entries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(internal.STAGING_PREFIX))
    .sort(internal.ordinalCompare);
  if (
    (lock === null && stagingNames.length !== 0) ||
    (lock !== null &&
      stagingNames.some(
        (name) => name !== lock.classification.record.stagingName,
      ))
  ) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
      'Unauthenticated native build staging exists.',
    );
  }
  const staging =
    lock === null
      ? null
      : await authenticateStaging(
          context.canonicalRoot,
          paths.release,
          lock.classification,
          control,
        );

  return Object.freeze({
    paths,
    root,
    build,
    release,
    lock,
    disposition,
    artifact,
    receipt,
    staging,
  });
}

function classifyCleanupAuthority(plan, control) {
  if (plan.lock === null) {
    recordEvent(control, 'classify:LOCKLESS');
    if (plan.disposition !== null) throw dispositionInvalidError();
    if (plan.artifact !== null || plan.receipt !== null) {
      throw retentionRequiredError();
    }
    return 'LOCKLESS';
  }

  if (plan.lock.classification.kind === 'LEGACY_V1') {
    recordEvent(control, 'classify:LEGACY_V1');
    throw retentionRequiredError();
  }

  if (plan.disposition === null) {
    recordEvent(control, 'classify:ACTIVE_V2');
    throw retentionRequiredError();
  }

  let disposition;
  try {
    if (plan.disposition.bytes === null) throw new Error();
    disposition = internal.decodeDispositionBytes(
      plan.disposition.bytes,
      plan.lock.classification.record,
    );
  } catch {
    throw dispositionInvalidError();
  }

  if (disposition.disposition === 'TERMINATION_UNCONFIRMED') {
    recordEvent(control, 'classify:TERMINATION_UNCONFIRMED');
    throw retentionRequiredError();
  }
  if (disposition.disposition !== 'CLEAN_AUTHORIZED') {
    throw dispositionInvalidError();
  }
  recordEvent(control, 'classify:CLEAN_AUTHORIZED');
  return 'CLEAN_AUTHORIZED';
}

async function invokeControlHook(control, name) {
  if (control === null || control[name] === undefined) return;
  if (typeof control[name] !== 'function') {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_TEST_INVALID',
      'Native clean test control is invalid.',
    );
  }
  await control[name](control.plan);
}

async function deferPhysicalCleanup(plan, control) {
  await reauthenticateRetentionPlan(plan, control);
  recordEvent(control, 'defer:physical-cleanup');
  throw physicalCleanupDeferredError();
}

async function runCleanForContext(context, control = null) {
  const plan = await createSafetyPlan(context, control);
  if (control !== null) control.plan = plan;

  await invokeControlHook(control, 'beforeAuthority');
  await confirmSafetyPlan(plan, control);

  const active = await connectLeaseOnce(context.pipeName);
  recordEvent(control, active ? 'lease:active' : 'lease:absent');
  if (active) {
    throw cleanError(
      'MOXLEY_NATIVE_CLEAN_BUSY',
      'An active cooperating native build exists.',
    );
  }

  const authority = classifyCleanupAuthority(plan, control);
  if (authority === 'LOCKLESS') {
    return Object.freeze({ status: 'clean', removed: Object.freeze([]) });
  }
  await invokeControlHook(control, 'afterAuthority');
  return deferPhysicalCleanup(plan, control);
}

async function runClean() {
  return runCleanForContext(await authenticateRoot());
}

const SCENARIO_STAGING_NAME = `${internal.STAGING_PREFIX}${'d'.repeat(32)}`;
const SCENARIO_NONCE = 'e'.repeat(32);
const SCENARIO_TELEMETRY_NAME = `vstel${'f'.repeat(32)}`;

function scenarioError() {
  return cleanError(
    'MOXLEY_NATIVE_CLEAN_TEST_INVALID',
    'Native clean test scenario is invalid.',
  );
}

async function scenarioContext(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw scenarioError();
  }
  let canonicalRoot;
  let canonicalTempRoot;
  let rootMetadata;
  try {
    canonicalTempRoot = await fsp.realpath(os.tmpdir());
    rootMetadata = await internal.authenticatePath(root, 'directory');
    canonicalRoot = await fsp.realpath(root);
  } catch {
    throw scenarioError();
  }
  if (
    !internal.sameWindowsPath(canonicalRoot, root) ||
    !internal.sameWindowsPath(path.dirname(canonicalRoot), canonicalTempRoot) ||
    !path.basename(canonicalRoot).startsWith('moxley-native-build-test-')
  ) {
    throw scenarioError();
  }
  const repositoryKey = internal.repositoryKey(canonicalRoot);
  return Object.freeze({
    canonicalRoot,
    rootIdentity: internal.identityOf(rootMetadata),
    repositoryKey,
    pipeName: internal.pipeNameForKey(repositoryKey),
  });
}

async function createScenarioDirectories(paths) {
  try {
    await fsp.mkdir(paths.build, { recursive: false });
    await fsp.mkdir(paths.release, { recursive: false });
  } catch {
    throw scenarioError();
  }
}

async function writeScenarioFile(target, bytes) {
  try {
    await fsp.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  } catch {
    throw scenarioError();
  }
}

function changedHex(value) {
  return `${value[0] === 'f' ? 'e' : 'f'}${value.slice(1)}`;
}

function scenarioDispositionBytes(mode, lock) {
  const positive = internal.createDispositionRecord(
    lock,
    'CLEAN_AUTHORIZED',
    null,
    null,
  );
  const negative = internal.createDispositionRecord(
    lock,
    'TERMINATION_UNCONFIRMED',
    'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
    'SUBPROCESS_EXIT_WITHOUT_CLOSE',
  );
  const canonicalPositive = Buffer.from(internal.canonicalJson(positive), 'utf8');

  if (
    [
      'positive',
      'orphan-sidecar',
    ].includes(mode)
  ) {
    return canonicalPositive;
  }
  if (mode === 'termination-unconfirmed') {
    return Buffer.from(internal.canonicalJson(negative), 'utf8');
  }
  if (mode === 'invalid-sidecar-zero') return Buffer.alloc(0);
  if (mode === 'invalid-sidecar-partial') {
    return canonicalPositive.subarray(0, canonicalPositive.length - 1);
  }
  if (mode === 'invalid-sidecar-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalPositive]);
  }
  if (mode === 'invalid-sidecar-crlf') {
    return Buffer.concat([
      canonicalPositive.subarray(0, canonicalPositive.length - 1),
      Buffer.from('\r\n', 'utf8'),
    ]);
  }
  if (mode === 'invalid-sidecar-embedded-lf') {
    return Buffer.concat([
      canonicalPositive.subarray(0, 1),
      Buffer.from('\n', 'utf8'),
      canonicalPositive.subarray(1),
    ]);
  }
  if (mode === 'invalid-sidecar-padding') {
    return Buffer.concat([Buffer.from(' ', 'utf8'), canonicalPositive]);
  }
  if (mode === 'invalid-sidecar-reordered-keys') {
    return Buffer.from(
      internal.canonicalJson({
        dispositionVersion: positive.dispositionVersion,
        dispositionFormat: positive.dispositionFormat,
        lockVersion: positive.lockVersion,
        repositoryKey: positive.repositoryKey,
        pipeName: positive.pipeName,
        stagingName: positive.stagingName,
        nonce: positive.nonce,
        disposition: positive.disposition,
        reason: positive.reason,
        causeReason: positive.causeReason,
      }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-extra-key') {
    return Buffer.from(
      internal.canonicalJson({ ...positive, extra: null }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-unknown-state') {
    return Buffer.from(
      internal.canonicalJson({ ...positive, disposition: 'UNKNOWN' }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-invalid-reason') {
    return Buffer.from(
      internal.canonicalJson({ ...negative, reason: 'INVALID_REASON' }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-lock-version-mismatch') {
    return Buffer.from(
      internal.canonicalJson({ ...positive, lockVersion: 1 }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-repository-key-mismatch') {
    return Buffer.from(
      internal.canonicalJson({
        ...positive,
        repositoryKey: changedHex(positive.repositoryKey),
      }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-pipe-name-mismatch') {
    return Buffer.from(
      internal.canonicalJson({
        ...positive,
        pipeName: internal.pipeNameForKey(changedHex(positive.repositoryKey)),
      }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-staging-name-mismatch') {
    return Buffer.from(
      internal.canonicalJson({
        ...positive,
        stagingName: `${internal.STAGING_PREFIX}${'f'.repeat(32)}`,
      }),
      'utf8',
    );
  }
  if (mode === 'invalid-sidecar-nonce-mismatch') {
    return Buffer.from(
      internal.canonicalJson({ ...positive, nonce: 'f'.repeat(32) }),
      'utf8',
    );
  }
  throw scenarioError();
}

async function createScenarioGeneratedState(paths) {
  try {
    await fsp.mkdir(paths.staging, { recursive: false });
    await fsp.writeFile(
      path.join(paths.staging, 'moxley-windows-reparse.obj'),
      Buffer.from('object', 'utf8'),
      { flag: 'wx' },
    );
    const microsoft = path.join(paths.staging, 'Microsoft');
    const insights = path.join(microsoft, 'VSApplicationInsights');
    await fsp.mkdir(microsoft, { recursive: false });
    await fsp.mkdir(insights, { recursive: false });
    await fsp.mkdir(path.join(insights, SCENARIO_TELEMETRY_NAME), {
      recursive: false,
    });
    await fsp.writeFile(paths.artifact, Buffer.from('binary', 'utf8'), {
      flag: 'wx',
    });
    await fsp.writeFile(paths.receipt, Buffer.from('{}\n', 'utf8'), {
      flag: 'wx',
    });
  } catch {
    throw scenarioError();
  }
}

function frozenScenarioPaths(paths) {
  return Object.freeze({
    artifact: paths.artifact,
    receipt: paths.receipt,
    lock: paths.lock,
    disposition: paths.disposition,
    staging: paths.staging,
  });
}

async function setupCleanScenario(context, mode) {
  const basePaths = internal.packagePaths(
    context.canonicalRoot,
    SCENARIO_STAGING_NAME,
  );

  if (mode === 'positive') {
    const lockExists = await internal.exists(basePaths.lock);
    const dispositionExists = await internal.exists(basePaths.disposition);
    if (lockExists || dispositionExists) {
      if (!lockExists || !dispositionExists) throw scenarioError();
      let stagingName = SCENARIO_STAGING_NAME;
      try {
        const classification = internal.classifyLockCarrierBytes(
          await fsp.readFile(basePaths.lock),
          context.repositoryKey,
          context.pipeName,
        );
        stagingName = classification.record.stagingName;
      } catch {
        // The real clean path reports the authoritative carrier error.
      }
      return frozenScenarioPaths(
        internal.packagePaths(context.canonicalRoot, stagingName),
      );
    }
  }

  if (mode === 'absent') return frozenScenarioPaths(basePaths);

  await createScenarioDirectories(basePaths);

  if (
    ['artifact-only', 'receipt-only', 'artifact-and-receipt'].includes(mode)
  ) {
    if (mode !== 'receipt-only') {
      await writeScenarioFile(
        basePaths.artifact,
        Buffer.from('binary', 'utf8'),
      );
    }
    if (mode !== 'artifact-only') {
      await writeScenarioFile(
        basePaths.receipt,
        Buffer.from('{}\n', 'utf8'),
      );
    }
    return frozenScenarioPaths(basePaths);
  }
  if (mode === 'staging-without-lock') {
    await fsp.mkdir(basePaths.staging, { recursive: false });
    await writeScenarioFile(
      path.join(basePaths.staging, 'moxley-windows-reparse.obj'),
      Buffer.from('object', 'utf8'),
    );
    return frozenScenarioPaths(basePaths);
  }

  const v1 = internal.createLockRecord(
    context.repositoryKey,
    context.pipeName,
    SCENARIO_STAGING_NAME,
    SCENARIO_NONCE,
  );
  const v2 = internal.createV2LockRecord(
    context.repositoryKey,
    context.pipeName,
    SCENARIO_STAGING_NAME,
    SCENARIO_NONCE,
  );
  const orphan = mode === 'orphan-sidecar';
  const legacy = mode === 'legacy-v1' || mode === 'legacy-v1-sidecar';
  const unknownLock = mode === 'unknown-lock-version';

  if (!orphan) {
    const record = unknownLock ? { ...v2, lockVersion: 3 } : legacy ? v1 : v2;
    await writeScenarioFile(
      basePaths.lock,
      Buffer.from(internal.canonicalJson(record), 'utf8'),
    );
  }

  if (mode === 'legacy-v1-sidecar') {
    await writeScenarioFile(
      basePaths.disposition,
      Buffer.from('not-json\n', 'utf8'),
    );
  } else if (
    !['v2-active', 'legacy-v1', 'unknown-lock-version'].includes(mode)
  ) {
    await writeScenarioFile(
      basePaths.disposition,
      scenarioDispositionBytes(mode, v2),
    );
  }

  if (orphan) {
    await writeScenarioFile(basePaths.artifact, Buffer.from('binary', 'utf8'));
    await writeScenarioFile(basePaths.receipt, Buffer.from('{}\n', 'utf8'));
  } else {
    await createScenarioGeneratedState(basePaths);
  }
  return frozenScenarioPaths(basePaths);
}

async function retainedScenarioState(paths) {
  const [artifact, receipt, lock, disposition, staging] = await Promise.all([
    internal.exists(paths.artifact),
    internal.exists(paths.receipt),
    internal.exists(paths.lock),
    internal.exists(paths.disposition),
    internal.exists(paths.staging),
  ]);
  return Object.freeze({ artifact, receipt, lock, disposition, staging });
}

async function exerciseCleanScenario(root, mode, hooks = null) {
  if (
    !CLEAN_SCENARIO_MODES.includes(mode) ||
    (hooks !== null &&
      (typeof hooks !== 'object' ||
        Object.keys(hooks).some(
          (name) =>
            !['beforeAuthority', 'afterAuthority'].includes(name) ||
            typeof hooks[name] !== 'function',
        )))
  ) {
    throw scenarioError();
  }
  const context = await scenarioContext(root);
  const paths = await setupCleanScenario(context, mode);
  const control = {
    mode,
    events: [],
    plan: null,
    beforeAuthority: hooks?.beforeAuthority,
    afterAuthority: hooks?.afterAuthority,
  };
  let result;
  let error = null;
  try {
    result = await runCleanForContext(context, control);
  } catch (caught) {
    error = caught;
  }

  const status = error === null ? 'clean' : 'error';
  const code =
    error === null
      ? null
      : error instanceof NativeCleanError && typeof error.code === 'string'
        ? error.code
        : 'MOXLEY_NATIVE_CLEAN_FAILED';
  const message =
    error === null
      ? null
      : error instanceof NativeCleanError && typeof error.message === 'string'
        ? error.message
        : 'Native clean failed.';
  return Object.freeze({
    mode,
    status,
    code,
    message,
    removed: Object.freeze(error === null ? [...result.removed] : []),
    events: Object.freeze([...control.events]),
    paths,
    retained: await retainedScenarioState(paths),
  });
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
    exerciseCleanScenario,
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
