'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
} = require('node:test');

const buildModule = require('../scripts/build-windows-native.cjs');
const cleanModule = require('../scripts/clean-windows-native.cjs');
const { internal } = buildModule;
const buildTest = buildModule.__test;
const cleanTest = cleanModule.__test;

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const BUILD_SCRIPT = path.join(
  REPOSITORY_ROOT,
  'scripts',
  'build-windows-native.cjs',
);
const CLEAN_SCRIPT = path.join(
  REPOSITORY_ROOT,
  'scripts',
  'clean-windows-native.cjs',
);
const SOURCE = path.join(
  REPOSITORY_ROOT,
  'native',
  'windows-reparse-classifier.c',
);
const OLD_SOURCE = path.join(
  REPOSITORY_ROOT,
  'test',
  'native',
  'windows-reparse-classifier.c',
);
const RELEASE = path.join(REPOSITORY_ROOT, 'build', 'Release');
const ARTIFACT = path.join(
  RELEASE,
  'moxley-windows-reparse.node',
);
const RECEIPT = path.join(
  RELEASE,
  'moxley-windows-reparse.receipt.json',
);
const LOCK = path.join(
  RELEASE,
  '.moxley-windows-reparse-build.lock',
);
const DISPOSITION = path.join(
  RELEASE,
  '.moxley-windows-reparse-build.disposition.json',
);
const STAGING_PREFIX = '.moxley-windows-reparse-stage-';
const HARNESS_PROCESS_TIMEOUT_MS = 300_000;
const D1_DIAGNOSTIC_TIMEOUT_MS = 180_000;
const D1_READ_ONLY_CHECK_TIMEOUT_MS = 15_000;
const MAX_D1_SUPERVISOR_RECEIPT_BYTES = 2048;
const POWERSHELL_EXE = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SUBPROCESS_CODES = Object.freeze({
  spawn: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED',
  timeout: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_TIMED_OUT',
  output: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_OUTPUT_LIMIT',
  exit: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
  termination:
    'MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED',
});
const SUBPROCESS_REASONS = Object.freeze([
  'SUBPROCESS_SPAWN_ERROR',
  'SUBPROCESS_TIMEOUT',
  'SUBPROCESS_STDOUT_LIMIT',
  'SUBPROCESS_STDERR_LIMIT',
  'SUBPROCESS_NONZERO_EXIT',
  'SUBPROCESS_SIGNALLED_EXIT',
  'SUBPROCESS_EXIT_WITHOUT_CLOSE',
  'SUBPROCESS_TERMINATION_TOOL_FAILED',
  'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
]);
const LOCK_V2_KEYS = Object.freeze([
  'lockFormat',
  'lockVersion',
  'repositoryKey',
  'pipeName',
  'stagingName',
  'nonce',
  'disposition',
]);
const DISPOSITION_KEYS = Object.freeze([
  'dispositionFormat',
  'dispositionVersion',
  'lockVersion',
  'repositoryKey',
  'pipeName',
  'stagingName',
  'nonce',
  'disposition',
  'reason',
  'causeReason',
]);
const CARRIER_FAULTS = Object.freeze([
  'create',
  'write-zero',
  'write-partial',
  'sync',
  'close',
  'authentication',
  'readback',
]);
const POSITIVE_ACKNOWLEDGEMENT_FAULTS = Object.freeze([
  'sync',
  'close',
  'authentication',
  'readback',
]);
// Test-only observation semantics; production build/clean stay separate.
function createDualChannelObservation() {
// Exact weak observation only; native arrays are returned untouched.
const TARGET_CAPACITY = 4;
const RELATIONSHIP_CAPACITY = 128;
const CATEGORIES = ['DIAGNOSTIC_TRANSPORT_OWNED', 'WORKLOAD_OWNED', 'TEST_PARENT_OWNED', 'UNKNOWN_OWNERSHIP'];
const PHASES = ['baseline', 'settled', 'I1', 'I2', 'I4', 'I8'];
function name(object) { try { return object?.constructor?.name || 'Unknown'; } catch { return 'Unknown'; } }
function primitiveSnapshot(value) {
  let nodes = 0;
  function project(x, depth) {
    if (++nodes > 8192 || depth > 20) throw new Error('snapshot-bound');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'string' && x.length <= 16384) return x;
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (!x || typeof x !== 'object') throw new Error('snapshot-nonprimitive');
    if (Array.isArray(x)) {
      if (x.length > 512) throw new Error('snapshot-array-bound');
      return Object.freeze(x.map(v => project(v, depth + 1)));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(x))) throw new Error('snapshot-native-reference');
    const keys = Object.keys(x);
    if (keys.length > 512) throw new Error('snapshot-object-bound');
    const out = {};
    for (const k of keys) Object.defineProperty(out, k, { value: project(x[k], depth + 1), enumerable: true });
    return Object.freeze(out);
  }
  return project(value, 0);
}
class DualChannel {
  #baseline = { handles: new WeakSet(), requests: new WeakSet() };
  #baselineRequestRows = [];
  #previousRequests = [];
  #requestIds = new WeakMap();
  #nextRequestId = 0;
  #baselineRequestCounts = {};
  #valid = true;
  #reasons = [];
  #phases = [];
  #cohort = new WeakSet();
  #selected = false;
  invalidate(reason) { this.#valid = false; if (!this.#reasons.includes(reason)) this.#reasons.push(reason); }
  captureSameCall(phase, sampler, owner, registry, append, lifecycle) {
    const originals = { handles: process._getActiveHandles, requests: process._getActiveRequests };
    const calls = { handles: 0, requests: 0 };
    const refs = { handles: [], requests: [] };
    const preserved = { handles: true, requests: true };
    const thisTier = this;
    for (const [kind, key] of [['handles', '_getActiveHandles'], ['requests', '_getActiveRequests']]) {
      process[key] = function (...args) {
        calls[kind]++;
        const array = Reflect.apply(originals[kind], this, args);
        const copy = array.slice();
        refs[kind] = array.map(x => new WeakRef(x));
        if (phase === 'baseline') for (const x of array) thisTier.#baseline[kind].add(x);
        preserved[kind] = copy.length === array.length && copy.every((x, i) => x === array[i]);
        return array;
      };
    }
    let historical;
    try { historical = sampler(); }
    finally {
      process._getActiveHandles = originals.handles;
      process._getActiveRequests = originals.requests;
    }
    const integrity = { calls, preserved, restored: process._getActiveHandles === originals.handles && process._getActiveRequests === originals.requests, exactArrayReturned: true };
    if (phase !== PHASES[this.#phases.length] || calls.handles !== 1 || calls.requests !== 1 || !preserved.handles || !preserved.requests || !integrity.restored) this.invalidate('same-snapshot-integrity');
    const state = registry.state();
    if (!state.valid) this.invalidate('relationship-registry-invalid');
    const counts = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    let table = [];
    const handleRefs = refs.handles.map(r => r.deref()).filter(x => x && !this.#baseline.handles.has(x));
    const requestRefs = refs.requests.map(r => r.deref()).filter(Boolean);
    if (new Set(requestRefs).size !== requestRefs.length) this.invalidate('duplicate-request-reference');
    const actualRequestCounts = {};
    for (const x of requestRefs) actualRequestCounts[name(x)] = (actualRequestCounts[name(x)] || 0) + 1;
    if (phase === 'baseline') this.#baselineRequestCounts = { ...actualRequestCounts };
    const expectedRequestDelta = Object.fromEntries(Object.entries(actualRequestCounts).map(([n,c]) => [n,c-(this.#baselineRequestCounts[n] || 0)]).filter(([,c]) => c > 0));
    const observedRequestDelta = phase === 'baseline' ? {} : historical?.requestDeltas;
    if (!observedRequestDelta || JSON.stringify(Object.entries(expectedRequestDelta).sort()) !== JSON.stringify(Object.entries(observedRequestDelta).sort())) this.invalidate('raw-request-constructor-delta-mismatch');
    const handleCounts = {};
    for (const x of handleRefs) handleCounts[name(x)] = (handleCounts[name(x)] || 0) + 1;
    const observedHandleDelta = phase === 'baseline' ? {} : historical?.handleDeltas;
    if (!observedHandleDelta || JSON.stringify(Object.entries(handleCounts).sort()) !== JSON.stringify(Object.entries(observedHandleDelta).filter(([,n])=>n>0).sort())) this.invalidate('raw-positive-reference-count-mismatch');
    const previousMembership = new WeakSet(this.#previousRequests.map(r => r.reference.deref()).filter(Boolean));
    const currentMembership = new WeakSet(requestRefs);
    const previousConstructors = new Set(this.#previousRequests.map(r => r.constructor));
    const currentRows = [];
    for (const [kind, objects] of [['handles',handleRefs],['requests',requestRefs]]) {
      for (const x of objects) {
        const provenance = owner(x, kind, phase) || {};
        const category = CATEGORIES.includes(provenance.category) ? provenance.category : 'UNKNOWN_OWNERSHIP';
        const expectedTransient = category === 'WORKLOAD_OWNED' && provenance.role === 'exclusive-lease-server' && provenance.exactLease === true && lifecycle?.leaseCloseDone === true && provenance.closeObserved === true && provenance.listening === false && ['settled', 'I1', 'I2', 'I4'].includes(phase);
        let requestId = null, continuity = null;
        if (kind === 'requests') {
          if (!this.#requestIds.has(x)) this.#requestIds.set(x, 'request-' + (++this.#nextRequestId));
          requestId = this.#requestIds.get(x);
          continuity = phase === 'baseline' ? 'BASELINE_REFERENCE' : previousMembership.has(x) ? 'PERSISTED_REFERENCE' : previousConstructors.has(name(x)) ? 'NEW_REFERENCE_SAME_CONSTRUCTOR' : 'NEW_REFERENCE_NEW_CONSTRUCTOR';
          currentRows.push({ reference: new WeakRef(x), requestId, constructor: name(x), category, role: provenance.role || null, provenance: provenance.proof || null, continuity });
        }
        table.push({ kind, constructor: name(x), category, role: provenance.role || null, provenance: provenance.proof || null, requestId, continuity, exactLease: provenance.exactLease === true, closeObserved: provenance.closeObserved === true, listening: provenance.listening ?? null, phaseState: kind === 'requests' && phase !== 'I8' ? 'REQUEST_OBSERVED_BEFORE_QUIESCENCE' : expectedTransient ? 'WORKLOAD_ACTIVE_EXPECTED' : 'WORKLOAD_QUIESCENCE_REQUIRED' });
        counts[category]++;
        if (kind === 'handles') {
          if (phase === 'I1') this.#cohort.add(x);
          else if (this.#selected && !this.#cohort.has(x)) this.invalidate('positive-reference-outside-fixed-cohort');
        }
      }
    }
    if (table.length > TARGET_CAPACITY) this.invalidate('target-capacity-exceeded');
    // Both history lists are weak and physically bounded by the unchanged cap.
    const retired = this.#previousRequests.filter(r => { const x=r.reference.deref(); return !x || !currentMembership.has(x); }).map(r => ({ requestId:r.requestId, constructor:r.constructor, category:r.category, role:r.role, provenance:r.provenance, continuity:'RETIRED_REFERENCE' }));
    if (phase === 'baseline') this.#baselineRequestRows = currentRows.slice(0,TARGET_CAPACITY);
    const baselinePresent = this.#baselineRequestRows.filter(r=> {const x=r.reference.deref();return x && currentMembership.has(x);}).length;
    const requestContinuity = { previousPhase: this.#phases.at(-1)?.phase || null, baselinePresent, baselineRetired: this.#baselineRequestRows.length-baselinePresent, present: currentRows.length, persisted: currentRows.filter(r=>r.continuity==='PERSISTED_REFERENCE').length, newlyPresent: currentRows.filter(r=>r.continuity.startsWith('NEW_REFERENCE')).length, retiredCount: retired.length, current: currentRows.map(({reference,...r})=>r), retired, constructorDelta: expectedRequestDelta };
    this.#previousRequests = currentRows.slice(0,TARGET_CAPACITY);
    if (phase === 'I1') this.#selected = true;
    // Requests before I8 are observations, including explicit unknown provenance.
    // They cannot establish a leak or block certification after exact retirement.
    const required = table.filter(r=>r.kind==='handles' || phase==='I8');
    const unknownRequired = required.filter(r=>r.category==='UNKNOWN_OWNERSHIP').length;
    const workloadRequired = required.filter(r=>r.category==='WORKLOAD_OWNED' && r.phaseState!=='WORKLOAD_ACTIVE_EXPECTED').length;
    let gate = !this.#valid ? 'INTEGRATION_INVALID' : unknownRequired > 0 ? 'UNKNOWN_OWNERSHIP_BLOCK' : workloadRequired > 0 ? 'WORKLOAD_LIFECYCLE_FAILURE' : 'PASS';
    if (phase === 'I8' && lifecycle?.leaseCloseDone !== true) { this.invalidate('lease-close-not-established'); gate = 'INTEGRATION_INVALID'; }
    if (!this.#valid) { table = []; for (const c of CATEGORIES) counts[c] = 0; }
    let record;
    try {
      record = primitiveSnapshot({ phase, raw: historical, integrity, ownership: table, counts, requestContinuity, requiredCounts:{unknown:unknownRequired,workload:workloadRequired}, workloadGate: gate, registry: state, lifecycle: lifecycle || null, boundary: phase === 'I8' ? 'WORKLOAD_QUIESCENCE_REQUIRED' : 'BOUNDED_TELEMETRY_RETIREMENT', valid: this.#valid });
      JSON.stringify(record); append(record);
    } catch {
      this.invalidate('evidence-append-or-serialization-failure');
      record = primitiveSnapshot({ phase, raw: null, integrity, ownership: [], counts:Object.fromEntries(CATEGORIES.map(c=>[c,0])), requestContinuity:null, requiredCounts:null, workloadGate:'INTEGRATION_INVALID', registry:state, lifecycle:null, boundary:phase==='I8'?'WORKLOAD_QUIESCENCE_REQUIRED':'BOUNDED_TELEMETRY_RETIREMENT', valid:false });
    }
    this.#phases.push(record);
    return historical;
  }
  result() {
    const terminal = this.#phases.find(r => r.phase === 'I8');
    const phasesPresent = PHASES.every(p => this.#phases.filter(r => r.phase === p).length === 1);
    const diagnosticPair = this.#phases.filter(r => r.phase !== 'baseline').every(r => ['diagnostic-stdout', 'diagnostic-stderr'].every(role => r.ownership.some(x => x.role === role && x.category === 'DIAGNOSTIC_TRANSPORT_OWNED')));
    const anyUnknown = this.#phases.some(r => r.workloadGate === 'UNKNOWN_OWNERSHIP_BLOCK');
    const anyFailure = this.#phases.some(r => r.workloadGate === 'WORKLOAD_LIFECYCLE_FAILURE');
    return primitiveSnapshot({ valid:this.#valid && phasesPresent, reasons:[...this.#reasons], targetCapacity:TARGET_CAPACITY, quiescenceBoundary: 'I8_EXISTING_CONTROLLER_TERMINAL', diagnosticPair, disposition: !this.#valid || !phasesPresent ? 'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID' : anyUnknown ? 'DUAL_CHANNEL_VALID_UNKNOWN_OWNERSHIP_BLOCK' : anyFailure ? 'DUAL_CHANNEL_VALID_WORKLOAD_LIFECYCLE_FAILURE_IDENTIFIED' : terminal?.workloadGate === 'PASS' && diagnosticPair ? 'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED' : 'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID', phases:this.#phases, terminalPhase:'I8', terminalSampleReused:true });
  }
}
return { DualChannel, primitiveSnapshot, TARGET_CAPACITY, RELATIONSHIP_CAPACITY, PHASES };
}

function createObservationRelationships() {
const RELATIONSHIP_CAPACITY = 128;
class RelationshipRegistry {
  #relationships = new WeakMap();
  #slots = [];
  #valid = true;
  #reason = null;
  #attempts = 0;
  #accepted = 0;
  #retired = 0;
  #peak = 0;
  #reap() {
    this.#slots = this.#slots.filter(ref => {
      const x = ref.deref();
      // Only the exact stream's two terminal properties release its slot.
      // The weak provenance remains, so a later raw positive is still classified.
      const terminal = x === undefined || (x.destroyed === true && x.closed === true);
      if (terminal) this.#retired++;
      return !terminal;
    });
  }
  register(object, label, owner) {
    this.#attempts++;
    if (!this.#valid) return false;
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null) { this.#valid = false; this.#reason = 'relationship-object-invalid'; return false; }
    this.#reap();
    if (this.#relationships.has(object)) {
      if (this.#relationships.get(object).label !== String(label)) { this.#valid = false; this.#reason = 'relationship-provenance-conflict'; return false; }
      return true;
    }
    if (this.#slots.length >= RELATIONSHIP_CAPACITY) { this.#valid = false; this.#reason = 'live-relationship-capacity-exceeded-at-129'; return false; }
    this.#relationships.set(object, { label: String(label), ownerOrdinal: Number.isInteger(owner?.ordinal) ? owner.ordinal : null, owner: owner?.object ? new WeakRef(owner.object) : null });
    this.#slots.push(new WeakRef(object)); this.#accepted++; this.#peak = Math.max(this.#peak, this.#slots.length); return true;
  }
  lookup(object) { return this.#valid ? this.#relationships.get(object)?.label || 'unattributed-target-socket' : 'unattributed-target-socket'; }
  state() { this.#reap(); return { capacity: RELATIONSHIP_CAPACITY, attempts: this.#attempts, accepted: this.#accepted, live: this.#slots.length, peak: this.#peak, retired: this.#retired, valid: this.#valid, reason: this.#reason, capacitySemantics: 'EXACT_UNTERMINATED_WEAK_RELATIONSHIPS' }; }
}
return { RelationshipRegistry, RELATIONSHIP_CAPACITY };
}

function createObservationController() {

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runCorrectedController(context) {
  const {
    witness,
    observerInvalid,
    richInvalid,
    markRichInvalid,
    evidenceInvalid,
    markEvidenceInvalid,
    captureSample,
    commitPhase,
    captureOneTurnConstructorEvidence,
    buildEvidence,
    phaseReached,
  } = context;

  async function safeCommit(phase, detail = {}) {
    if (evidenceInvalid()) {
      phaseReached(phase, { evidenceClass: 'PHASE_ONLY', ...detail });
      return { degraded: true, reason: 'EVIDENCE_APPEND_UNTRUSTWORTHY' };
    }
    try {
      await witness.observe(`append-chain:${phase}`, () => commitPhase(phase, detail));
      return { degraded: false };
    } catch (error) {
      markEvidenceInvalid(error);
      phaseReached(phase, {
        evidenceClass: 'PHASE_ONLY',
        degradation: 'EVIDENCE_APPEND_FAILED',
        errorCode: typeof error?.code === 'string' ? error.code : error?.message ?? null,
      });
      return { degraded: true, reason: 'EVIDENCE_APPEND_FAILED' };
    }
  }

  async function safeRichSample(name) {
    if (observerInvalid() || richInvalid()) {
      phaseReached(name, {
        evidenceClass: 'PHASE_ONLY',
        degradation: observerInvalid()
          ? 'SPAWN_OBSERVER_INVALID'
          : 'RICH_OBSERVER_INVALID',
      });
      return { captured: false, degraded: true };
    }
    try {
      await witness.observe(`capture-rich:${name}`, () => captureSample(name));
      phaseReached(name, { evidenceClass: 'RICH_IDENTITY' });
      return { captured: true, degraded: false };
    } catch (error) {
      markRichInvalid(error);
      phaseReached(name, {
        evidenceClass: 'PHASE_ONLY',
        degradation: 'RICH_SAMPLE_FAILED',
        errorCode: typeof error?.code === 'string' ? error.code : error?.message ?? null,
      });
      return { captured: false, degraded: true };
    }
  }

  await safeCommit('runbuild-settled-rejected', {
    observerState: observerInvalid() ? 'invalid' : 'valid',
  });
  await safeRichSample('settled');
  await safeCommit('settled', {
    evidenceClass: richInvalid() || observerInvalid() ? 'PHASE_ONLY' : 'RICH_IDENTITY',
  });

  await witness.observe('schedule-immediate-1', immediate, { nextPhaseScheduled: true });
  const oneTurnConstructorEvidence = await witness.observe(
    'capture-one-turn-constructor-evidence',
    captureOneTurnConstructorEvidence,
  );
  await safeRichSample('immediate-1');
  await safeCommit('immediate-1', {
    historicalObservationPoint: 'ONE_SET_IMMEDIATE_UNCHANGED',
    oneTurnConstructorEvidence,
  });

  await witness.observe('schedule-immediate-2', immediate, { nextPhaseScheduled: true });
  await safeRichSample('immediate-2');
  await safeCommit('immediate-2');

  await witness.observe('schedule-immediate-3', immediate, { nextPhaseScheduled: true });
  await witness.observe('schedule-immediate-4', immediate, { nextPhaseScheduled: true });
  await safeRichSample('immediate-4');
  await safeCommit('immediate-4');

  for (const turn of [5, 6, 7, 8]) {
    await witness.observe(`schedule-immediate-${turn}`, immediate, {
      nextPhaseScheduled: true,
    });
  }
  await safeRichSample('immediate-8');
  let terminalEvidence = null;
  if (!richInvalid() && !observerInvalid()) {
    try {
      terminalEvidence = await witness.observe('build-identity-evidence', buildEvidence);
    } catch (error) {
      markRichInvalid(error);
    }
  }
  await safeCommit('immediate-8', {
    evidenceClass:
      terminalEvidence === null ? 'PHASE_ONLY' : 'RICH_IDENTITY',
  });
  phaseReached('child-terminal-validation', {
    terminalStatus:
      richInvalid() || observerInvalid() || evidenceInvalid()
        ? 'VALID_DEGRADED'
        : 'VALID_RICH',
  });
  return {
    completed: true,
    richValid: !richInvalid() && !observerInvalid(),
    evidenceValid: !evidenceInvalid(),
    terminalEvidenceBuilt: terminalEvidence !== null,
  };
}

return { runCorrectedController };
}

function createDiagnosticOutputRelationships() {

const STDOUT_LABEL = 'diagnostic-process-output:stdout';
const STDERR_LABEL = 'diagnostic-process-output:stderr';

function constructorName(value) {
  try {
    return value && value.constructor && typeof value.constructor.name === 'string'
      ? value.constructor.name
      : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function registerDiagnosticProcessOutputs(relationships, stdoutReference, stderrReference) {
  if (constructorName(stdoutReference) !== 'Socket' || constructorName(stderrReference) !== 'Socket') {
    throw new Error('DIAGNOSTIC_OUTPUT_ENDPOINT_SOCKET_PREREQUISITE_FAILED');
  }
  const before = relationships.state();
  const stdoutAccepted = relationships.register(stdoutReference, STDOUT_LABEL, null);
  const stderrAccepted = relationships.register(stderrReference, STDERR_LABEL, null);
  return {
    registrations: [
      { role: 'stdout', label: STDOUT_LABEL, accepted: stdoutAccepted },
      { role: 'stderr', label: STDERR_LABEL, accepted: stderrAccepted },
    ],
    before,
    after: relationships.state(),
  };
}

return Object.freeze({
  STDERR_LABEL,
  STDOUT_LABEL,
  registerDiagnosticProcessOutputs,
});
}

const D1_DIAGNOSTIC_CHILD_SOURCE =
  [createDualChannelObservation, createObservationRelationships,
    createObservationController, createDiagnosticOutputRelationships]
    .map(factory => factory.toString()).join("\n") + String.raw`
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const childProcess = require('node:child_process');
const { DualChannel, primitiveSnapshot } = createDualChannelObservation();
const { RelationshipRegistry } = createObservationRelationships();
const { runCorrectedController } = createObservationController();
const { registerDiagnosticProcessOutputs, STDOUT_LABEL, STDERR_LABEL } =
  createDiagnosticOutputRelationships();
const registry = new RelationshipRegistry();
const tier = new DualChannel();
const owners = new WeakMap();
const servers = new WeakMap();
const originalSpawn = childProcess.spawn;
const originalCreateServer = net.createServer;
let workloadActive = false;
let observerValid = true;
let childOrdinal = 0;
let serverOrdinal = 0;
let stdoutReference = null;
let stderrReference = null;
let expectedPipe = null;
const lifecycle = { leaseCloseDone: false, productionPhases: [] };

// Observe exact wrapper return values without changing arguments, streams,
// cleanup, or leases. Rich identity allocation is not an ownership prerequisite.
childProcess.spawn = function (...args) {
  const child = Reflect.apply(originalSpawn, this, args);
  try {
    const ordinal = ++childOrdinal;
    for (const stream of ['stdin', 'stdout', 'stderr']) {
      const object = child[stream];
      if (!object) continue;
      const label = 'child:' + ordinal + ':' + stream;
      if (!registry.register(object, label, { ordinal, object: child })) {
        observerValid = false;
      }
      owners.set(object, { label, createdDuringWorkload: workloadActive });
    }
  } catch { observerValid = false; }
  return child;
};
net.createServer = function (...args) {
  const server = Reflect.apply(originalCreateServer, this, args);
  try {
    const record = {
      ordinal: ++serverOrdinal,
      createdDuringWorkload: workloadActive,
      closeObserved: false,
    };
    servers.set(server, record);
    server.once('close', () => { record.closeObserved = true; });
  } catch { observerValid = false; }
  return server;
};

// Load after installing return-value observers: build binds spawn at import.
const build = require(process.argv[1]);
const diagnostic = build.__test;
const runId = process.argv[2];
const observationPath = process.argv[3];
function owner(object, kind) {
  if (kind === 'requests') return null;
  const label = registry.lookup(object);
  if (object === stdoutReference && label === STDOUT_LABEL) {
    return { category: 'DIAGNOSTIC_TRANSPORT_OWNED', role: 'diagnostic-stdout',
      proof: 'exact process.stdout reference and registered STDOUT_LABEL' };
  }
  if (object === stderrReference && label === STDERR_LABEL) {
    return { category: 'DIAGNOSTIC_TRANSPORT_OWNED', role: 'diagnostic-stderr',
      proof: 'exact process.stderr reference and registered STDERR_LABEL' };
  }
  const stream = owners.get(object);
  if (stream && label === stream.label) {
    return { category: stream.createdDuringWorkload ? 'WORKLOAD_OWNED' : 'TEST_PARENT_OWNED',
      role: stream.label, proof: 'exact wrapper-returned reference and weak owner provenance' };
  }
  const server = servers.get(object);
  if (server) {
    let address;
    try { address = object.address(); } catch { observerValid = false; }
    const exactLease = server.createdDuringWorkload && address === expectedPipe;
    return { category: server.createdDuringWorkload ? 'WORKLOAD_OWNED' : 'TEST_PARENT_OWNED',
      role: exactLease ? 'exclusive-lease-server' : 'other-server',
      proof: 'exact net.createServer return, workload creation, independently derived pipe identity',
      exactLease, closeObserved: server.closeObserved, listening: object.listening };
  }
  return null;
}

async function main() {
  const reported = await diagnostic.repositoryLeaseIdentity();
  const canonicalRoot = await fsp.realpath(path.resolve(path.dirname(process.argv[1]), '..'));
  const key = build.internal.repositoryKey(canonicalRoot);
  expectedPipe = build.internal.pipeNameForKey(key);
  if (reported.canonicalRoot !== canonicalRoot || reported.repositoryKey !== key ||
      reported.pipeName !== expectedPipe) throw new Error('observation-lease-identity-invalid');
  if (observationPath !== path.join(canonicalRoot, '.section80-observation.json')) {
    throw new Error('observation-fixture-path-invalid');
  }
  const control = diagnostic.createDiagnosticControl(runId, bytes => {
    const written = fs.writeSync(process.stdout.fd, bytes);
    if (written === bytes.length) {
      const record = JSON.parse(bytes.toString('utf8'));
      lifecycle.productionPhases.push(record.phase);
      if (record.phase === 'LEASE_CLOSE_DONE') lifecycle.leaseCloseDone = true;
    }
    return written;
  });
  let baseline;
  const rawPhases = {};
  const sealed = [];
  function capture(phase) {
    if (!observerValid) tier.invalidate('relationship-observer-invalid');
    const raw = tier.captureSameCall(phase, () => {
      const snapshot = diagnostic.captureActiveEvidence();
      if (phase === 'baseline') return snapshot;
      const delta = diagnostic.compareActiveEvidence(baseline, snapshot);
      return { snapshot,
        handleDeltas: Object.fromEntries(delta.handles.delta.map(x => [x.type, x.count])),
        requestDeltas: Object.fromEntries(delta.requests.delta.map(x => [x.type, x.count])) };
    }, owner, registry, record => sealed.push(record), lifecycle);
    rawPhases[phase] = raw;
    return raw;
  }
  baseline = capture('baseline');
  // Lazy process outputs are acquired only after the original baseline sample.
  stdoutReference = process.stdout;
  stderrReference = process.stderr;
  const registration = registerDiagnosticProcessOutputs(registry, stdoutReference, stderrReference);
  if (!registration.registrations.every(r => r.accepted) || !registration.after.valid) {
    tier.invalidate('diagnostic-output-registration-invalid');
  }
  let rejected = null;
  workloadActive = true;
  try {
    await diagnostic.runBuildForDiagnostic(control);
    diagnostic.emitDiagnosticPhase(control, 'RUNBUILD_SETTLED_FULFILLED');
  } catch (error) {
    rejected = error;
    diagnostic.emitDiagnosticPhase(control, 'RUNBUILD_SETTLED_REJECTED', {
      code: typeof error?.code === 'string' ? error.code : 'MOXLEY_NATIVE_BUILD_FAILED',
    });
  } finally { workloadActive = false; }
  // The authenticated controller body is unchanged. Rich campaign instrumentation
  // is absent in ordinary tests; its degradation cannot disable the dual tier.
  await runCorrectedController({
    witness: { observe: async (_label, operation) => operation() },
    observerInvalid: () => !observerValid,
    richInvalid: () => true,
    markRichInvalid: () => {},
    evidenceInvalid: () => false,
    markEvidenceInvalid: () => tier.invalidate('controller-evidence-invalid'),
    captureSample: () => { throw new Error('unexpected-rich-sample'); },
    commitPhase: phase => {
      const observationPhase = { settled: 'settled', 'immediate-2': 'I2',
        'immediate-4': 'I4', 'immediate-8': 'I8' }[phase];
      if (observationPhase) capture(observationPhase);
    },
    captureOneTurnConstructorEvidence: () => capture('I1'),
    buildEvidence: () => { throw new Error('unexpected-rich-evidence'); },
    phaseReached: () => {},
  });
  childProcess.spawn = originalSpawn;
  net.createServer = originalCreateServer;
  const observation = tier.result();
  const finalSnapshot = rawPhases.I8.snapshot;
  const terminalDelta = diagnostic.compareActiveEvidence(baseline, finalSnapshot);
  diagnostic.emitDiagnosticPhase(control, 'POST_SETTLEMENT_HANDLES', terminalDelta);
  fs.writeFileSync(observationPath, JSON.stringify(primitiveSnapshot({
    schema: 'moxley-section80-observation-v1', runId, observation,
    registration, observerValid, wrappersRestored: childProcess.spawn === originalSpawn &&
      net.createServer === originalCreateServer,
    phasesFrozen: sealed.every(record => Object.isFrozen(record) && Object.isFrozen(record.lifecycle)),
  })) + '\n', { flag: 'wx' });
  if (rejected !== null) {
    process.stderr.write(build.internal.formatDiagnostic(rejected) + '\n');
    process.exitCode = 1;
    diagnostic.emitDiagnosticPhase(control, 'EXIT_CODE_SET', { value: 1 });
  }
}
void main().catch(error => {
  childProcess.spawn = originalSpawn;
  net.createServer = originalCreateServer;
  process.stderr.write('MOXLEY_NATIVE_BUILD_DIAGNOSTIC_EVIDENCE_INVALID: ' +
    'Private native build diagnostic evidence is invalid. ' + error.message + '\n');
  process.exitCode = 1;
});
`;
const D1_SYNTHETIC_CHILD_SOURCE = String.raw`
'use strict';
const net = require('node:net');
const build = require(process.argv[1]);
const runId = process.argv[2];
const diagnostic = build.__test;
const control = diagnostic.createDiagnosticControl(runId);
const baseline = diagnostic.captureActiveEvidence();
const server = net.createServer();

server.listen(0, '127.0.0.1', async () => {
  try {
    await Promise.reject(
      Object.assign(new Error('synthetic rejection'), {
        code: 'MOXLEY_NATIVE_BUILD_SYNTHETIC_REJECTION',
      }),
    );
  } catch (error) {
    diagnostic.emitDiagnosticPhase(
      control,
      'RUNBUILD_SETTLED_REJECTED',
      { code: error.code },
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  diagnostic.emitDiagnosticPhase(
    control,
    'POST_SETTLEMENT_HANDLES',
    diagnostic.compareActiveEvidence(
      baseline,
      diagnostic.captureActiveEvidence(),
    ),
  );
  process.stderr.write('synthetic-stderr\n');
  process.exitCode = 1;
  diagnostic.emitDiagnosticPhase(control, 'EXIT_CODE_SET', {
    value: 1,
  });
});
`;
const INVALID_SIDECAR_MODES = Object.freeze([
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
]);
const CLEAN_RETENTION_REQUIRED = Object.freeze({
  code: 'MOXLEY_NATIVE_CLEAN_RETENTION_REQUIRED',
  message:
    'Native build evidence requires retention; clean removal is not authorized.',
});
const CLEAN_DISPOSITION_INVALID = Object.freeze({
  code: 'MOXLEY_NATIVE_CLEAN_DISPOSITION_INVALID',
  message: 'Native build disposition evidence is invalid.',
});
const CLEAN_LOCK_INVALID = Object.freeze({
  code: 'MOXLEY_NATIVE_CLEAN_LOCK_INVALID',
  message: 'Native build lock evidence is invalid.',
});
const CLEAN_IDENTITY_CHANGED = Object.freeze({
  code: 'MOXLEY_NATIVE_CLEAN_IDENTITY_CHANGED',
  message: 'A native clean target identity changed.',
});
const CLEAN_PHYSICAL_CLEANUP_DEFERRED = Object.freeze({
  code: 'MOXLEY_NATIVE_CLEAN_PHYSICAL_CLEANUP_DEFERRED',
  message:
    'Secure physical cleanup is unavailable; native build state was retained.',
});
const INVENTORY_PROCESS_SOURCE = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$requestText=[Console]::In.ReadToEnd()
if ($requestText.Length -le 0 -or $requestText.Length -gt 4096) {
  throw 'PROCESS_REQUEST_INVALID'
}
try {
  $request=ConvertFrom-Json $requestText
} catch {
  throw 'PROCESS_REQUEST_INVALID'
}
if (
  ($request.PSObject.Properties.Name -join ',') -ne
    'rootPid,buildScript,cleanScript,release' -or
  ($request.rootPid -isnot [long] -and $request.rootPid -isnot [int]) -or
  $request.rootPid -le 0 -or
  $request.rootPid -gt [int]::MaxValue
) {
  throw 'PROCESS_REQUEST_INVALID'
}
foreach ($expectedPath in @(
  $request.buildScript,
  $request.cleanScript,
  $request.release
)) {
  if (
    $expectedPath -isnot [string] -or
    $expectedPath.Length -le 0 -or
    $expectedPath.Length -gt 1024 -or
    ![IO.Path]::IsPathFullyQualified($expectedPath)
  ) {
    throw 'PROCESS_REQUEST_INVALID'
  }
}
$testRootPid=[int64]$request.rootPid
if ($testRootPid -gt [int]::MaxValue -or $testRootPid -eq $PID) {
  throw 'PROCESS_ROOT_INVALID'
}
$snapshot=@(Get-CimInstance -ClassName Win32_Process)
if ($snapshot.Count -gt 8192) { throw 'PROCESS_SNAPSHOT_LIMIT' }
$byPid=@{}
foreach ($entry in $snapshot) {
  $entryPid=[int64]$entry.ProcessId
  $parentPid=[int64]$entry.ParentProcessId
  if (
    $entryPid -lt 0 -or
    $entryPid -gt [int]::MaxValue -or
    $parentPid -lt 0 -or
    $parentPid -gt [int]::MaxValue -or
    $byPid.ContainsKey([int]$entryPid)
  ) {
    throw 'PROCESS_SNAPSHOT_INVALID'
  }
  $byPid.Add([int]$entryPid,$entry)
}
if (!$byPid.ContainsKey([int]$testRootPid)) { throw 'PROCESS_ROOT_INVALID' }
if ([string]$byPid[[int]$testRootPid].Name -ne 'node.exe') {
  throw 'PROCESS_ROOT_INVALID'
}
function Get-CreationTicks($entry) {
  if ($null -eq $entry.CreationDate) { return $null }
  try {
    return ([datetime]$entry.CreationDate).ToUniversalTime().Ticks
  } catch {
    return $null
  }
}
$testRootCreationTicks=Get-CreationTicks $byPid[[int]$testRootPid]
if ($null -eq $testRootCreationTicks) { throw 'PROCESS_ROOT_INVALID' }
function Get-TaskAncestry($candidate) {
  $seen=[System.Collections.Generic.HashSet[int]]::new()
  $current=$candidate
  $currentTicks=Get-CreationTicks $current
  if ($null -eq $currentTicks) { return 'ambiguous' }
  if ($currentTicks -lt $testRootCreationTicks) { return 'other' }
  for ($depth=0; $depth -lt 64; $depth++) {
    $currentPid=[int]$current.ProcessId
    if (!$seen.Add($currentPid)) { return 'ambiguous' }
    $parentPid=[int]$current.ParentProcessId
    if ($parentPid -le 0) { return 'other' }
    if (!$byPid.ContainsKey($parentPid)) { return 'ambiguous' }
    $parent=$byPid[$parentPid]
    $parentTicks=Get-CreationTicks $parent
    if ($null -eq $parentTicks -or $parentTicks -gt $currentTicks) {
      return 'ambiguous'
    }
    if ($parentPid -eq [int]$PID) {
      if ($parentTicks -ne $inventoryCreationTicks) { return 'ambiguous' }
      return 'census-rooted'
    }
    if ($parentPid -eq [int]$testRootPid) {
      if ($parentTicks -ne $testRootCreationTicks) { return 'ambiguous' }
      return 'task-rooted'
    }
    if ($parentTicks -lt $testRootCreationTicks) { return 'other' }
    $current=$parent
    $currentTicks=$parentTicks
  }
  return 'ambiguous'
}
function Test-ContainsOrdinalIgnoreCase([string]$text,[string]$value) {
  return $text.IndexOf($value,[StringComparison]::OrdinalIgnoreCase) -ge 0
}
function Get-TaskRole($entry) {
  $name=[string]$entry.Name
  $command=[string]$entry.CommandLine
  if ($name -eq 'node.exe') {
    if (Test-ContainsOrdinalIgnoreCase $command $request.buildScript) {
      return 'native-build-node'
    }
    if (Test-ContainsOrdinalIgnoreCase $command $request.cleanScript) {
      return 'native-clean-node'
    }
    if (Test-ContainsOrdinalIgnoreCase $command 'moxley-native-build-probe') {
      return 'native-probe-node'
    }
    return $null
  }
  if ($name -eq 'cl.exe') {
    if (
      (Test-ContainsOrdinalIgnoreCase $command $request.release) -and
      (Test-ContainsOrdinalIgnoreCase $command 'moxley-windows-reparse-compile.rsp')
    ) {
      return 'native-compiler'
    }
    return $null
  }
  if ($name -eq 'link.exe') {
    if (
      (Test-ContainsOrdinalIgnoreCase $command $request.release) -and
      (Test-ContainsOrdinalIgnoreCase $command 'moxley-windows-reparse-link.rsp')
    ) {
      return 'native-linker'
    }
    return $null
  }
  if ($name -eq 'pwsh.exe') {
    if ($command -match '^"?C:\\Program Files\\PowerShell\\7\\pwsh\.exe"?\s+-NoLogo\s+-NoProfile\s+-NonInteractive\s+-ExecutionPolicy\s+Bypass\s+-EncodedCommand\s+[A-Za-z0-9+/=]+\s*$') {
      return 'bounded-powershell'
    }
    return $null
  }
  if ($name -eq 'taskkill.exe') {
    if ($command -match '^"?C:\\Windows\\System32\\taskkill\.exe"?\s+/PID\s+[1-9][0-9]*\s+/T\s+/F\s*$') {
      return 'taskkill-tree'
    }
    return $null
  }
  if ($name -eq 'fsutil.exe') {
    if ($command -match '^"?C:\\Windows\\System32\\fsutil\.exe"?\s+reparsepoint\s+query\s+.+$') {
      return 'filesystem-authentication'
    }
    return $null
  }
  if ($name -eq 'vswhere.exe') {
    if (
      $command -match '^"?C:\\Program Files \(x86\)\\Microsoft Visual Studio\\Installer\\vswhere\.exe"?\s+-products\s+Microsoft\.VisualStudio\.Product\.BuildTools\s+-property\s+installationVersion\s*$'
    ) {
      return 'visual-studio-authentication'
    }
    return $null
  }
  return $null
}
function Test-ExplicitMoxleyRole([string]$role) {
  return $role -in @(
    'native-build-node',
    'native-clean-node',
    'native-probe-node',
    'native-compiler',
    'native-linker'
  )
}
$inventoryEntry=$byPid[[int]$PID]
$inventoryCreationTicks=Get-CreationTicks $inventoryEntry
if (
  $null -eq $inventoryEntry -or
  [string]$inventoryEntry.Name -ne 'pwsh.exe' -or
  [int]$inventoryEntry.ParentProcessId -ne [int]$testRootPid -or
  $null -eq $inventoryCreationTicks -or
  $inventoryCreationTicks -lt $testRootCreationTicks -or
  (Get-TaskRole $inventoryEntry) -ne 'bounded-powershell'
) {
  throw 'PROCESS_CENSUS_IDENTITY_INVALID'
}
$items=[System.Collections.Generic.List[object]]::new()
foreach ($entry in $snapshot) {
  if ($entry.ProcessId -eq $PID -or $entry.ProcessId -eq $testRootPid) {
    continue
  }
  $ancestry=Get-TaskAncestry $entry
  if ($ancestry -eq 'census-rooted') { continue }
  $role=Get-TaskRole $entry
  $boundedName=[string]$entry.Name
  if ($ancestry -eq 'task-rooted' -and $null -eq $role) {
    $role='other-task-descendant'
    $boundedName='task-descendant'
  } elseif ($null -eq $role) {
    continue
  }
  $explicit=Test-ExplicitMoxleyRole $role
  if ($ancestry -eq 'other' -and !$explicit) { continue }
  $classification=if ($ancestry -eq 'task-rooted') {
    'task-rooted'
  } elseif ($explicit) {
    'moxley-command'
  } else {
    'ambiguous'
  }
  $creationTicks=Get-CreationTicks $entry
  if ($null -eq $creationTicks) { throw 'PROCESS_CREATION_INVALID' }
  [void]$items.Add([pscustomobject][ordered]@{
    name=$boundedName
    role=$role
    processId=[int]$entry.ProcessId
    parentProcessId=[int]$entry.ParentProcessId
    creationToken=$creationTicks.ToString([Globalization.CultureInfo]::InvariantCulture)
    classification=$classification
  })
}
$items=@($items | Sort-Object processId)
if ($items.Count -gt 128) { throw 'PROCESS_INVENTORY_LIMIT' }
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($items)))
`;
const sandboxRoots = new Map();
const diagnosticTeardownAuthorizations = new WeakMap();
let ambiguousProcessBaseline = new Set();
let uncertainRepositoryState = false;
let lastUncertainInventory = null;
let lifecycleFailureObserved = false;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function encodedPowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function processEvidenceKey(processEvidence) {
  return [
    processEvidence.name,
    processEvidence.processId,
    processEvidence.creationToken,
  ].join(':');
}

async function captureCandidateProcesses(
  buildScript = BUILD_SCRIPT,
  cleanScript = CLEAN_SCRIPT,
  release = RELEASE,
  timeoutMs = HARNESS_PROCESS_TIMEOUT_MS,
) {
  let result;
  try {
    result = await buildTest.runProcess(
      POWERSHELL_EXE,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShell(INVENTORY_PROCESS_SOURCE),
      ],
      {
        env: process.env,
        stdin: Buffer.from(JSON.stringify({
          rootPid: process.pid,
          buildScript,
          cleanScript,
          release,
        }), 'utf8'),
        timeoutMs,
      },
    );
  } catch (error) {
    if (
      error?.code === SUBPROCESS_CODES.timeout ||
      error?.code === SUBPROCESS_CODES.termination
    ) {
      uncertainRepositoryState = true;
    }
    return { confirmed: false, processes: [] };
  }
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stderr.length !== 0 ||
    result.stdout.length === 0 ||
    result.stdout.length > 64 * 1024
  ) {
    return { confirmed: false, processes: [] };
  }
  let value;
  try {
    value = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    return { confirmed: false, processes: [] };
  }
  if (!Array.isArray(value) || value.length > 128) {
    return { confirmed: false, processes: [] };
  }
  const acceptedNames = new Set([
    'cl.exe',
    'fsutil.exe',
    'link.exe',
    'node.exe',
    'pwsh.exe',
    'task-descendant',
    'taskkill.exe',
    'vswhere.exe',
  ]);
  const processes = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry)) !==
        JSON.stringify([
          'name',
          'role',
          'processId',
          'parentProcessId',
          'creationToken',
          'classification',
        ]) ||
      !acceptedNames.has(entry.name) ||
      ![
        'bounded-powershell',
        'filesystem-authentication',
        'native-build-node',
        'native-clean-node',
        'native-compiler',
        'native-linker',
        'native-probe-node',
        'other-task-descendant',
        'taskkill-tree',
        'visual-studio-authentication',
      ].includes(entry.role) ||
      !Number.isSafeInteger(entry.processId) ||
      entry.processId <= 0 ||
      !Number.isSafeInteger(entry.parentProcessId) ||
      entry.parentProcessId < 0 ||
      typeof entry.creationToken !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(entry.creationToken) ||
      ![
        'ambiguous',
        'moxley-command',
        'task-rooted',
      ].includes(entry.classification)
    ) {
      return { confirmed: false, processes: [] };
    }
    processes.push(Object.freeze({
      name: entry.name,
      role: entry.role,
      processId: entry.processId,
      parentProcessId: entry.parentProcessId,
      creationToken: entry.creationToken,
      classification: entry.classification,
    }));
  }
  return { confirmed: true, processes };
}

async function entryKind(target) {
  try {
    const metadata = await fsp.lstat(target);
    if (metadata.isSymbolicLink()) return 'symbolic-link';
    if (metadata.isFile()) return 'file';
    if (metadata.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'absent';
    return 'unknown';
  }
}

function inventoryPipe(pipeName) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    let timer;
    function finish(status) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket !== undefined) {
        socket.removeAllListeners();
        socket.destroy();
      }
      resolve(status);
    }
    try {
      socket = net.connect(pipeName);
    } catch {
      finish('unknown');
      return;
    }
    timer = setTimeout(() => finish('unknown'), 1_000);
    socket.once('connect', () => finish('active'));
    socket.once('error', (error) => {
      finish(error && error.code === 'ENOENT' ? 'absent' : 'unknown');
    });
  });
}

async function inventoryRepositoryState() {
  let identity;
  try {
    identity = await buildTest.repositoryLeaseIdentity();
  } catch {
    return Object.freeze({
      filesystemEvidenceConfirmed: false,
      artifact: 'unknown',
      receipt: 'unknown',
      lock: 'unknown',
      disposition: 'unknown',
      stagingCount: 0,
      releaseEntryCount: 0,
      pipe: 'unknown',
      processEvidenceConfirmed: false,
      taskOwnedProcessCount: 0,
      taskOwnedProcessNames: Object.freeze([]),
    });
  }
  const artifact = await entryKind(identity.paths.artifact);
  const receipt = await entryKind(identity.paths.receipt);
  const lock = await entryKind(identity.paths.lock);
  const disposition = await entryKind(DISPOSITION);
  let releaseEntryCount = 0;
  let stagingCount = 0;
  let releaseRead = true;
  try {
    const entries = await fsp.readdir(identity.paths.release);
    releaseEntryCount = entries.length;
    stagingCount = entries.filter((name) =>
      name.startsWith(STAGING_PREFIX)).length;
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) releaseRead = false;
  }
  const pipe = await inventoryPipe(identity.pipeName);
  const processEvidence = await captureCandidateProcesses();
  const taskOwnedProcesses = processEvidence.processes.filter(
    (entry) => !ambiguousProcessBaseline.has(processEvidenceKey(entry)),
  );
  const taskOwnedProcessNames = [...new Set(
    taskOwnedProcesses.map((entry) => entry.role),
  )].sort();
  return Object.freeze({
    filesystemEvidenceConfirmed:
      releaseRead &&
      ![artifact, receipt, lock, disposition].includes('unknown'),
    artifact,
    receipt,
    lock,
    disposition,
    stagingCount,
    releaseEntryCount,
    pipe,
    processEvidenceConfirmed: processEvidence.confirmed,
    taskOwnedProcessCount: taskOwnedProcesses.length,
    taskOwnedProcessNames: Object.freeze(taskOwnedProcessNames),
  });
}

async function inventoryPromotionScenario(result) {
  const repository = await inventoryRepositoryState();
  return Object.freeze({
    artifact: await entryKind(result.paths.artifact),
    receipt: await entryKind(result.paths.receipt),
    lock: await entryKind(result.paths.lock),
    disposition: await entryKind(result.paths.disposition),
    staging: await entryKind(result.paths.staging),
    pipe: repository.pipe,
    processEvidenceConfirmed: repository.processEvidenceConfirmed,
    taskOwnedProcessCount: repository.taskOwnedProcessCount,
    taskOwnedProcessNames: repository.taskOwnedProcessNames,
  });
}

function inventorySupportsCleanup(inventory) {
  return (
    inventory.filesystemEvidenceConfirmed === true &&
    inventory.pipe === 'absent' &&
    inventory.processEvidenceConfirmed === true &&
    inventory.taskOwnedProcessCount === 0
  );
}

async function recordUncertainProcessDisposition(disposition) {
  const inventory = await inventoryRepositoryState();
  lastUncertainInventory = inventory;
  if (
    disposition.disposition === SUBPROCESS_CODES.timeout ||
    disposition.disposition === SUBPROCESS_CODES.termination ||
    disposition.terminationConfirmed !== true ||
    !inventorySupportsCleanup(inventory)
  ) {
    uncertainRepositoryState = true;
  }
}

function boundedSupervisorFailure(error) {
  const code = Object.values(SUBPROCESS_CODES).includes(error?.code)
    ? error.code
    : SUBPROCESS_CODES.termination;
  const reason = SUBPROCESS_REASONS.includes(error?.reason)
    ? error.reason
    : 'SUBPROCESS_TERMINATION_NOT_CONFIRMED';
  const causeReason = SUBPROCESS_REASONS.includes(error?.cause?.reason)
    ? error.cause.reason
    : null;
  return {
    ok: false,
    disposition: code,
    reason,
    causeReason,
    terminationConfirmed: error?.terminationConfirmed === true,
    code: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
}

function boundedCompletedProcess(result) {
  if (result.code === 0 && result.signal === null) {
    return {
      ...result,
      ok: true,
      disposition: 'SUBPROCESS_SUCCEEDED',
      reason: null,
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  if (typeof result.signal === 'string' && result.signal.length !== 0) {
    return {
      ...result,
      ok: false,
      disposition: SUBPROCESS_CODES.exit,
      reason: 'SUBPROCESS_SIGNALLED_EXIT',
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  if (Number.isInteger(result.code) && result.code !== 0) {
    return {
      ...result,
      ok: false,
      disposition: SUBPROCESS_CODES.exit,
      reason: 'SUBPROCESS_NONZERO_EXIT',
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  return {
    ok: false,
    disposition: SUBPROCESS_CODES.termination,
    reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
    causeReason: null,
    terminationConfirmed: false,
    code: result.code ?? null,
    signal: result.signal ?? null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
}

async function runProcess(file, arguments_, options = {}) {
  let disposition;
  try {
    const result = await buildTest.runProcess(file, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdin: options.stdin,
      timeoutMs: HARNESS_PROCESS_TIMEOUT_MS,
    });
    disposition = boundedCompletedProcess(result);
  } catch (error) {
    disposition = boundedSupervisorFailure(error);
  }
  if (
    disposition.disposition === SUBPROCESS_CODES.timeout ||
    disposition.disposition === SUBPROCESS_CODES.termination
  ) {
    await recordUncertainProcessDisposition(disposition);
  }
  return disposition;
}

function runNodeScript(script, extraArguments = []) {
  return runProcess(process.execPath, [script, ...extraArguments], {
    cwd: os.tmpdir(),
  });
}

function phaseRecordsByName(records, phase) {
  return records.filter((record) => record.phase === phase);
}

function settlementClassification(records) {
  const fulfilled = phaseRecordsByName(
    records,
    'RUNBUILD_SETTLED_FULFILLED',
  );
  const rejected = phaseRecordsByName(
    records,
    'RUNBUILD_SETTLED_REJECTED',
  );
  if (fulfilled.length + rejected.length === 0) return 'PENDING';
  if (fulfilled.length === 1 && rejected.length === 0) return 'FULFILLED';
  if (fulfilled.length === 0 && rejected.length === 1) {
    return 'REJECTED:' + rejected[0].detail.code;
  }
  return 'INVALID';
}

function activeDeltaClassification(records) {
  const post = phaseRecordsByName(records, 'POST_SETTLEMENT_HANDLES');
  if (post.length === 0) return 'ABSENT';
  if (post.length !== 1) return 'INVALID';
  const handleDelta = post[0].detail.handles.delta;
  const requestDelta = post[0].detail.requests.delta;
  if (handleDelta.some((entry) => entry.type === 'Server')) {
    return 'NONBASELINE_SERVER';
  }
  if (handleDelta.length !== 0 || requestDelta.length !== 0) {
    return 'NONBASELINE_OTHER';
  }
  return 'NONE';
}

function canonicalSupervisorReceipt(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  assert.equal(bytes.length <= MAX_D1_SUPERVISOR_RECEIPT_BYTES, true);
  assert.equal(bytes.includes(13), false);
  assert.deepEqual(JSON.parse(bytes.toString('utf8').slice(0, -1)), value);
  assert.equal(
    `${JSON.stringify(JSON.parse(bytes.toString('utf8').slice(0, -1)))}\n`,
    bytes.toString('utf8'),
  );
  return Object.freeze({ value: Object.freeze(value), bytes });
}

function createDiagnosticSupervisorReceipt(
  disposition,
  evidence,
  records,
) {
  const receipt = {
    disposition: disposition.disposition,
    reason: disposition.reason,
    causeReason: disposition.causeReason,
    terminationConfirmed: disposition.terminationConfirmed,
    observedExitCode: evidence.exitCode,
    observedSignal: evidence.signal,
    partialStdoutByteLength: evidence.stdout.length,
    partialStderrByteLength: evidence.stderr.length,
    stdoutOverflowed: evidence.stdoutOverflowed,
    stderrOverflowed: evidence.stderrOverflowed,
    stdoutCompleted: evidence.stdoutCompleted,
    stderrCompleted: evidence.stderrCompleted,
    exitObserved: evidence.exitObserved,
    closeObserved: evidence.closeObserved,
    captureComplete: evidence.captureComplete,
    validPhaseRecordCount: records.length,
    lastValidPhase: records.at(-1)?.phase ?? null,
    settlementClassification: settlementClassification(records),
    activeHandleRequestDeltaClassification:
      activeDeltaClassification(records),
  };
  return canonicalSupervisorReceipt(receipt);
}

async function runRetainedDiagnosticProcess(
  arguments_,
  runId,
  timeoutMs,
) {
  let disposition;
  let evidence;
  try {
    const result = await buildTest.runProcess(
      process.execPath,
      arguments_,
      {
        cwd: os.tmpdir(),
        env: process.env,
        timeoutMs,
        retainFailureOutput: true,
      },
    );
    disposition = boundedCompletedProcess(result);
    evidence = Object.freeze({
      stdout: Buffer.from(result.stdout),
      stderr: Buffer.from(result.stderr),
      exitCode: result.code,
      signal: result.signal,
      stdoutOverflowed: false,
      stderrOverflowed: false,
      stdoutCompleted: true,
      stderrCompleted: true,
      exitObserved: true,
      closeObserved: true,
      terminationConfirmed: true,
      captureComplete: true,
    });
  } catch (error) {
    evidence = buildTest.supervisorFailureSnapshot(error);
    disposition = Object.freeze({
      ok: false,
      disposition: error.code,
      reason: error.reason,
      causeReason: error.cause?.reason ?? null,
      terminationConfirmed: error.terminationConfirmed === true,
    });
  }
  const records = buildTest.parseDiagnosticPhaseStream(
    evidence.stdout,
    runId,
  );
  const receipt = createDiagnosticSupervisorReceipt(
    disposition,
    evidence,
    records,
  );
  return Object.freeze({ disposition, evidence, records, receipt });
}

async function runSoleD1Diagnostic(buildScript, runId) {
  const observationPath = path.join(path.dirname(path.dirname(buildScript)), '.section80-observation.json');
  const result = await runRetainedDiagnosticProcess(
    ['-e', D1_DIAGNOSTIC_CHILD_SOURCE, buildScript, runId, observationPath],
    runId,
    D1_DIAGNOSTIC_TIMEOUT_MS,
  );
  const bytes = await fsp.readFile(observationPath);
  assert.equal(bytes.length <= 128 * 1024, true);
  const observation = JSON.parse(bytes.toString('utf8'));
  return Object.freeze({ ...result, observation });
}

function assertSection80Observation(value, runId, terminalRaw) {
  assert.equal(value.schema, 'moxley-section80-observation-v1');
  assert.equal(value.runId, runId);
  assert.equal(value.observerValid, true);
  assert.equal(value.wrappersRestored, true);
  assert.equal(value.phasesFrozen, true);
  const observation = value.observation;
  assert.equal(observation.valid, true, JSON.stringify(observation.reasons));
  assert.equal(observation.disposition, 'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');
  assert.equal(observation.diagnosticPair, true);
  assert.equal(observation.terminalSampleReused, true);
  assert.deepEqual(observation.phases.map(p => p.phase), ['baseline', 'settled', 'I1', 'I2', 'I4', 'I8']);
  assert.deepEqual(value.registration.registrations.map(r => [r.role, r.accepted]),
    [['stdout', true], ['stderr', true]]);
  assert.equal(value.registration.after.valid, true);
  for (const phase of observation.phases) {
    assert.equal(phase.valid, true);
    assert.equal(phase.registry.valid, true);
    assert.equal(phase.workloadGate, 'PASS');
    assert.deepEqual(phase.integrity.calls, { handles: 1, requests: 1 });
    assert.deepEqual(phase.integrity.preserved, { handles: true, requests: true });
    assert.equal(phase.integrity.restored, true);
    assert.equal(phase.integrity.exactArrayReturned, true);
    const snapshot = phase.phase === 'baseline' ? phase.raw : phase.raw.snapshot;
    const counts = Object.fromEntries(snapshot.requests.map(r => [r.type, r.count]));
    const continuityCounts = {};
    for (const row of phase.requestContinuity.current) {
      continuityCounts[row.constructor] = (continuityCounts[row.constructor] || 0) + 1;
    }
    assert.deepEqual(continuityCounts, counts);
    assert.equal(phase.requestContinuity.present, phase.requestContinuity.current.length);
    assert.equal(phase.requestContinuity.retiredCount, phase.requestContinuity.retired.length);
    const expectedDelta = phase.phase === 'baseline' ? {} : phase.raw.requestDeltas;
    assert.deepEqual(phase.requestContinuity.constructorDelta, expectedDelta);
  }
  const terminal = observation.phases.at(-1);
  assert.equal(terminal.counts.WORKLOAD_OWNED, 0);
  assert.equal(terminal.counts.UNKNOWN_OWNERSHIP, 0);
  assert.deepEqual(terminal.requiredCounts, { unknown: 0, workload: 0 });
  assert.equal(terminal.lifecycle.leaseCloseDone, true);
  assert.equal(terminal.ownership.every(r => r.category === 'DIAGNOSTIC_TRANSPORT_OWNED'), true);
  assert.deepEqual(terminal.ownership.map(r => r.role).sort(), ['diagnostic-stderr', 'diagnostic-stdout']);
  for (const row of terminal.ownership) {
    assert.equal(row.constructor, 'Socket');
    assert.match(row.provenance, /^exact process\.(stdout|stderr) reference and registered (STDOUT|STDERR)_LABEL$/);
  }
  // Check the preserved production record against the separately retained raw
  // sample. No fixed Socket count substitutes for the semantic ownership gate.
  const { captureActiveEvidence, compareActiveEvidence } = buildTest;
  assert.equal(typeof captureActiveEvidence, 'function');
  assert.deepEqual(terminalRaw, compareActiveEvidence(observation.phases[0].raw, terminal.raw.snapshot));
  assert.deepEqual(Object.fromEntries(terminalRaw.handles.delta.map(r => [r.type, r.count])), terminal.raw.handleDeltas);
  assert.deepEqual(Object.fromEntries(terminalRaw.requests.delta.map(r => [r.type, r.count])), terminal.raw.requestDeltas);
  return observation;
}

async function assertDiagnosticObservabilityContract() {
  assert.equal(buildTest.MAX_DIAGNOSTIC_RECORD_BYTES, 1024);
  assert.equal(buildTest.MAX_DIAGNOSTIC_RECORDS, 128);
  assert.equal(buildTest.MAX_DIAGNOSTIC_OUTPUT_BYTES, 128 * 1024);
  assert.equal(buildTest.MAX_ACTIVE_TYPES, 16);
  assert.equal(buildTest.MAX_ACTIVE_OBJECTS, 64);
  assert.equal(new Set(buildTest.DIAGNOSTIC_PHASES).size,
    buildTest.DIAGNOSTIC_PHASES.length);

  const runId = '1'.repeat(32);
  const chunks = [];
  const control = buildTest.createDiagnosticControl(runId, (bytes) => {
    chunks.push(Buffer.from(bytes));
    return bytes.length;
  });
  buildTest.emitDiagnosticPhase(control, 'RECEIPT_DONE');
  buildTest.emitDiagnosticPhase(control, 'STAGING_READDIR_DONE', {
    entryCount: 2,
  });
  buildTest.emitDiagnosticPhase(control, 'STAGING_ENTRY_BEGIN', {
    kind: 'file',
    ordinal: 0,
  });
  const canonicalBytes = Buffer.concat(chunks);
  const canonicalRecords = buildTest.parseDiagnosticPhaseStream(
    canonicalBytes,
    runId,
  );
  assert.deepEqual(
    canonicalRecords.map((record) => record.sequence),
    [0, 1, 2],
  );
  assert.equal(
    Buffer.concat(
      canonicalRecords.map((record) =>
        Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')),
    ).equals(canonicalBytes),
    true,
  );
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(canonicalBytes, '2'.repeat(32)));
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(
      canonicalBytes.subarray(0, canonicalBytes.length - 1),
      runId,
    ));
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(
      Buffer.concat([canonicalBytes, Buffer.from('\r\n')]),
      runId,
    ));
  const unknown = {
    ...canonicalRecords[0],
    phase: 'UNKNOWN_PHASE',
  };
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(
      Buffer.from(`${JSON.stringify(unknown)}\n`, 'utf8'),
      runId,
    ));
  const wrongSequence = {
    ...canonicalRecords[0],
    sequence: 1,
  };
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(
      Buffer.from(`${JSON.stringify(wrongSequence)}\n`, 'utf8'),
      runId,
    ));
  assert.throws(() =>
    buildTest.parseDiagnosticPhaseStream(
      Buffer.alloc(buildTest.MAX_DIAGNOSTIC_OUTPUT_BYTES + 1, 0x61),
      runId,
    ));

  const limitChunks = [];
  const limitControl = buildTest.createDiagnosticControl(
    '3'.repeat(32),
    (bytes) => {
      limitChunks.push(Buffer.from(bytes));
      return bytes.length;
    },
  );
  for (let index = 0; index < 128; index += 1) {
    buildTest.emitDiagnosticPhase(limitControl, 'RECEIPT_DONE');
  }
  assert.throws(() =>
    buildTest.emitDiagnosticPhase(limitControl, 'RECEIPT_DONE'));
  assert.equal(
    buildTest.parseDiagnosticPhaseStream(
      Buffer.concat(limitChunks),
      '3'.repeat(32),
    ).length,
    128,
  );
  const failedWriter = buildTest.createDiagnosticControl(
    '4'.repeat(32),
    () => {
      throw new Error('closed');
    },
  );
  assert.throws(() =>
    buildTest.emitDiagnosticPhase(failedWriter, 'RECEIPT_DONE'));

  class Alpha {}
  class Zulu {}
  const sensitive = Object.assign(new Zulu(), {
    path: 'C:\\secret',
    command: 'private-command',
    descriptor: 99,
    pid: 4242,
  });
  const sanitized = buildTest.sanitizeActiveObjects([
    sensitive,
    new Alpha(),
    new Zulu(),
  ]);
  assert.deepEqual(sanitized, [
    { type: 'Alpha', count: 1 },
    { type: 'Zulu', count: 2 },
  ]);
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /secret|private-command|descriptor|4242/,
  );
  assert.throws(() =>
    buildTest.sanitizeActiveObjects(
      Array.from({ length: 65 }, () => new Alpha()),
    ));
  const tooManyTypes = Array.from({ length: 17 }, (_, index) => {
    const name = `Type${String(index).padStart(2, '0')}`;
    const Type = { [name]: class {} }[name];
    return new Type();
  });
  assert.throws(() => buildTest.sanitizeActiveObjects(tooManyTypes));
  class _InvalidType {}
  assert.throws(() =>
    buildTest.sanitizeActiveObjects([new _InvalidType()]));
  const maximalBaseline = Array.from({ length: 16 }, (_, index) => ({
    type: `Type${String(index).padStart(2, '0')}`,
    count: 1,
  }));
  const maximalAfter = maximalBaseline.map((entry) => ({
    type: entry.type,
    count: 2,
  }));
  const maximalEvidence = buildTest.createActiveDeltaEvidence(
    maximalBaseline,
    maximalAfter,
  );
  const recordLimitControl = buildTest.createDiagnosticControl(
    '6'.repeat(32),
    (bytes) => bytes.length,
  );
  assert.throws(() =>
    buildTest.emitDiagnosticPhase(
      recordLimitControl,
      'POST_SETTLEMENT_HANDLES',
      { handles: maximalEvidence, requests: {
        baseline: [],
        after: [],
        delta: [],
        overflow: false,
      } },
    ));

  const syntheticRunId = '5'.repeat(32);
  const synthetic = await runRetainedDiagnosticProcess(
    [
      '-e',
      D1_SYNTHETIC_CHILD_SOURCE,
      BUILD_SCRIPT,
      syntheticRunId,
    ],
    syntheticRunId,
    1_000,
  );
  assert.equal(
    synthetic.disposition.disposition,
    SUBPROCESS_CODES.timeout,
  );
  assert.equal(synthetic.disposition.reason, 'SUBPROCESS_TIMEOUT');
  assert.equal(synthetic.disposition.terminationConfirmed, true);
  assert.equal(
    synthetic.receipt.value.settlementClassification,
    'REJECTED:MOXLEY_NATIVE_BUILD_SYNTHETIC_REJECTION',
  );
  assert.equal(
    synthetic.receipt.value.activeHandleRequestDeltaClassification,
    'NONBASELINE_SERVER',
  );
  assert.equal(
    synthetic.evidence.stderr.toString('utf8'),
    'synthetic-stderr\n',
  );
  assert.equal(synthetic.evidence.captureComplete, true);
  assert.equal(synthetic.evidence.stdoutOverflowed, false);
  assert.equal(synthetic.evidence.stderrOverflowed, false);

  assert.throws(() => buildTest.supervisorFailureSnapshot(new Error()));
  assert.throws(() =>
    buildTest.validateSupervisorFailureSnapshot({}));
  assert.throws(() =>
    buildTest.validateSupervisorFailureSnapshot({
      stdout: Buffer.alloc(buildTest.MAX_PROCESS_OUTPUT_BYTES + 1),
      stderr: Buffer.alloc(0),
      exitCode: null,
      signal: null,
      stdoutOverflowed: false,
      stderrOverflowed: false,
      stdoutCompleted: false,
      stderrCompleted: false,
      exitObserved: false,
      closeObserved: false,
      terminationConfirmed: false,
      captureComplete: false,
    }));

  await assert.rejects(
    buildTest.runProcess(
      path.join(os.tmpdir(), 'moxley-d1-nonexistent.exe'),
      [],
      { timeoutMs: 1_000 },
    ),
    (error) => {
      assert.throws(() => buildTest.supervisorFailureSnapshot(error));
      assert.equal(
        Object.keys(error).includes('stdout') ||
          Object.keys(error).includes('stderr'),
        false,
      );
      return true;
    },
  );
  assert.deepEqual(Object.keys(buildModule), ['internal', '__test']);
  assert.equal(buildTest.runBuild.length, 0);
  assert.equal(buildTest.runBuildForDiagnostic.length, 1);
}

function parseCanonicalOutput(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.includes('\r'), false);
  assert.equal(text.indexOf('\n'), text.length - 1);
  const value = JSON.parse(text.slice(0, -1));
  assert.equal(`${JSON.stringify(value)}\n`, text);
  return value;
}

function assertBoundedFailure(result) {
  assert.equal(result.ok, false);
  assert.equal(result.disposition, SUBPROCESS_CODES.exit);
  assert.equal(result.reason, 'SUBPROCESS_NONZERO_EXIT');
  assert.equal(result.terminationConfirmed, true);
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.length, 0);
  const stderr = result.stderr.toString('utf8');
  assert.equal(stderr.endsWith('\n'), true);
  assert.equal(stderr.includes('\r'), false);
  assert.equal(stderr.indexOf('\n'), stderr.length - 1);
  assert.equal(stderr.length <= 241, true);
  assert.doesNotMatch(stderr, /[A-Za-z]:\\/);
}

function formatSupervisorDiagnosticReceipt(result) {
  return JSON.stringify({
    disposition: result?.disposition ?? null,
    reason: result?.reason ?? null,
    causeReason: result?.causeReason ?? null,
    terminationConfirmed: result?.terminationConfirmed === true,
    code: result?.code ?? null,
    signal: result?.signal ?? null,
    stdoutByteLength: Buffer.isBuffer(result?.stdout)
      ? result.stdout.length
      : null,
    stderrByteLength: Buffer.isBuffer(result?.stderr)
      ? result.stderr.length
      : null,
  });
}

function assertBoundedSuccess(result) {
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'SUBPROCESS_SUCCEEDED');
  assert.equal(result.reason, null);
  assert.equal(result.causeReason, null);
  assert.equal(result.terminationConfirmed, true);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
}

function assertHarnessDispositionMatrix() {
  const errorCases = [
    {
      code: SUBPROCESS_CODES.spawn,
      reason: 'SUBPROCESS_SPAWN_ERROR',
      terminationConfirmed: false,
    },
    {
      code: SUBPROCESS_CODES.timeout,
      reason: 'SUBPROCESS_TIMEOUT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.output,
      reason: 'SUBPROCESS_STDOUT_LIMIT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.output,
      reason: 'SUBPROCESS_STDERR_LIMIT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.termination,
      reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
      terminationConfirmed: false,
      cause: Object.freeze({ reason: 'SUBPROCESS_EXIT_WITHOUT_CLOSE' }),
    },
    {
      code: SUBPROCESS_CODES.termination,
      reason: 'SUBPROCESS_TERMINATION_TOOL_FAILED',
      terminationConfirmed: false,
      cause: Object.freeze({ reason: 'SUBPROCESS_STDOUT_LIMIT' }),
    },
  ];
  for (const expected of errorCases) {
    const actual = boundedSupervisorFailure(Object.freeze(expected));
    assert.equal(actual.ok, false);
    assert.equal(actual.disposition, expected.code);
    assert.equal(actual.reason, expected.reason);
    assert.equal(
      actual.causeReason,
      expected.cause?.reason ?? null,
    );
    assert.equal(
      actual.terminationConfirmed,
      expected.terminationConfirmed,
    );
    assert.equal(actual.code, null);
    assert.equal(typeof actual.disposition, 'string');
    assert.equal(typeof actual.reason, 'string');
  }

  const completedCases = [
    {
      result: {
        code: 23,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
      reason: 'SUBPROCESS_NONZERO_EXIT',
    },
    {
      result: {
        code: null,
        signal: 'SIGTERM',
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
      reason: 'SUBPROCESS_SIGNALLED_EXIT',
    },
  ];
  for (const expected of completedCases) {
    const actual = boundedCompletedProcess(expected.result);
    assert.equal(actual.ok, false);
    assert.equal(actual.disposition, SUBPROCESS_CODES.exit);
    assert.equal(actual.reason, expected.reason);
    assert.equal(actual.terminationConfirmed, true);
    assert.equal(typeof actual.disposition, 'string');
    assert.equal(typeof actual.reason, 'string');
  }

  const unexplainedNull = boundedCompletedProcess({
    code: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  });
  assert.equal(unexplainedNull.ok, false);
  assert.equal(unexplainedNull.disposition, SUBPROCESS_CODES.termination);
  assert.equal(
    unexplainedNull.reason,
    'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
  );
}

function assertCanonicalCarrierBytes(bytes, record) {
  assert.equal(typeof bytes, 'string');
  assert.equal(Buffer.byteLength(bytes, 'utf8') >= 1, true);
  assert.equal(
    Buffer.byteLength(bytes, 'utf8') <= internal.MAX_CARRIER_BYTES,
    true,
  );
  assert.equal(bytes.startsWith('\uFEFF'), false);
  assert.equal(bytes.includes('\r'), false);
  assert.equal(bytes.endsWith('\n'), true);
  assert.equal(bytes.indexOf('\n'), bytes.length - 1);
  assert.equal(bytes, `${JSON.stringify(record)}\n`);
}

function assertCarrierJournal(result) {
  const lockEvents = [
    'lock:create',
    'lock:stat',
    'lock:write',
    'lock:sync',
    'lock:close',
    'lock:authenticate',
    'lock:readback',
  ];
  const dispositionEvents = [
    'disposition:create',
    'disposition:stat',
    'disposition:write',
    'disposition:sync',
    'disposition:close',
    'disposition:authenticate',
    'disposition:readback',
  ];
  const faultEvents = CARRIER_FAULTS.map(
    (fault) => `disposition:fault:${fault}`,
  );
  const allowed = new Set([
    ...lockEvents,
    ...dispositionEvents,
    ...faultEvents,
    'retention:prepared',
    'lease:close',
    'lease:close-rejected',
  ]);
  assert.equal(Object.isFrozen(result.journal), true);
  assert.deepEqual(result.journal.slice(0, lockEvents.length), lockEvents);
  assert.equal(result.journal.every((event) => allowed.has(event)), true);
  for (const event of [...lockEvents, ...dispositionEvents, ...faultEvents]) {
    assert.equal(
      result.journal.filter((candidate) => candidate === event).length <= 1,
      true,
      `${event} must not be retried`,
    );
  }
  assert.equal(
    result.journal.filter((event) => event === 'lease:close').length,
    1,
  );
  assert.equal(result.journal.at(-1), 'lease:close');
  const terminalEvent = result.scenario.fault === 'none'
    ? 'disposition:readback'
    : `disposition:fault:${result.scenario.fault}`;
  assert.equal(result.journal.includes(terminalEvent), true);
  assert.equal(
    result.journal.indexOf(terminalEvent) <
      result.journal.indexOf('lease:close'),
    true,
  );
}

function assertOrderedUniqueEvents(events, expected) {
  let previous = -1;
  for (const event of expected) {
    const indexes = events
      .map((candidate, index) => (candidate === event ? index : -1))
      .filter((index) => index >= 0);
    assert.deepEqual(indexes.length, 1, `${event} must occur exactly once`);
    assert.equal(indexes[0] > previous, true, `${event} is out of order`);
    previous = indexes[0];
  }
}

function assertCleanResultShape(result, mode) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), [
    'mode',
    'status',
    'code',
    'message',
    'removed',
    'events',
    'paths',
    'retained',
  ]);
  assert.equal(result.mode, mode);
  assert.equal(Object.isFrozen(result.removed), true);
  assert.equal(Object.isFrozen(result.events), true);
  assert.equal(Object.isFrozen(result.paths), true);
  assert.equal(Object.isFrozen(result.retained), true);
  assert.deepEqual(Object.keys(result.paths), [
    'artifact',
    'receipt',
    'lock',
    'disposition',
    'staging',
  ]);
  assert.deepEqual(Object.keys(result.retained), [
    'artifact',
    'receipt',
    'lock',
    'disposition',
    'staging',
  ]);
}

function assertCleanError(result, mode, expected) {
  assertCleanResultShape(result, mode);
  assert.equal(result.status, 'error');
  assert.equal(result.code, expected.code);
  assert.equal(result.message, expected.message);
  assert.deepEqual(result.removed, []);
}

function assertAllRetained(result, expected) {
  assert.deepEqual(result.retained, {
    artifact: expected,
    receipt: expected,
    lock: expected,
    disposition: expected,
    staging: expected,
  });
}

function normalizedRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

async function releaseEntries() {
  if (!(await exists(RELEASE))) return [];
  return (await fsp.readdir(RELEASE)).sort(internal.ordinalCompare);
}

async function assertRepositoryGeneratedStateAbsent() {
  for (const target of [ARTIFACT, RECEIPT, LOCK, DISPOSITION]) {
    assert.equal(await exists(target), false, `${target} must be absent`);
  }
  const entries = await releaseEntries();
  assert.deepEqual(
    entries.filter((name) => name.startsWith(STAGING_PREFIX)),
    [],
  );
  assert.deepEqual(
    entries.filter((name) =>
      /\.(?:node|obj|lib|exp|pdb|rsp)$/i.test(name),
    ),
    [],
  );
}

const EXECUTION_MIRROR_LEDGER = Object.freeze({
  'package.json': Object.freeze({
    byteLength: 857,
    sha256:
      '4803a54063cdf9a177a0e22e72169a108af9545425a6235e6601bd9f02bb2d34',
  }),
  'scripts/build-windows-native.cjs': Object.freeze({
    byteLength: 138_588,
    sha256:
      'e4e23266061138d169b099ea88a7e0a3ff2f16eaf950acffaab3820839f6104a',
  }),
  'scripts/clean-windows-native.cjs': Object.freeze({
    byteLength: 30_693,
    sha256:
      'ef23139fe5afc2336ab23b0ba023a13436de2c0593092318afbbc128763563eb',
  }),
  'native/windows-reparse-classifier.c': Object.freeze({
    byteLength: 7_942,
    sha256:
      'f2236eb6a3e0336f25e4fb0ac16d57b55c40342094f420f959115e4232ce77e3',
  }),
});

const TEARDOWN_FILE_NAMES = new Set([
  '.section80-observation.json',
  'package.json',
  'build-windows-native.cjs',
  'clean-windows-native.cjs',
  'windows-reparse-classifier.c',
  'moxley-windows-reparse.node',
  'moxley-windows-reparse.receipt.json',
  '.moxley-windows-reparse-build.lock',
  '.moxley-windows-reparse-build.disposition.json',
  ...internal.STAGING_FILE_NAMES,
  'external-sentinel.txt',
]);

function allowedTeardownDirectoryName(name) {
  return (
    ['build', 'Release', 'scripts', 'native', 'Microsoft',
      'VSApplicationInsights'].includes(name) ||
    name.startsWith(STAGING_PREFIX) ||
    /^vstel[0-9a-f]{32}$/.test(name)
  );
}

async function createRegisteredTempRoot(prefix) {
  const canonicalTempRoot = await fsp.realpath(os.tmpdir());
  const tempMetadata = await fsp.lstat(canonicalTempRoot, { bigint: true });
  assert.equal(tempMetadata.isDirectory(), true);
  assert.equal(tempMetadata.isSymbolicLink(), false);
  await internal.assertNoReparse(canonicalTempRoot);

  const root = await fsp.mkdtemp(path.join(canonicalTempRoot, prefix));
  const metadata = await fsp.lstat(root, { bigint: true });
  const registration = {
    root,
    prefix,
    identity: internal.identityOf(metadata),
  };
  sandboxRoots.set(root, registration);

  assert.equal(metadata.isDirectory(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(
    path.dirname(root).toLowerCase(),
    canonicalTempRoot.toLowerCase(),
  );
  assert.equal(path.basename(root).startsWith(prefix), true);
  await internal.assertNoReparse(root);
  const canonicalRoot = await fsp.realpath(root);
  assert.equal(internal.sameWindowsPath(canonicalRoot, root), true);
  return root;
}

async function createSandbox() {
  return createRegisteredTempRoot('moxley-native-build-test-');
}

async function authenticateLedgerFile(target, expected) {
  const metadata = await internal.authenticatePath(target, 'file');
  const bytes = await fsp.readFile(target);
  assert.equal(Number(metadata.size), expected.byteLength);
  assert.equal(bytes.length, expected.byteLength);
  assert.equal(sha256(bytes), expected.sha256);
  return bytes;
}

async function createExecutionMirror() {
  const root = await createRegisteredTempRoot(
    'moxley-section80-d1-mirror-',
  );
  const canonicalRecovery = await fsp.realpath(REPOSITORY_ROOT);
  const recoveryMetadata = await internal.authenticatePath(
    canonicalRecovery,
    'directory',
  );
  const mirrorMetadata = await internal.authenticatePath(root, 'directory');
  assert.equal(
    path.parse(root).root.toLowerCase(),
    path.parse(canonicalRecovery).root.toLowerCase(),
  );
  assert.equal(mirrorMetadata.dev, recoveryMetadata.dev);

  const authenticatedInputs = await buildTest.authenticateBuildInputs();
  assert.equal(
    internal.sameWindowsPath(
      authenticatedInputs.canonicalRoot,
      canonicalRecovery,
    ),
    true,
  );
  assert.equal(authenticatedInputs.evidence.platform, 'win32');
  assert.equal(authenticatedInputs.evidence.architecture, 'x64');

  const scripts = path.join(root, 'scripts');
  const native = path.join(root, 'native');
  await fsp.mkdir(scripts, { recursive: false });
  await fsp.mkdir(native, { recursive: false });
  for (const directory of [scripts, native]) {
    await internal.authenticatePath(directory, 'directory');
    await internal.assertNoReparse(directory);
  }

  for (const [relative, expected] of Object.entries(
    EXECUTION_MIRROR_LEDGER,
  )) {
    const source = path.join(REPOSITORY_ROOT, ...relative.split('/'));
    const destination = path.join(root, ...relative.split('/'));
    const bytes = await authenticateLedgerFile(source, expected);
    await fsp.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    await authenticateLedgerFile(destination, expected);
  }

  return Object.freeze({
    root,
    buildScript: path.join(root, 'scripts', 'build-windows-native.cjs'),
    cleanScript: path.join(root, 'scripts', 'clean-windows-native.cjs'),
    release: path.join(root, 'build', 'Release'),
  });
}

async function boundedNoFollowInventory(root) {
  const registration = sandboxRoots.get(root);
  assert.notEqual(registration, undefined);
  const rootMetadata = await fsp.lstat(root, { bigint: true });
  assert.equal(
    internal.sameIdentity(rootMetadata, registration.identity, false),
    true,
  );
  assert.equal(rootMetadata.isDirectory(), true);
  assert.equal(rootMetadata.isSymbolicLink(), false);
  await internal.assertNoReparse(root);

  const inventory = [];
  const pending = [root];
  while (pending.length !== 0) {
    const directory = pending.pop();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      assert.equal(internal.isStrictDescendant(root, target), true);
      const metadata = await fsp.lstat(target, { bigint: true });
      assert.equal(metadata.isSymbolicLink(), false);
      assert.equal(metadata.isFile() || metadata.isDirectory(), true);
      if (metadata.isDirectory()) {
        assert.equal(allowedTeardownDirectoryName(entry.name), true);
        await internal.authenticatePath(target, 'directory');
        pending.push(target);
      } else {
        assert.equal(TEARDOWN_FILE_NAMES.has(entry.name), true);
        await internal.authenticatePath(target, 'file');
      }
      await internal.assertNoReparse(target);
      inventory.push(Object.freeze({
        relative: normalizedRelative(root, target),
        type: metadata.isDirectory() ? 'directory' : 'file',
        identity: internal.identityOf(metadata),
      }));
      assert.equal(inventory.length <= 128, true);
    }
  }
  return Object.freeze(
    inventory.sort((left, right) =>
      internal.ordinalCompare(left.relative, right.relative)),
  );
}

async function boundedHashedInventory(root) {
  const authenticated = await boundedNoFollowInventory(root);
  const inventory = [];
  for (const entry of authenticated) {
    if (entry.type === 'directory') {
      inventory.push(Object.freeze({
        relative: entry.relative,
        type: 'directory',
        byteLength: null,
        sha256: null,
      }));
      continue;
    }
    const target = path.join(root, ...entry.relative.split('/'));
    const bytes = await fsp.readFile(target);
    inventory.push(Object.freeze({
      relative: entry.relative,
      type: 'file',
      byteLength: bytes.length,
      sha256: sha256(bytes),
    }));
  }
  return Object.freeze(inventory);
}

async function authorizeDiagnosticTeardown(
  mirror,
  pipeName,
  expectedInventory,
  recoverySnapshot,
) {
  const processEvidence = await captureCandidateProcesses(
    mirror.buildScript,
    mirror.cleanScript,
    mirror.release,
    D1_READ_ONLY_CHECK_TIMEOUT_MS,
  );
  assert.equal(processEvidence.confirmed, true);
  assert.equal(
    processEvidence.processes.every(
      (entry) =>
        entry.classification === 'ambiguous' &&
        ambiguousProcessBaseline.has(processEvidenceKey(entry)),
    ),
    true,
  );
  assert.equal(await inventoryPipe(pipeName), 'absent');
  const canonicalTempRoot = await fsp.realpath(os.tmpdir());
  const canonicalMirror = await fsp.realpath(mirror.root);
  assert.equal(
    path.dirname(canonicalMirror).toLowerCase(),
    canonicalTempRoot.toLowerCase(),
  );
  assert.equal(
    path.basename(canonicalMirror).startsWith(
      'moxley-section80-d1-mirror-',
    ),
    true,
  );
  const inventory = await boundedHashedInventory(mirror.root);
  assert.deepEqual(inventory, expectedInventory);
  assert.deepEqual(await snapshotRecoveryPacket(), recoverySnapshot);
  const authorization = Object.freeze({});
  diagnosticTeardownAuthorizations.set(authorization, Object.freeze({
    root: mirror.root,
    inventory: JSON.stringify(inventory),
  }));
  return Object.freeze({
    authorization,
    receipt: Object.freeze({
      processEvidenceConfirmed: true,
      matchingProcessCount: processEvidence.processes.filter(
        (entry) => entry.classification !== 'ambiguous',
      ).length,
      pipe: 'absent',
      inventoryEntryCount: inventory.length,
      recoveryPacketUnchanged: true,
    }),
  });
}

async function removeSandbox(root, diagnosticAuthorization = null) {
  const registration = sandboxRoots.get(root);
  assert.notEqual(registration, undefined);
  if (diagnosticAuthorization === null) {
    const buildScript = path.join(root, 'scripts', 'build-windows-native.cjs');
    const cleanScript = path.join(root, 'scripts', 'clean-windows-native.cjs');
    const release = path.join(root, 'build', 'Release');
    const processEvidence = await captureCandidateProcesses(
      buildScript,
      cleanScript,
      release,
    );
    assert.equal(processEvidence.confirmed, true);
    assert.equal(
      processEvidence.processes.every(
        (entry) =>
          entry.classification === 'ambiguous' &&
          ambiguousProcessBaseline.has(processEvidenceKey(entry)),
      ),
      true,
    );

    const canonicalRoot = await fsp.realpath(root);
    const key = internal.repositoryKey(canonicalRoot);
    assert.equal(await inventoryPipe(internal.pipeNameForKey(key)), 'absent');
    await boundedNoFollowInventory(root);
  } else {
    const authority = diagnosticTeardownAuthorizations.get(
      diagnosticAuthorization,
    );
    assert.notEqual(authority, undefined);
    assert.equal(authority.root, root);
    assert.equal(
      JSON.stringify(await boundedHashedInventory(root)),
      authority.inventory,
    );
    diagnosticTeardownAuthorizations.delete(diagnosticAuthorization);
  }

  await fsp.rm(root, {
    recursive: true,
    force: false,
    maxRetries: 0,
    retryDelay: 0,
  });
  await assert.rejects(
    fsp.lstat(root),
    (error) => error?.code === 'ENOENT',
  );
  sandboxRoots.delete(root);
}

async function startServer(pipeName) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(pipeName, () => {
      server.unref();
      resolve(server);
    });
  });
}

async function closeServer(server) {
  if (server === null) return;
  await new Promise((resolve) => server.close(resolve));
}

async function gitTrackedCFiles() {
  const result = await runProcess(
    'git.exe',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.c'],
    { cwd: REPOSITORY_ROOT },
  );
  assertBoundedSuccess(result);
  assert.equal(result.stderr.length, 0);
  const candidates = result.stdout
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const existing = [];
  for (const candidate of candidates) {
    if (await exists(path.join(REPOSITORY_ROOT, candidate))) {
      existing.push(candidate);
    }
  }
  return existing.sort(internal.ordinalCompare);
}

async function independentHeaderLedger() {
  const headerRoot = path.join(
    process.env.LOCALAPPDATA,
    'node-gyp',
    'Cache',
    '24.13.0',
    'include',
    'node',
  );
  const names = [
    'node_api.h',
    'node_api_types.h',
    'js_native_api.h',
    'js_native_api_types.h',
    'node_version.h',
  ].sort(internal.ordinalCompare);
  const rows = [];
  for (const name of names) {
    const bytes = await fsp.readFile(path.join(headerRoot, name));
    rows.push(
      Buffer.concat([
        Buffer.from(name),
        Buffer.from([0]),
        Buffer.from(String(bytes.length)),
        Buffer.from([0]),
        Buffer.from(sha256(bytes)),
        Buffer.from('\n'),
      ]),
    );
  }
  return sha256(Buffer.concat(rows));
}

async function snapshotRecoveryPacket() {
  const paths = [
    'STATE_COMPATIBILITY.md',
    'scripts/build-windows-native.cjs',
    'scripts/clean-windows-native.cjs',
    'test/windows-native-build.test.cjs',
  ];
  const files = {};
  for (const relative of paths) {
    const bytes = await fsp.readFile(path.join(REPOSITORY_ROOT, relative));
    files[relative] = Object.freeze({
      byteLength: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return Object.freeze({
    files: Object.freeze(files),
    releaseEntries: Object.freeze(await releaseEntries()),
  });
}

async function assertMirrorProcessesAndPipeAbsent(mirror, pipeName) {
  const processEvidence = await captureCandidateProcesses(
    mirror.buildScript,
    mirror.cleanScript,
    mirror.release,
  );
  assert.equal(processEvidence.confirmed, true);
  assert.equal(
    processEvidence.processes.every(
      (entry) =>
        entry.classification === 'ambiguous' &&
        ambiguousProcessBaseline.has(processEvidenceKey(entry)),
    ),
    true,
  );
  assert.equal(await inventoryPipe(pipeName), 'absent');
}

function assertNoRemovalEvents(events) {
  assert.equal(events.some((event) => event.startsWith('remove:')), false);
}

function assertExactTargetMap(actual, expected) {
  assert.deepEqual(actual, expected);
}

function withoutExtendedPrefix(target) {
  return target.startsWith('\\\\?\\') ? target.slice(4) : target;
}

async function runAncestorRebindingCase(selectTarget, hookName) {
  const sandbox = await createSandbox();
  const external = await createSandbox();
  const sentinel = path.join(external, 'external-sentinel.txt');
  await fsp.writeFile(sentinel, 'external-sentinel\n', { flag: 'wx' });
  const externalMetadata = await fsp.lstat(external, { bigint: true });
  const sentinelBytes = await fsp.readFile(sentinel);
  const sentinelHash = sha256(sentinelBytes);
  let rebound = null;

  const hooks = {
    [hookName]: async (plan) => {
      const target = selectTarget(plan);
      assert.equal(typeof target, 'string');
      const moved = target + '.moved';
      await fsp.rename(target, moved);
      await fsp.symlink(external, target, 'junction');
      rebound = Object.freeze({ target, moved });
    },
  };
  const result = await cleanTest.exerciseCleanScenario(
    sandbox,
    'positive',
    hooks,
  );
  assertCleanError(
    result,
    'positive',
    CLEAN_IDENTITY_CHANGED,
  );
  assertNoRemovalEvents(result.events);
  assert.notEqual(rebound, null);

  const junction = await fsp.lstat(rebound.target, { bigint: true });
  assert.equal(junction.isSymbolicLink(), true);
  const linkedTarget = withoutExtendedPrefix(
    await fsp.readlink(rebound.target),
  );
  assert.equal(
    internal.sameWindowsPath(path.resolve(linkedTarget), external),
    true,
  );
  const externalAfter = await fsp.lstat(external, { bigint: true });
  assert.equal(
    internal.sameIdentity(externalAfter, internal.identityOf(externalMetadata), false),
    true,
  );
  assert.equal(sha256(await fsp.readFile(sentinel)), sentinelHash);

  await fsp.unlink(rebound.target);
  assert.equal(await exists(rebound.target), false);
  assert.equal(sha256(await fsp.readFile(sentinel)), sentinelHash);
  await fsp.rename(rebound.moved, rebound.target);
  await internal.authenticatePath(rebound.target, 'directory');
  await internal.assertNoReparse(rebound.target);
  await boundedNoFollowInventory(sandbox);

  await removeSandbox(sandbox);
  await removeSandbox(external);
}

describe('Section 80 dual-channel observation contract', { concurrency: false }, () => {
const fs = require('node:fs');
const { DualChannel, PHASES, primitiveSnapshot } = createDualChannelObservation();
const { RelationshipRegistry } = createObservationRelationships();
class Socket { destroyed = false; closed = false; }
class Server { }
const diag = x => x === 'stdout' ? { category: 'DIAGNOSTIC_TRANSPORT_OWNED', role: 'diagnostic-stdout', proof: 'fixture exact stdout' } : { category: 'DIAGNOSTIC_TRANSPORT_OWNED', role: 'diagnostic-stderr', proof: 'fixture exact stderr' };
function exercise(options = {}) {
  const registry = options.registry || new RelationshipRegistry();
  const tier = new DualChannel();
  const stdout = new Socket(), stderr = new Socket();
  const provenance = new WeakMap([[stdout, diag('stdout')], [stderr, diag('stderr')]]);
  const lease = new Server();
  if (options.lease) provenance.set(lease, { category: 'WORKLOAD_OWNED', role: 'exclusive-lease-server', proof: 'exact lease fixture', exactLease: true, closeObserved: options.closeObserved !== false, listening: false });
  const extra = options.extra || [];
  for (const [x, p] of extra) if (p) provenance.set(x, p);
  const oldH = process._getActiveHandles, oldR = process._getActiveRequests;
  const artifacts = [];
  try {
    for (const phase of PHASES) {
      const handles = phase === 'baseline' ? [] : [stdout, stderr, ...(options.lease && (['settled','I1','I2'].includes(phase) || options.persistLease) ? [lease] : []), ...extra.map(([x]) => x)];
      const requests = phase === 'baseline' ? [] : options.requests || [];
      let hc = 0, rc = 0;
      process._getActiveHandles = () => { hc++; return handles; };
      process._getActiveRequests = () => { rc++; return requests; };
      const sampler = () => {
        assert.equal(process._getActiveHandles(), handles);
        assert.equal(process._getActiveRequests(), requests);
        if (options.doubleSample) process._getActiveHandles();
        const count = list => list.reduce((acc, x) => { const n = x.constructor.name; acc[n] = (acc[n] || 0) + 1; return acc; }, {});
        return { snapshot: { handles: count(handles), requests: count(requests) }, handleDeltas: count(handles), requestDeltas: count(requests) };
      };
      tier.captureSameCall(phase, sampler, x => provenance.get(x), registry, r => {
        if (options.appendFail) throw new Error('append failure fixture');
        if (options.serializeFail) { r.circular = r; JSON.stringify(r); }
        artifacts.push(JSON.parse(JSON.stringify(r)));
      }, { leaseCloseDone: options.leaseCloseDone !== false });
      assert.equal(hc, options.doubleSample ? 2 : 1);assert.equal(rc, 1);
      assert.equal(process._getActiveHandles() , handles);
    }
  } finally { process._getActiveHandles = oldH; process._getActiveRequests = oldR; }
  return { ...tier.result(), artifacts, registry: registry.state() };
}
it('01 raw diagnostic Socket2 remains Socket2 while workload passes', () => {
  const r = exercise();assert.equal(r.disposition, 'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');assert.equal(r.diagnosticPair, true);
  for (const phase of r.phases.slice(1)) { assert.deepEqual(phase.raw.handleDeltas, { Socket: 2 });assert.equal(phase.counts.DIAGNOSTIC_TRANSPORT_OWNED, 2); }
});
it('02 exact transient lease is allowed and absent at quiescence', () => {
  const r = exercise({ lease: true });assert.equal(r.disposition, 'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');
  assert.equal(r.phases.find(p => p.phase === 'I1').counts.WORKLOAD_OWNED, 1);assert.equal(r.phases.at(-1).counts.WORKLOAD_OWNED, 0);
});
it('03 lease Server beyond quiescence fails', () => assert.equal(exercise({ lease: true, persistLease: true }).disposition, 'DUAL_CHANNEL_VALID_WORKLOAD_LIFECYCLE_FAILURE_IDENTIFIED'));
it('04 workload Socket not masked by exact diagnostic pair', () => assert.equal(exercise({ extra: [[new Socket(), { category: 'WORKLOAD_OWNED', role: 'child:1:stdout', proof: 'exact child returned stdio' }]] }).disposition, 'DUAL_CHANNEL_VALID_WORKLOAD_LIFECYCLE_FAILURE_IDENTIFIED'));
it('05 unknown Socket blocks', () => assert.equal(exercise({ extra: [[new Socket(), null]] }).disposition, 'DUAL_CHANNEL_VALID_UNKNOWN_OWNERSHIP_BLOCK'));
it('06 unknown Server blocks', () => assert.equal(exercise({ extra: [[new Server(), null]] }).disposition, 'DUAL_CHANNEL_VALID_UNKNOWN_OWNERSHIP_BLOCK'));
it('07 lifetime churn256 with at most three concurrent refs stays valid', () => {
  const r = new RelationshipRegistry();let previous=[];
  for(let i=0;i<256;i++) { for(const x of previous) { x.destroyed=true;x.closed=true; } previous=[new Socket(),new Socket(),new Socket()];for(const x of previous) assert.equal(r.register(x, 'child-stream', null), true); }
  const state=r.state();assert.equal(state.attempts,768);assert.equal(state.valid,true);assert.equal(state.live,3);assert.equal(state.peak,3);assert.equal(state.retired,765);
});
it('08 physical concurrent capacity128 passes', () => { const r=new RelationshipRegistry();const refs=Array.from({length:128},()=>new Socket());for(const x of refs)assert.equal(r.register(x,'live',null),true);assert.equal(r.state().live,128); });
it('09 concurrent capacity129 invalidates all ownership claims', () => { const r=new RelationshipRegistry();const refs=Array.from({length:129},()=>new Socket());for(const x of refs)r.register(x,'live',null);assert.equal(r.state().valid,false);assert.equal(r.state().live,128);assert.equal(r.lookup(refs[0]),'unattributed-target-socket');assert.equal(exercise({registry:r}).disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID'); });

it('11 exact target cap4 including all constructors passes', () => { const r=exercise({ extra:[[new Socket(),{category:'TEST_PARENT_OWNED',role:'fixture-parent',proof:'exact'}],[new Server(),{category:'TEST_PARENT_OWNED',role:'fixture-parent-server',proof:'exact'}]] });assert.equal(r.disposition,'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED'); });
it('12 target cap5 fails closed no partial table', () => { const r=exercise({extra:Array.from({length:3},()=>[new Socket(),diag('stdout')])});assert.equal(r.disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID');assert.deepEqual(r.phases.at(-1).ownership,[]); });
it('13 same-snapshot arrays/content/order and exactly one sample', () => { const r=exercise({lease:true});for(const p of r.phases) { assert.deepEqual(p.integrity.calls,{handles:1,requests:1});assert.deepEqual(p.integrity.preserved,{handles:true,requests:true});assert.equal(p.integrity.exactArrayReturned,true);assert.equal(p.integrity.restored,true); } });
it('14 extra handle enumeration invalidates', () => assert.equal(exercise({doubleSample:true}).disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID'));
it('15 no stream or lifetime methods invoked', () => {
  const x=new Socket();for(const method of ['on','once','resume','setEncoding','destroy','end','ref','unref','setTimeout'])x[method]=()=>{throw new Error('neutrality violation '+method);};
  const r=new RelationshipRegistry();const before=Object.getOwnPropertyDescriptors(x);assert.equal(r.register(x,'exact',null),true);r.state();r.lookup(x);assert.deepEqual(Object.getOwnPropertyDescriptors(x),before);
  const code=createDualChannelObservation.toString()+createObservationRelationships.toString();
  assert.doesNotMatch(code,/\.(?:resume|setEncoding|destroy|end|ref|unref|on|once)\s*\(/);assert.doesNotMatch(code,/setTimeout\s*\(|setImmediate\s*\(|_getActiveHandles\s*\(/);
});
it('16 append failure invalidates and prevents certification', () => assert.equal(exercise({appendFail:true}).disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID'));
it('17 serialization failure invalidates', () => assert.equal(exercise({serializeFail:true}).disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID'));
it('18 unknown active request blocks', () => assert.equal(exercise({requests:[{}]}).disposition,'DUAL_CHANNEL_VALID_UNKNOWN_OWNERSHIP_BLOCK'));
it('19 lease close milestone missing invalidates', () => assert.equal(exercise({lease:true,leaseCloseDone:false}).disposition,'DUAL_CHANNEL_OBSERVATION_INTEGRATION_INVALID'));
it('20 retirement requires both exact terminal properties', () => {const r=new RelationshipRegistry();const refs=Array.from({length:128},()=>new Socket());for(const x of refs)r.register(x,'live',null);refs[0].destroyed=true;assert.equal(r.state().live,128);refs[0].closed=true;assert.equal(r.state().live,127);assert.equal(r.register(new Socket(),'live',null),true);});
it('21 retirement retains weak provenance for returned positive', () => {const r=new RelationshipRegistry(),x=new Socket();r.register(x,'workload',null);x.destroyed=true;x.closed=true;assert.equal(r.state().live,0);assert.equal(r.lookup(x),'workload');});
it('22 conflicting exact provenance invalidates', () => {const r=new RelationshipRegistry(),x=new Socket();assert.equal(r.register(x,'first',null),true);assert.equal(r.register(x,'second',null),false);assert.equal(r.state().valid,false);});
it('23 lease missing exact close proof is a lifecycle failure', () => assert.equal(exercise({lease:true,closeObserved:false}).disposition,'DUAL_CHANNEL_VALID_WORKLOAD_LIFECYCLE_FAILURE_IDENTIFIED'));

// Sprint07 complete count/reference matrix uses the original single sample.
class FSReqPromise {}
class OtherRequest {}
function turnover(sequence, category=null, mutate=null) {
 const tier=new DualChannel(),reg=new RelationshipRegistry(),out=new Socket(),err=new Socket();
 const all=new Set(sequence.flat()),owners=new WeakMap([[out,diag('stdout')],[err,diag('stderr')]]);
 for(const x of all)if(category)owners.set(x,{category,role:'qualified-exact-request-operation',proof:'fixture exact request binding'});
 const oh=process._getActiveHandles,or=process._getActiveRequests,records=[];
 const live={leaseCloseDone:false,productionPhases:[],owner:{state:'initial'},relationship:{live:true},counters:{accepted:0}};
 const counts=xs=>xs.reduce((a,x)=>(a[x.constructor.name]=(a[x.constructor.name]||0)+1,a),{});
 const bc=counts(sequence[0]);
 try {PHASES.forEach((phase,i)=>{
   const h=i?[out,err]:[],q=sequence[i]||[];let hc=0,rc=0;
   live.leaseCloseDone=i>0;live.owner.state=phase;live.productionPhases.push(phase);live.counters.accepted=i;live.relationship.live=i<3;
   process._getActiveHandles=()=>{hc++;return h;};process._getActiveRequests=()=>{rc++;return q;};
   const historical={snapshot:{handles:counts(h),requests:counts(q)},handleDeltas:counts(h),requestDeltas:Object.fromEntries(Object.entries(counts(q)).map(([n,c])=>[n,c-(bc[n]||0)]).filter(([,c])=>c>0))};
   tier.captureSameCall(phase,()=>{assert.equal(process._getActiveHandles(),h);assert.equal(process._getActiveRequests(),q);return historical;},x=>owners.get(x),reg,r=>records.push(r),live);
   assert.equal(hc,1);assert.equal(rc,1);if(mutate)mutate(live,records,i,historical);
 });}finally{process._getActiveHandles=oh;process._getActiveRequests=or;}
 return {result:tier.result(),records,live};
}
it('S07-A same exact request persists with zero count delta',()=>{
 const a=new FSReqPromise(),r=turnover([[a],[a],[],[],[],[]]);const s=r.records[1];
 assert.deepEqual(s.raw.requestDeltas,{});assert.equal(s.requestContinuity.persisted,1);assert.equal(s.requestContinuity.newlyPresent,0);assert.equal(s.requestContinuity.retiredCount,0);assert.equal(s.requestContinuity.baselinePresent,1);
});
it('S07-B same-constructor turnover A to B with zero count delta',()=>{
 const a=new FSReqPromise(),b=new FSReqPromise(),r=turnover([[a],[b],[],[],[],[]]);const s=r.records[1];
 assert.deepEqual(s.raw.requestDeltas,{});assert.equal(s.requestContinuity.persisted,0);assert.equal(s.requestContinuity.newlyPresent,1);assert.equal(s.requestContinuity.retiredCount,1);assert.equal(s.requestContinuity.current[0].continuity,'NEW_REFERENCE_SAME_CONSTRUCTOR');assert.equal(s.requestContinuity.retired[0].constructor,'FSReqPromise');assert.equal(s.requestContinuity.baselinePresent,0);assert.notEqual(s.requestContinuity.current[0].requestId,s.requestContinuity.retired[0].requestId);
});
it('S07-C positive count growth +1 remains independent',()=>{
 const a=new FSReqPromise(),b=new FSReqPromise(),r=turnover([[a],[a,b],[],[],[],[]]);const s=r.records[1];assert.deepEqual(s.raw.requestDeltas,{FSReqPromise:1});assert.equal(s.requestContinuity.persisted,1);assert.equal(s.requestContinuity.newlyPresent,1);
});
it('S07-D count reduction omits negative delta and retires exact A',()=>{
 const a=new FSReqPromise(),r=turnover([[a],[],[],[],[],[]]);assert.deepEqual(r.records[1].raw.requestDeltas,{});assert.equal(r.records[1].requestContinuity.retiredCount,1);
});
it('S07-E turnover then empty I1/terminal does not imply request leak',()=>{
 const r=turnover([[new FSReqPromise()],[new FSReqPromise()],[],[],[],[]]);assert.equal(r.records[1].counts.UNKNOWN_OWNERSHIP,1);assert.equal(r.records[1].workloadGate,'PASS');assert.equal(r.result.disposition,'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');assert.equal(r.records[2].requestContinuity.retiredCount,1);assert.equal(r.records[5].requestContinuity.present,0);
});
it('S07-F unknown request persists through I8 fails closed',()=>{
 const a=new FSReqPromise(),r=turnover([[a],[a],[a],[a],[a],[a]]);assert.equal(r.result.disposition,'DUAL_CHANNEL_VALID_UNKNOWN_OWNERSHIP_BLOCK');assert.equal(r.records[5].requiredCounts.unknown,1);
});
it('S07-G exact workload-owned request persists through I8 is failure',()=>{
 const a=new FSReqPromise(),r=turnover([[a],[a],[a],[a],[a],[a]],'WORKLOAD_OWNED');assert.equal(r.result.disposition,'DUAL_CHANNEL_VALID_WORKLOAD_LIFECYCLE_FAILURE_IDENTIFIED');assert.equal(r.records[5].requiredCounts.workload,1);
});
it('S07-H diagnostic/test-parent exact request provenance domains',()=>{
 for(const c of ['DIAGNOSTIC_TRANSPORT_OWNED','TEST_PARENT_OWNED']){const a=new FSReqPromise(),r=turnover([[a],[a],[a],[a],[a],[a]],c);assert.equal(r.result.disposition,'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');assert.equal(r.records[5].counts[c],c==='DIAGNOSTIC_TRANSPORT_OWNED'?3:1);assert.equal(r.records[5].counts.WORKLOAD_OWNED,0);}
});
it('S07-IMM-A baseline-before-close preserves original lifecycle',()=>{
 const r=turnover([[],[],[],[],[],[]]);assert.equal(r.live.leaseCloseDone,true);assert.equal(r.records[0].lifecycle.leaseCloseDone,false);assert.deepEqual(r.records[0].lifecycle.productionPhases,['baseline']);
});
it('S07-IMM-B multi-phase owner and phase divergence',()=>{
 const r=turnover([[],[],[],[],[],[]]);assert.deepEqual([0,1,2,5].map(i=>r.records[i].lifecycle.owner.state),['baseline','settled','I1','I8']);assert.notEqual(r.records[0].lifecycle,r.records[1].lifecycle);
});
it('S07-IMM-C relationship retirement retains live-at-A truth',()=>{
 const r=turnover([[],[],[],[],[],[]]);assert.equal(r.records[0].lifecycle.relationship.live,true);assert.equal(r.records[5].lifecycle.relationship.live,false);
});
it('S07-IMM-D continuing counters preserve contemporaneous values',()=>{
 const r=turnover([[],[],[],[],[],[]]);assert.deepEqual(r.records.map(x=>x.lifecycle.counters.accepted),[0,1,2,3,4,5]);
});
it('S07-IMM-E persisted evidence round-trip independently recovers phases',()=>{
 const r=turnover([[],[],[],[],[],[]]);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moxley-observation-roundtrip-'));const dest=path.join(dir,'phases.json');try{fs.writeFileSync(dest,JSON.stringify(r.records),{flag:'wx'});const read=JSON.parse(fs.readFileSync(dest));assert.deepEqual(read,r.records);assert.equal(read[0].lifecycle.leaseCloseDone,false);assert.equal(read[5].lifecycle.leaseCloseDone,true);}finally{fs.unlinkSync(dest);fs.rmdirSync(dir);}
});
it('S07-IMM-F adversarial live mutation leaves sealed bytes identical',()=>{
 let sealed;
 const r=turnover([[],[],[],[],[],[]],null,(live,records,i,raw)=>{
  if(i===0)sealed=JSON.stringify(records[0]);live.owner.state='tampered';live.relationship.live=false;live.counters.accepted=999;live.productionPhases.push('tampered');raw.requestDeltas.changed=99;assert.equal(JSON.stringify(records[0]),sealed);assert.throws(()=>{records[0].lifecycle.owner.state='retrospective';},TypeError);
 });assert.equal(JSON.stringify(r.records[0]),sealed);
});
it('S07 new constructor replacement explicit and count delta truthful',()=>{
 const r=turnover([[new FSReqPromise()],[new OtherRequest()],[],[],[],[]]);assert.equal(r.records[1].requestContinuity.current[0].continuity,'NEW_REFERENCE_NEW_CONSTRUCTOR');assert.deepEqual(r.records[1].raw.requestDeltas,{OtherRequest:1});
});
it('S07 native references and unbounded primitive snapshots refused',()=>{
 assert.throws(()=>primitiveSnapshot({native:new Socket()}),/snapshot-native-reference/);assert.throws(()=>primitiveSnapshot(Array(513).fill(0)),/snapshot-array-bound/);const x={};x.loop=x;assert.throws(()=>primitiveSnapshot(x),/snapshot-bound/);
});

it('S07 controlling native baseline counts-only token and exact FSReqPromise turnover',()=>{
 const tier=new DualChannel(),reg=new RelationshipRegistry(),a=new FSReqPromise(),b=new FSReqPromise(),out=new Socket(),err=new Socket();
 const h0=process._getActiveHandles,q0=process._getActiveRequests,records=[];
 try{for(const phase of PHASES){const h=phase==='baseline'?[]:[out,err],q=phase==='baseline'?[a]:phase==='settled'?[b]:[];let hc=0,rc=0;
  process._getActiveHandles=()=>{hc++;return h;};process._getActiveRequests=()=>{rc++;return q;};
  const raw=phase==='baseline'?{handles:[],requests:[{type:'FSReqPromise',count:1}]}:{snapshot:{handles:[{type:'Socket',count:2}],requests:q.length?[{type:'FSReqPromise',count:1}]:[]},handleDeltas:{Socket:2},requestDeltas:{}};
  tier.captureSameCall(phase,()=>{assert.equal(process._getActiveHandles(),h);assert.equal(process._getActiveRequests(),q);return raw;},x=>x===out?diag('stdout'):x===err?diag('stderr'):null,reg,r=>records.push(r),{leaseCloseDone:phase!=='baseline'});
  assert.equal(hc,1);assert.equal(rc,1);assert.deepEqual(records.at(-1).raw,raw);
 }}finally{process._getActiveHandles=h0;process._getActiveRequests=q0;}
 assert.equal(tier.result().disposition,'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');assert.equal(records[0].raw.requestDeltas,undefined);assert.equal(records[1].requestContinuity.current[0].continuity,'NEW_REFERENCE_SAME_CONSTRUCTOR');assert.deepEqual(records[1].raw.requestDeltas,{});
});

it('canonical controller reuses exactly the established eight immediate turns with rich tier invalid', async () => {
 const schedules=[],captures=[];
 const {runCorrectedController}=createObservationController();
 const result=await runCorrectedController({
  witness:{observe:async(label,operation)=>{if(label.startsWith('schedule-immediate-'))schedules.push(label);return operation();}},
  observerInvalid:()=>false,richInvalid:()=>true,markRichInvalid:()=>assert.fail('unexpected rich failure'),
  evidenceInvalid:()=>false,markEvidenceInvalid:()=>assert.fail('unexpected evidence failure'),
  captureSample:()=>assert.fail('rich tier must stay independent'),
  commitPhase:phase=>{if(['settled','immediate-2','immediate-4','immediate-8'].includes(phase))captures.push(phase);},
  captureOneTurnConstructorEvidence:()=>{captures.push('immediate-1');return {};},
  buildEvidence:()=>assert.fail('rich tier must stay independent'),phaseReached:()=>{},
 });
 assert.deepEqual(schedules,Array.from({length:8},(_,i)=>'schedule-immediate-'+(i+1)));
 assert.deepEqual(captures,['settled','immediate-1','immediate-2','immediate-4','immediate-8']);
 assert.equal(result.completed,true);assert.equal(result.richValid,false);assert.equal(result.evidenceValid,true);
 assert.equal(exercise().disposition,'DUAL_CHANNEL_OBSERVATION_CONTRACT_VALIDATED');
});

it('ordinary observation output obeys bounded teardown and unknown filenames still refuse', async () => {
 const root=await createSandbox();
 const observation=path.join(root,'.section80-observation.json');
 const unknown=path.join(root,'.unexpected-observation.json');
 let unknownCreated=false;
 try {
  await fsp.writeFile(observation,'{}\n',{flag:'wx'});
  const inventory=await boundedNoFollowInventory(root);
  assert.equal(inventory.some(row=>row.relative==='.section80-observation.json'),true);
  await fsp.writeFile(unknown,'unknown fixture',{flag:'wx'});unknownCreated=true;
  await assert.rejects(boundedNoFollowInventory(root));
 } finally {
  if(unknownCreated){await internal.authenticatePath(unknown,'file');await internal.assertNoReparse(unknown);await fsp.unlink(unknown);}
  await removeSandbox(root);
 }
});

it('canonical parent gate refuses invalid observation and relationship state', () => {
 for(const field of ['observerValid','wrappersRestored','phasesFrozen']) {
  const value={schema:'moxley-section80-observation-v1',runId:'fixture',observerValid:true,wrappersRestored:true,phasesFrozen:true};
  value[field]=false;assert.throws(()=>assertSection80Observation(value,'fixture',{}));
 }
 assert.throws(()=>assertSection80Observation({schema:'moxley-section80-observation-v1',runId:'fixture',observerValid:true,wrappersRestored:true,phasesFrozen:true,observation:{valid:false,reasons:['relationship-registry-invalid']}},'fixture',{}));
});
});

describe('Section 80 exact-host authentication regression', () => {
  const host = Object.freeze({
    caption: 'Microsoft Windows 11 Home',
    displayVersion: '25H2',
    build: '26200.9457',
    driveType: 'Fixed',
    driveFormat: 'NTFS',
  });
  const runtime = {
    platform: 'win32', arch: 'x64', version: 'v24.13.0',
    versions: { modules: '137', napi: '10' },
  };
  const rejectsInput = (callback) => assert.throws(callback, {
    code: 'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
  });

  it('accepts only the current characterized host and captures live host evidence', async () => {
    assert.deepEqual(buildTest.validateHostEvidence(host), host);
    assert.deepEqual(await buildTest.authenticateHost(REPOSITORY_ROOT), host);
  });

  it('rejects stale and uncharacterized builds with expected and actual diagnostics', () => {
    for (const build of ['26200.9168', '26200.9458', '26100.9457', '', 26200]) {
      assert.throws(() => buildTest.validateHostEvidence({ ...host, build }), (error) => {
        assert.equal(error.code, 'MOXLEY_NATIVE_BUILD_INPUT_INVALID');
        assert.match(error.message, /build expected=26200\.9457 actual=/);
        assert.equal(error.message.includes(String(build)), true);
        assert.equal(internal.formatDiagnostic(error).includes('expected=26200.9457'), true);
        return true;
      });
    }
  });

  it('rejects nonfixed nonNTFS editions versions and malformed host evidence', () => {
    for (const [key, values] of Object.entries({
      caption: ['Microsoft Windows 11 Pro', 'Microsoft Windows 10 Home'],
      displayVersion: ['24H2', '26H2'],
      driveType: ['Network', 'Removable', 'Unknown'],
      driveFormat: ['ReFS', 'FAT32', ''],
    })) {
      for (const value of values) rejectsInput(() => buildTest.validateHostEvidence({ ...host, [key]: value }));
    }
    for (const key of Object.keys(host)) {
      const missing = { ...host }; delete missing[key];
      rejectsInput(() => buildTest.validateHostEvidence(missing));
    }
    for (const invalid of [null, [], { ...host, extra: true }]) {
      rejectsInput(() => buildTest.validateHostEvidence(invalid));
    }
    assert.throws(() => buildTest.validateHostEvidence({ ...host, build: 'x\ny'.repeat(100) }), (error) => {
      assert.doesNotMatch(error.message, /[\r\n]/);
      assert.equal(error.message.length < 240, true);
      return true;
    });
  });

  it('retains exact platform architecture Node and ABI rejection', () => {
    buildTest.validateNodeRuntimeInputs(runtime);
    for (const [key, value] of [['platform', 'linux'], ['arch', 'arm64'], ['arch', 'ia32'], ['version', 'v24.14.0']]) {
      rejectsInput(() => buildTest.validateNodeRuntimeInputs({ ...runtime, [key]: value }));
    }
    for (const [key, value] of [['modules', '136'], ['napi', '9']]) {
      rejectsInput(() => buildTest.validateNodeRuntimeInputs({ ...runtime, versions: { ...runtime.versions, [key]: value } }));
    }
  });

  it('rejects import-library byte length and digest drift', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moxley-input-regression-'));
    const target = path.join(root, 'import.lib');
    const bytes = Buffer.from('fixed authenticated import bytes');
    await fsp.writeFile(target, bytes, { flag: 'wx' });
    try {
      const expected = { byteLength: bytes.length, sha256: sha256(bytes) };
      assert.deepEqual(await buildTest.authenticateRegularFile(target, expected), expected);
      for (const wrong of [{ ...expected, byteLength: bytes.length + 1 }, { ...expected, sha256: '0'.repeat(64) }]) {
        await assert.rejects(buildTest.authenticateRegularFile(target, wrong), { code: 'MOXLEY_NATIVE_BUILD_INPUT_INVALID' });
      }
    } finally {
      await fsp.unlink(target);
      await fsp.rmdir(root);
    }
  });
});

describe(
  'explicit Windows native build and clean lifecycle',
  { concurrency: false },
  () => {
    before(async () => {
      await assertRepositoryGeneratedStateAbsent();
      const baseline = await captureCandidateProcesses();
      assert.equal(
        baseline.confirmed,
        true,
        'bounded task-owned process baseline must be available',
      );
      assert.equal(
        baseline.processes.every(
          (entry) => entry.classification === 'ambiguous',
        ),
        true,
        'preexisting Moxley or task-rooted processes are not baselineable',
      );
      ambiguousProcessBaseline = new Set(
        baseline.processes.map(processEvidenceKey),
      );
    });

    beforeEach((context) => {
      if (lifecycleFailureObserved) {
        context.skip('Earlier lifecycle failure preserved evidence.');
      }
    });

    afterEach((context) => {
      if (!context.passed) lifecycleFailureObserved = true;
    });

    after(async () => {
      if (
        lifecycleFailureObserved ||
        uncertainRepositoryState ||
        sandboxRoots.size !== 0
      ) {
        lastUncertainInventory = Object.freeze({
          repository: await inventoryRepositoryState(),
          registeredRoots: Object.freeze([...sandboxRoots.keys()]),
        });
        assert.fail(
          'Failed lifecycle state was inventoried and preserved without cleanup.',
        );
      }
      await assertRepositoryGeneratedStateAbsent();
      const finalInventory = await inventoryRepositoryState();
      assert.equal(finalInventory.filesystemEvidenceConfirmed, true);
      assert.equal(finalInventory.artifact, 'absent');
      assert.equal(finalInventory.receipt, 'absent');
      assert.equal(finalInventory.lock, 'absent');
      assert.equal(finalInventory.disposition, 'absent');
      assert.equal(finalInventory.stagingCount, 0);
      assert.equal(finalInventory.pipe, 'absent');
      assert.equal(finalInventory.processEvidenceConfirmed, true);
      assert.equal(finalInventory.taskOwnedProcessCount, 0);
    });

    it(
      'production native source is the single characterized classifier authority',
      async () => {
        assert.equal(HARNESS_PROCESS_TIMEOUT_MS, 300_000);
        assert.equal(D1_DIAGNOSTIC_TIMEOUT_MS, 180_000);
        assert.equal(D1_READ_ONLY_CHECK_TIMEOUT_MS, 15_000);
        assert.equal(buildTest.PROCESS_TIMEOUT_MS, 30_000);
        assert.equal(buildTest.AUTHENTICATION_TIMEOUT_MS, 90_000);
        assert.equal(buildTest.PROBE_TIMEOUT_MS, 10_000);
        assert.equal(buildTest.EXIT_CLOSE_GRACE_MS, 5_000);
        assert.equal(buildTest.TASKKILL_TIMEOUT_MS, 10_000);
        assert.equal(buildTest.POST_TERMINATION_GRACE_MS, 5_000);
        assert.equal(buildTest.MAX_PROCESS_OUTPUT_BYTES, 2 * 1024 * 1024);
        assertHarnessDispositionMatrix();
        assert.deepEqual(await gitTrackedCFiles(), [
          'native/windows-reparse-classifier.c',
        ]);
        assert.equal(await exists(OLD_SOURCE), false);
        const source = await fsp.readFile(SOURCE, 'utf8');
        assert.match(
          source,
          /^\/\/ SPDX-License-Identifier: Apache-2\.0$/m,
        );
        assert.match(source, /Private production Node-API source/);
        assert.match(source, /^#define NAPI_VERSION 8$/m);
        assert.match(
          source,
          /Characterization-only fault injection[\s\S]*#ifdef MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE/,
        );
        const characterization = await fsp.readFile(
          path.join(__dirname, 'windows-reparse-native.test.cjs'),
          'utf8',
        );
        assert.match(
          characterization,
          /REPOSITORY_ROOT,[\s\S]*'native',[\s\S]*'windows-reparse-classifier\.c'/,
        );
        const buildSource = await fsp.readFile(BUILD_SCRIPT, 'utf8');
        assert.doesNotMatch(
          buildSource,
          /\/DMOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE/,
        );
        assert.equal(require('../scripts/build-windows-native.cjs'), buildModule);
        assert.equal(require('../scripts/clean-windows-native.cjs'), cleanModule);
        await assertDiagnosticObservabilityContract();
        await assertRepositoryGeneratedStateAbsent();
      },
    );

    it(
      'explicit native build authenticates the exact offline Windows toolchain',
      async () => {
        const inputs = await buildTest.authenticateBuildInputs();
        assert.deepEqual(inputs.evidence, {
          platform: 'win32',
          architecture: 'x64',
          nodeVersion: 'v24.13.0',
          modulesAbi: '137',
          runtimeNodeApi: '10',
          addonNodeApi: 8,
          buildToolsVersion: '17.14.37516.0',
          msvcVersion: '14.44.35207',
          compilerVersion: '19.44.35228.0',
          linkerVersion: '14.44.35228.0',
          windowsSdkVersion: '10.0.26100.0',
          nodeHeadersTreeSha256:
            'e2075432b5c246d49178646c8333df2c8c857e0b8638c3809b8cc7659d912df7',
          nodeImportLibraryByteLength: 2_869_366,
          nodeImportLibrarySha256:
            'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd',
          kernel32ImportLibraryByteLength: 311_908,
          kernel32ImportLibrarySha256:
            '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb',
        });
        assertBoundedFailure(
          await runNodeScript(BUILD_SCRIPT, ['unexpected']),
        );
        await assertRepositoryGeneratedStateAbsent();
      },
    );

    it(
      'an isolated execution mirror rejects concurrent build and clean while the exclusive lease is active',
      async () => {
        const mirror = await createExecutionMirror();
        const build = path.join(mirror.root, 'build');
        await fsp.mkdir(build, { recursive: false });
        await fsp.mkdir(mirror.release, { recursive: false });
        const canonicalRoot = await fsp.realpath(mirror.root);
        const repositoryKey = internal.repositoryKey(canonicalRoot);
        const pipeName = internal.pipeNameForKey(repositoryKey);
        const stagingName = STAGING_PREFIX + 'b'.repeat(32);
        const record = internal.createV2LockRecord(
          repositoryKey,
          pipeName,
          stagingName,
          'c'.repeat(32),
        );
        const lock = path.join(
          mirror.release,
          '.moxley-windows-reparse-build.lock',
        );
        await fsp.writeFile(
          lock,
          Buffer.from(internal.canonicalJson(record), 'utf8'),
          { flag: 'wx' },
        );
        const server = await startServer(pipeName);
        try {
          const buildResult = await runNodeScript(mirror.buildScript);
          assertBoundedFailure(buildResult);
          assert.match(
            buildResult.stderr.toString('utf8'),
            /^MOXLEY_NATIVE_BUILD_BUSY:/,
          );
          const cleanResult = await runNodeScript(mirror.cleanScript);
          assertBoundedFailure(cleanResult);
          assert.match(
            cleanResult.stderr.toString('utf8'),
            /^MOXLEY_NATIVE_CLEAN_BUSY:/,
          );
        } finally {
          await closeServer(server);
        }
        await assertMirrorProcessesAndPipeAbsent(mirror, pipeName);
        await removeSandbox(mirror.root);
      },
    );

    it(
      'isolated production build handles awaited physical-cleanup deferral, publishes bound cleanup authority, closes its lease, and exits naturally',
      async (context) => {
        const recoveryBefore = await snapshotRecoveryPacket();
        const mirror = await createExecutionMirror();
        const runId = sha256(Buffer.from(mirror.root, 'utf8')).slice(0, 32);
        const result = await runSoleD1Diagnostic(
          mirror.buildScript,
          runId,
        );
        const diagnosticReceipt = result.receipt.bytes.toString('utf8');
        assert.equal(result.disposition.ok, false, diagnosticReceipt);
        assert.equal(
          result.disposition.disposition,
          SUBPROCESS_CODES.exit,
          diagnosticReceipt,
        );
        assert.equal(
          result.disposition.reason,
          'SUBPROCESS_NONZERO_EXIT',
          diagnosticReceipt,
        );
        assert.equal(result.disposition.causeReason, null, diagnosticReceipt);
        assert.equal(
          result.disposition.terminationConfirmed,
          true,
          diagnosticReceipt,
        );
        assert.notEqual(
          result.disposition.disposition,
          SUBPROCESS_CODES.timeout,
          diagnosticReceipt,
        );
        assert.notEqual(
          result.disposition.disposition,
          SUBPROCESS_CODES.termination,
          diagnosticReceipt,
        );
        assert.equal(result.evidence.terminationConfirmed, true);
        assert.equal(result.evidence.exitCode, 1, diagnosticReceipt);
        assert.equal(result.evidence.signal, null, diagnosticReceipt);
        assert.equal(result.evidence.stdoutOverflowed, false);
        assert.equal(result.evidence.stderrOverflowed, false);
        assert.equal(result.evidence.stdoutCompleted, true);
        assert.equal(result.evidence.stderrCompleted, true);
        assert.equal(result.evidence.exitObserved, true);
        assert.equal(result.evidence.closeObserved, true);
        assert.equal(result.evidence.captureComplete, true);
        assert.equal(
          result.evidence.stderr.toString('utf8'),
          'MOXLEY_NATIVE_BUILD_PHYSICAL_CLEANUP_DEFERRED: ' +
            'Secure physical cleanup is unavailable; native build state was retained.\n',
        );
        assert.doesNotMatch(
          result.evidence.stdout.toString('utf8'),
          /"status":"built"/,
        );

        const phases = result.records.map((record) => record.phase);
        const nonEntryMilestones = [
          'RECEIPT_DONE',
          'STAGING_AUTH_2_BEGIN',
          'STAGING_ROOT_BEGIN',
          'STAGING_ROOT_DONE',
          'STAGING_READDIR_DONE',
          'STAGING_AUTH_2_DONE',
          'RECEIPT_VALIDATED',
          'DEFERRAL_CALLED',
          'DEFERRAL_ARTIFACT_ABSENT',
          'DEFERRAL_RECEIPT_ABSENT',
          'DEFERRAL_THROW',
          'RUNBUILD_CATCH_ENTERED',
          'RETENTION_BEGIN',
          'RETENTION_STAGING_DONE',
          'LOCK_AUTH_DONE',
          'LOCK_READBACK_DONE',
          'RETENTION_DISPOSITION_ABSENT',
          'RETENTION_ARTIFACT_ABSENT',
          'RETENTION_RECEIPT_ABSENT',
          'RETENTION_PREPARED',
          'DISPOSITION_BEGIN',
          'DISPOSITION_CREATE_DONE',
          'DISPOSITION_WRITE_DONE',
          'DISPOSITION_SYNC_DONE',
          'DISPOSITION_CLOSE_DONE',
          'DISPOSITION_AUTHENTICATE_DONE',
          'DISPOSITION_READBACK_DONE',
          'DISPOSITION_ACKNOWLEDGED',
          'LEASE_CLOSE_BEGIN',
          'LEASE_CLOSE_DONE',
          'ORIGINAL_ERROR_RETHROWN',
          'RUNBUILD_SETTLED_REJECTED',
          'POST_SETTLEMENT_HANDLES',
          'EXIT_CODE_SET',
        ];
        let previous = -1;
        for (const phase of nonEntryMilestones) {
          assert.equal(
            phaseRecordsByName(result.records, phase).length,
            1,
            diagnosticReceipt,
          );
          const index = phases.indexOf(phase);
          assert.equal(index > previous, true, diagnosticReceipt);
          previous = index;
        }
        const stagingRead = phaseRecordsByName(
          result.records,
          'STAGING_READDIR_DONE',
        );
        const entryBegin = phaseRecordsByName(
          result.records,
          'STAGING_ENTRY_BEGIN',
        );
        const entryDone = phaseRecordsByName(
          result.records,
          'STAGING_ENTRY_DONE',
        );
        assert.equal(stagingRead.length, 1);
        assert.equal(entryBegin.length, stagingRead[0].detail.entryCount);
        assert.deepEqual(
          entryDone.map((record) => record.detail),
          entryBegin.map((record) => record.detail),
        );
        const stagingReadIndex = phases.indexOf('STAGING_READDIR_DONE');
        const stagingAuthDoneIndex = phases.indexOf('STAGING_AUTH_2_DONE');
        for (let index = 0; index < entryBegin.length; index += 1) {
          const beginIndex = result.records.indexOf(entryBegin[index]);
          const doneIndex = result.records.indexOf(entryDone[index]);
          assert.equal(stagingReadIndex < beginIndex, true, diagnosticReceipt);
          assert.equal(beginIndex < doneIndex, true, diagnosticReceipt);
          assert.equal(doneIndex < stagingAuthDoneIndex, true, diagnosticReceipt);
        }
        for (const forbidden of [
          'RUNBUILD_SETTLED_FULFILLED',
          'LEASE_CLOSE_REJECTED',
          'LEASE_CLOSE_TIMEOUT',
          'LEASE_ABANDON_CALLED',
        ]) {
          assert.equal(
            phaseRecordsByName(result.records, forbidden).length,
            0,
            diagnosticReceipt,
          );
        }
        const rejected = phaseRecordsByName(
          result.records,
          'RUNBUILD_SETTLED_REJECTED',
        );
        assert.equal(rejected.length, 1);
        assert.equal(
          rejected[0].detail.code,
          'MOXLEY_NATIVE_BUILD_PHYSICAL_CLEANUP_DEFERRED',
        );
        const postSettlement = phaseRecordsByName(
          result.records,
          'POST_SETTLEMENT_HANDLES',
        );
        assert.equal(postSettlement.length, 1);
        const semanticObservation = assertSection80Observation(
          result.observation, runId, postSettlement[0].detail,
        );
        assert.equal(postSettlement[0].detail.handles.overflow, false);
        assert.equal(postSettlement[0].detail.requests.overflow, false);
        assert.equal(
          result.receipt.value.settlementClassification,
          'REJECTED:MOXLEY_NATIVE_BUILD_PHYSICAL_CLEANUP_DEFERRED',
        );
        assert.equal(
          result.receipt.value.activeHandleRequestDeltaClassification,
          activeDeltaClassification(result.records),
        );
        assert.equal(
          result.receipt.value.lastValidPhase,
          'EXIT_CODE_SET',
        );

        const entries = (await fsp.readdir(mirror.release)).sort(
          internal.ordinalCompare,
        );
        const stagingNames = entries.filter((name) =>
          name.startsWith(STAGING_PREFIX));
        assert.equal(stagingNames.length, 1);
        assert.equal(entries.includes('moxley-windows-reparse.node'), false);
        assert.equal(
          entries.includes('moxley-windows-reparse.receipt.json'),
          false,
        );
        assert.equal(
          entries.includes('.moxley-windows-reparse-build.disposition.json'),
          true,
        );

        const canonicalRoot = await fsp.realpath(mirror.root);
        const repositoryKey = internal.repositoryKey(canonicalRoot);
        const pipeName = internal.pipeNameForKey(repositoryKey);
        const lockPath = path.join(
          mirror.release,
          '.moxley-windows-reparse-build.lock',
        );
        const dispositionPath = path.join(
          mirror.release,
          '.moxley-windows-reparse-build.disposition.json',
        );
        const lockBytes = await fsp.readFile(lockPath);
        const lock = internal.decodeV2LockBytes(
          lockBytes,
          repositoryKey,
          pipeName,
        );
        assert.equal(lock.lockVersion, 2);
        assert.equal(lock.disposition, 'ACTIVE');
        assert.equal(lock.stagingName, stagingNames[0]);
        assertCanonicalCarrierBytes(lockBytes.toString('utf8'), lock);
        const expectedReleaseEntries = [
          '.moxley-windows-reparse-build.disposition.json',
          '.moxley-windows-reparse-build.lock',
          lock.stagingName,
        ].sort(internal.ordinalCompare);
        assert.deepEqual(entries, expectedReleaseEntries);

        const dispositionBytes = await fsp.readFile(dispositionPath);
        const disposition = internal.decodeDispositionBytes(
          dispositionBytes,
          lock,
        );
        assert.equal(disposition.dispositionVersion, 1);
        assert.equal(disposition.lockVersion, 2);
        assert.equal(disposition.disposition, 'CLEAN_AUTHORIZED');
        assert.equal(disposition.reason, null);
        assert.equal(disposition.causeReason, null);
        for (const key of [
          'repositoryKey',
          'pipeName',
          'stagingName',
          'nonce',
        ]) {
          assert.equal(disposition[key], lock[key]);
        }
        assertCanonicalCarrierBytes(
          dispositionBytes.toString('utf8'),
          disposition,
        );

        const staging = path.join(mirror.release, lock.stagingName);
        const stagedAddon = path.join(
          staging,
          'moxley-windows-reparse.node',
        );
        const stagedReceipt = path.join(
          staging,
          'moxley-windows-reparse.receipt.json',
        );
        const stagedProbe = path.join(
          staging,
          'moxley-windows-reparse-probe.txt',
        );
        for (const target of [stagedAddon, stagedReceipt, stagedProbe]) {
          await internal.authenticatePath(target, 'file');
        }
        const receiptBytes = await fsp.readFile(stagedReceipt);
        const receipt = buildTest.decodeReceiptBytes(receiptBytes);
        const stagedAddonBytes = await fsp.readFile(stagedAddon);
        const sourceBytes = await fsp.readFile(
          path.join(mirror.root, 'native', 'windows-reparse-classifier.c'),
        );
        assert.equal(receipt.source.byteLength, sourceBytes.length);
        assert.equal(receipt.source.sha256, sha256(sourceBytes));
        assert.equal(receipt.artifact.byteLength, stagedAddonBytes.length);
        assert.equal(receipt.artifact.sha256, sha256(stagedAddonBytes));
        assert.equal(receipt.toolchain.msvcVersion, '14.44.35207');
        assert.equal(receipt.toolchain.compilerVersion, '19.44.35228.0');
        assert.equal(receipt.toolchain.linkerVersion, '14.44.35228.0');

        const buildSource = await fsp.readFile(mirror.buildScript, 'utf8');
        const compilation = buildSource.indexOf(
          'await compileProductionAddon(paths, inputs.toolchain);',
        );
        const stagedAuthentication = buildSource.indexOf(
          'await authenticateStagingDirectory(state);',
          compilation,
        );
        const stagedProbeOrder = buildSource.indexOf(
          'await runProbe(paths.stagedAddon, paths.probeFile);',
          stagedAuthentication,
        );
        const receiptWrite = buildSource.indexOf(
          'const expected = await writeReceipt(paths, inputs.toolchain);',
          stagedProbeOrder,
        );
        const deferral = buildSource.indexOf(
          'return await deferBeforePromotion(state);',
          receiptWrite,
        );
        assert.equal(
          buildSource.includes('    return deferBeforePromotion(state);'),
          false,
        );
        assert.equal(
          [compilation, stagedAuthentication, stagedProbeOrder, receiptWrite,
            deferral].every((index) => index >= 0),
          true,
        );
        assert.equal(compilation < stagedAuthentication, true);
        assert.equal(stagedAuthentication < stagedProbeOrder, true);
        assert.equal(stagedProbeOrder < receiptWrite, true);
        assert.equal(receiptWrite < deferral, true);

        const physicalInventory = await boundedHashedInventory(mirror.root);
        const classification =
          'AWAITED_DEFERRAL_HANDLED_NATURAL_EXIT_CONFIRMED';
        const teardown = await authorizeDiagnosticTeardown(
          mirror,
          pipeName,
          physicalInventory,
          recoveryBefore,
        );
        assert.equal(classification,
          'AWAITED_DEFERRAL_HANDLED_NATURAL_EXIT_CONFIRMED');
        await removeSandbox(mirror.root, teardown.authorization);
        assert.equal(await exists(mirror.root), false);
        assert.deepEqual(await snapshotRecoveryPacket(), recoveryBefore);

        context.diagnostic(
          'D1_SUPERVISOR_RECEIPT ' + diagnosticReceipt.trimEnd(),
        );
        context.diagnostic(
          'D1_PHASE_RECEIPT ' + JSON.stringify({
            runId,
            count: result.records.length,
            phases,
          }),
        );
        context.diagnostic('SECTION80_OBSERVATION ' + JSON.stringify(semanticObservation));
        context.diagnostic('D1_CLASSIFICATION ' + classification);
        context.diagnostic(
          'D1_PHYSICAL_INVENTORY ' + JSON.stringify(physicalInventory),
        );
        context.diagnostic(
          'D1_TEARDOWN_RECEIPT ' + JSON.stringify(teardown.receipt),
        );
      },
    );

    it(
      'v2 build lock uses the exact immutable ACTIVE schema and canonical bytes',
      async () => {
        const sandbox = await createSandbox();
        const result = await buildTest.exerciseCarrierScenario(sandbox, {
          disposition: 'CLEAN_AUTHORIZED',
          fault: 'none',
        });
        assert.equal(Object.isFrozen(result), true);
        assert.deepEqual(Object.keys(result.lock.record), LOCK_V2_KEYS);
        assert.equal(result.lock.record.lockFormat, 'moxley-native-build-lock');
        assert.equal(result.lock.record.lockVersion, 2);
        assert.match(result.lock.record.repositoryKey, /^[0-9a-f]{64}$/);
        assert.equal(
          result.lock.record.pipeName,
          '\\\\.\\pipe\\moxley-native-build-' +
            result.lock.record.repositoryKey.slice(0, 32),
        );
        assert.match(
          result.lock.record.stagingName,
          /^\.moxley-windows-reparse-stage-[0-9a-f]{32}$/,
        );
        assert.match(result.lock.record.nonce, /^[0-9a-f]{32}$/);
        assert.equal(result.lock.record.disposition, 'ACTIVE');
        assertCanonicalCarrierBytes(result.lock.bytes, result.lock.record);
        assert.deepEqual(
          internal.classifyLockCarrierBytes(
            Buffer.from(result.lock.bytes, 'utf8'),
            result.lock.record.repositoryKey,
            result.lock.record.pipeName,
          ),
          { kind: 'ACTIVE_V2', record: result.lock.record },
        );
        assertCarrierJournal(result);
        await removeSandbox(sandbox);
      },
    );

    it(
      'terminal disposition records use exact canonical schemas and bind every copied lock field',
      async () => {
        for (const dispositionName of [
          'CLEAN_AUTHORIZED',
          'TERMINATION_UNCONFIRMED',
        ]) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseCarrierScenario(sandbox, {
            disposition: dispositionName,
            fault: 'none',
          });
          assert.equal(result.acknowledged, true);
          assert.equal(result.originalErrorPreserved, true);
          assert.equal(result.sidecar.exists, true);
          assert.deepEqual(
            Object.keys(result.sidecar.decoded),
            DISPOSITION_KEYS,
          );
          for (const key of [
            'repositoryKey',
            'pipeName',
            'stagingName',
            'nonce',
          ]) {
            assert.equal(
              result.sidecar.decoded[key],
              result.lock.record[key],
            );
          }
          assert.equal(
            result.sidecar.decoded.disposition,
            dispositionName,
          );
          if (dispositionName === 'CLEAN_AUTHORIZED') {
            assert.equal(result.sidecar.decoded.reason, null);
            assert.equal(result.sidecar.decoded.causeReason, null);
          } else {
            assert.equal(
              result.sidecar.decoded.reason,
              'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
            );
            assert.equal(
              result.sidecar.decoded.causeReason,
              'SUBPROCESS_TIMEOUT',
            );
          }
          assertCanonicalCarrierBytes(
            result.sidecar.bytes,
            result.sidecar.decoded,
          );
          assertCarrierJournal(result);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'carrier collisions preserve the existing sidecar or lock without adoption or replacement',
      async () => {
        for (const expected of [
          {
            mode: 'lock-collision',
            target: 'lock',
            bytes: 'preexisting-lock\n',
            code: 'MOXLEY_NATIVE_BUILD_BUSY',
          },
          {
            mode: 'sidecar-collision-post-lock',
            target: 'disposition',
            bytes: 'preexisting-sidecar\n',
            code: 'MOXLEY_NATIVE_BUILD_COLLISION',
          },
        ]) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseRetentionScenario(
            sandbox,
            expected.mode,
          );
          assert.equal(result.failed, true);
          assert.equal(result.code, expected.code);
          assert.strictEqual(result.caught, result.triggeringError);
          assert.equal(
            (await fsp.readFile(result.paths[expected.target])).toString('utf8'),
            expected.bytes,
          );
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'explicit clean retains active v2 and every valid legacy v1 lock',
      async () => {
        for (const expected of [
          {
            mode: 'v2-active',
            retained: {
              artifact: true,
              receipt: true,
              lock: true,
              disposition: false,
              staging: true,
            },
          },
          {
            mode: 'legacy-v1',
            retained: {
              artifact: true,
              receipt: true,
              lock: true,
              disposition: false,
              staging: true,
            },
          },
          {
            mode: 'legacy-v1-sidecar',
            retained: {
              artifact: true,
              receipt: true,
              lock: true,
              disposition: true,
              staging: true,
            },
          },
        ]) {
          const sandbox = await createSandbox();
          const result = await cleanTest.exerciseCleanScenario(
            sandbox,
            expected.mode,
          );
          assertCleanError(
            result,
            expected.mode,
            CLEAN_RETENTION_REQUIRED,
          );
          assert.deepEqual(result.retained, expected.retained);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'explicit clean retains exact termination-unconfirmed evidence',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'termination-unconfirmed',
        );
        assertCleanError(
          result,
          'termination-unconfirmed',
          CLEAN_RETENTION_REQUIRED,
        );
        assertAllRetained(result, true);
        await removeSandbox(sandbox);
      },
    );

    it(
      'explicit clean rejects malformed, partial, noncanonical, unknown, orphaned, and lock-unbound sidecars',
      async () => {
        for (const mode of INVALID_SIDECAR_MODES) {
          const sandbox = await createSandbox();
          const result = await cleanTest.exerciseCleanScenario(sandbox, mode);
          assertCleanError(result, mode, CLEAN_DISPOSITION_INVALID);
          await removeSandbox(sandbox);
        }
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'unknown-lock-version',
        );
        assertCleanError(result, 'unknown-lock-version', CLEAN_LOCK_INVALID);
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 production sources contain zero physical removal or promotion calls',
      async () => {
        const production = [
          await fsp.readFile(BUILD_SCRIPT, 'utf8'),
          await fsp.readFile(CLEAN_SCRIPT, 'utf8'),
        ];
        const prohibited =
          /\b(?:fsp|fs)\.(?:unlink|rmdir|rm|link|rename)\s*\(/;
        for (const source of production) {
          assert.doesNotMatch(source, prohibited);
        }
        assert.doesNotMatch(production[0], /status:\s*'built'/);
        for (const deleted of [
          'releaseOwnedLock',
          'executeLocalStagingRemoval',
          'removeAuthenticatedStaging',
          'removeLocalCarrier',
          'executeLocalCleanupPlan',
          'removeLegacyAuthenticatedStaging',
          'removeFile',
          'removeDirectory',
          'removeStaging',
          'executeRemovalPlan',
          'replaceScenarioTarget',
        ]) {
          assert.equal(production.join('\n').includes(deleted), false);
        }
      },
    );

    it(
      'execution mirrors copy only the authenticated four-file ledger',
      async () => {
        const mirror = await createExecutionMirror();
        const inventory = await boundedNoFollowInventory(mirror.root);
        assert.deepEqual(
          inventory.filter((entry) => entry.type === 'file')
            .map((entry) => entry.relative)
            .sort(internal.ordinalCompare),
          Object.keys(EXECUTION_MIRROR_LEDGER)
            .sort(internal.ordinalCompare),
        );
        await removeSandbox(mirror.root);
      },
    );

    it(
      'pre-lock and lock-publication failures preserve every reachable D1 triggering error',
      async () => {
        const modes = [
          'pre-lock-failure',
          'termination-unconfirmed-pre-lock',
          ...CARRIER_FAULTS.map((fault) => 'lock-publication-' + fault),
        ];
        for (const mode of modes) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseRetentionScenario(
            sandbox,
            mode,
          );
          assert.strictEqual(result.caught, result.triggeringError);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'compiler linker and staged probe failures preserve every reachable D1 triggering error',
      async () => {
        for (const mode of [
          'compiler-failure',
          'linker-failure',
          'probe-failure',
          'staging-authentication-failure',
          'staging-creation-collision',
        ]) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseRetentionScenario(
            sandbox,
            mode,
          );
          assert.strictEqual(result.caught, result.triggeringError);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'retention-plan authentication failure preserves every reachable D1 triggering error',
      async () => {
        const sandbox = await createSandbox();
        const result = await buildTest.exerciseRetentionScenario(
          sandbox,
          'retention-plan-authentication-failure',
        );
        assert.strictEqual(result.caught, result.triggeringError);
        assert.equal(
          result.triggeringError.code,
          'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'terminal publication and acknowledgement faults preserve every reachable D1 triggering error',
      async () => {
        for (const fault of CARRIER_FAULTS) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseRetentionScenario(
            sandbox,
            'terminal-publication-' + fault,
          );
          assert.strictEqual(result.caught, result.triggeringError);
          assert.equal(
            result.journal.filter(
              (event) => event === 'disposition:fault:' + fault,
            ).length,
            1,
          );
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'rejecting lease.close never replaces any reachable D1 triggering error',
      async () => {
        assert.equal(buildTest.LEASE_CLOSE_TIMEOUT_MS, 5_000);
        const retainedStates = new Map();
        for (const mode of [
          'normal-deferral',
          'lease-close-rejected',
          'lease-close-timeout',
          'termination-unconfirmed',
        ]) {
          const sandbox = await createSandbox();
          const result = await buildTest.exerciseRetentionScenario(
            sandbox,
            mode,
          );
          assert.strictEqual(result.caught, result.triggeringError);
          if (mode === 'normal-deferral' || mode === 'lease-close-timeout') {
            retainedStates.set(mode, {
              lockExists: result.lock.exists,
              disposition: result.disposition?.disposition ?? null,
              reason: result.disposition?.reason ?? null,
              causeReason: result.disposition?.causeReason ?? null,
              retained: result.retained,
            });
          }
          if (mode === 'lease-close-rejected') {
            assert.equal(result.leaseClosed, false);
            assert.equal(result.leaseAbandonCount, 1);
            assert.equal(
              result.journal.filter(
                (event) => event === 'lease:close-rejected',
              ).length,
              1,
            );
            assert.equal(result.journal.includes('lease:close'), false);
          }
          if (mode === 'lease-close-timeout') {
            assert.equal(result.leaseClosed, false);
            assert.equal(result.leaseAbandonCount, 1);
            assert.equal(
              result.journal.filter(
                (event) => event === 'lease:close-timeout',
              ).length,
              1,
            );
            assert.equal(result.journal.includes('lease:close'), false);
            assert.equal(
              result.journal.includes('lease:close-rejected'),
              false,
            );
          }
          await removeSandbox(sandbox);
        }
        assert.deepEqual(
          retainedStates.get('lease-close-timeout'),
          retainedStates.get('normal-deferral'),
        );
      },
    );

    it(
      'D1 clean state absent returns an empty idempotent result',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'absent',
        );
        assertCleanResultShape(result, 'absent');
        assert.equal(result.status, 'clean');
        assert.equal(result.code, null);
        assert.deepEqual(result.removed, []);
        assertAllRetained(result, false);
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 clean state artifact only requires retention',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'artifact-only',
        );
        assertCleanError(
          result,
          'artifact-only',
          CLEAN_RETENTION_REQUIRED,
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 clean state receipt only requires retention',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'receipt-only',
        );
        assertCleanError(
          result,
          'receipt-only',
          CLEAN_RETENTION_REQUIRED,
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 clean state artifact plus receipt requires retention',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'artifact-and-receipt',
        );
        assertCleanError(
          result,
          'artifact-and-receipt',
          CLEAN_RETENTION_REQUIRED,
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 clean state orphan sidecar is disposition-invalid',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'orphan-sidecar',
        );
        assertCleanError(
          result,
          'orphan-sidecar',
          CLEAN_DISPOSITION_INVALID,
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 clean state staging without an authenticated lock is stage-invalid',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'staging-without-lock',
        );
        assertCleanError(
          result,
          'staging-without-lock',
          {
            code: 'MOXLEY_NATIVE_CLEAN_STAGE_INVALID',
            message: 'Unauthenticated native build staging exists.',
          },
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'D1 hostile ancestor Release rebound before authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) => plan.release.target,
          'beforeAuthority',
        );
      },
    );

    it(
      'D1 hostile ancestor Release rebound after authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) => plan.release.target,
          'afterAuthority',
        );
      },
    );

    it(
      'D1 hostile ancestor staging root rebound before authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) => plan.staging.target,
          'beforeAuthority',
        );
      },
    );

    it(
      'D1 hostile ancestor staging root rebound after authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) => plan.staging.target,
          'afterAuthority',
        );
      },
    );

    it(
      'D1 hostile ancestor nested directory rebound before authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) =>
            plan.staging.directories.find(
              (item) =>
                path.basename(item.target) === 'VSApplicationInsights',
            ).target,
          'beforeAuthority',
        );
      },
    );

    it(
      'D1 hostile ancestor nested directory rebound after authority fails closed',
      async () => {
        await runAncestorRebindingCase(
          (plan) =>
            plan.staging.directories.find(
              (item) =>
                path.basename(item.target) === 'VSApplicationInsights',
            ).target,
          'afterAuthority',
        );
      },
    );

    it(
      'exact CLEAN_AUTHORIZED clean authenticates the exact target map before physical-cleanup deferral',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'positive',
        );
        assertCleanError(
          result,
          'positive',
          CLEAN_PHYSICAL_CLEANUP_DEFERRED,
        );
        assertNoRemovalEvents(result.events);
        const stagingName = path.basename(result.paths.staging);
        const stagingRelative = 'build/Release/' + stagingName;
        const expected = [
          'reauthenticate:' + stagingRelative +
            '/moxley-windows-reparse.obj',
          'reauthenticate:' + stagingRelative +
            '/Microsoft/VSApplicationInsights/vstel' + 'f'.repeat(32),
          'reauthenticate:' + stagingRelative +
            '/Microsoft/VSApplicationInsights',
          'reauthenticate:' + stagingRelative + '/Microsoft',
          'reauthenticate:' + stagingRelative,
          'reauthenticate:build/Release/moxley-windows-reparse.node',
          'reauthenticate:build/Release/' +
            'moxley-windows-reparse.receipt.json',
          'reauthenticate:build/Release/' +
            '.moxley-windows-reparse-build.disposition.json',
          'reauthenticate:build/Release/' +
            '.moxley-windows-reparse-build.lock',
        ];
        const actual = result.events.filter((event) =>
          event.startsWith('reauthenticate:'));
        assertExactTargetMap(actual, expected);
        for (let index = 0; index < expected.length; index += 1) {
          assert.throws(
            () =>
              assertExactTargetMap(
                actual.filter((_, candidate) => candidate !== index),
                expected,
              ),
          );
        }
        assert.equal(
          result.events.filter((event) => event === 'ancestor:.').length,
          1,
        );
        assert.equal(
          result.events.filter(
            (event) => event === 'ancestor:build',
          ).length,
          1,
        );
        assert.equal(
          result.events.filter(
            (event) => event === 'ancestor:build/Release',
          ).length,
          1,
        );
        const deferIndex = result.events.indexOf('defer:physical-cleanup');
        assert.equal(deferIndex >= 0, true);
        assert.equal(
          actual.every(
            (event) => result.events.indexOf(event) < deferIndex,
          ),
          true,
        );
        assertAllRetained(result, true);
        await removeSandbox(sandbox);
      },
    );

    it(
      'retained-lock classification derives repository and pipe bindings independently from the canonical sandbox',
      async () => {
        const sandbox = await createSandbox();
        const result = await cleanTest.exerciseCleanScenario(
          sandbox,
          'positive',
        );
        assertCleanError(
          result,
          'positive',
          CLEAN_PHYSICAL_CLEANUP_DEFERRED,
        );
        const canonicalSandbox = await fsp.realpath(sandbox);
        const independentKey = internal.repositoryKey(canonicalSandbox);
        const independentPipe = internal.pipeNameForKey(independentKey);
        const lockBytes = await fsp.readFile(result.paths.lock);
        const classification = internal.classifyLockCarrierBytes(
          lockBytes,
          independentKey,
          independentPipe,
        );
        assert.equal(classification.kind, 'ACTIVE_V2');
        assert.equal(
          classification.record.repositoryKey,
          independentKey,
        );
        assert.equal(
          classification.record.pipeName,
          independentPipe,
        );
        const disposition = internal.decodeDispositionBytes(
          await fsp.readFile(result.paths.disposition),
          classification.record,
        );
        assert.equal(disposition.disposition, 'CLEAN_AUTHORIZED');
        assert.equal(
          disposition.repositoryKey,
          classification.record.repositoryKey,
        );
        assert.equal(
          disposition.pipeName,
          classification.record.pipeName,
        );
        await removeSandbox(sandbox);
      },
    );

    it(
      'CLEAN_AUTHORIZED physical-cleanup deferral preserves every retained byte',
      async () => {
        const sandbox = await createSandbox();
        const setup = await cleanTest.exerciseCleanScenario(
          sandbox,
          'positive',
        );
        assertCleanError(
          setup,
          'positive',
          CLEAN_PHYSICAL_CLEANUP_DEFERRED,
        );
        const firstInventory = await boundedNoFollowInventory(sandbox);
        const firstFiles = {};
        for (const entry of firstInventory) {
          if (entry.type !== 'file') continue;
          const bytes = await fsp.readFile(
            path.join(sandbox, ...entry.relative.split('/')),
          );
          firstFiles[entry.relative] = Object.freeze({
            byteLength: bytes.length,
            sha256: sha256(bytes),
          });
        }
        const secondInventory = await boundedNoFollowInventory(sandbox);
        assert.deepEqual(secondInventory, firstInventory);
        const secondFiles = {};
        for (const entry of secondInventory) {
          if (entry.type !== 'file') continue;
          const bytes = await fsp.readFile(
            path.join(sandbox, ...entry.relative.split('/')),
          );
          secondFiles[entry.relative] = Object.freeze({
            byteLength: bytes.length,
            sha256: sha256(bytes),
          });
        }
        assert.deepEqual(secondFiles, firstFiles);
        assertNoRemovalEvents(setup.events);
        await removeSandbox(sandbox);
      },
    );
  },
);
