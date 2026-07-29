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
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROPOSED_ROOT_NODE_UUID =
  '11111111-1111-4111-8111-111111111111';
const PROPOSED_CHILD_NODE_UUID =
  '22222222-2222-4222-8222-222222222222';
const PROPOSED_LOGICAL_ALIAS = 'descendant';
const PROPOSED_LOGICAL_ALIAS_HEX = '64657363656e64616e74';
const PROPOSED_ENCODED_LINK_FILENAME =
  `k_${PROPOSED_LOGICAL_ALIAS_HEX}.ml`;

// The fixed _loc values are characterization sentinels, not user paths.
// These fixture trees are synthetic exemplars, not archived user databases,
// and are deliberately never passed to the Moxley constructor or loader.
// The proposed-v1-locless tree intentionally contains no location or
// deployment-root value. The proposed-v1-encoded-names tree is separate
// synthetic lexical-contract evidence and is likewise never loaded.
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
  'proposed-v1-identity/_state.ms': {
    byteLength: 244,
    finalByte: 0x5d,
    sha256:
      '3f703b7786f957a573d0303d07f018c9fc1d9417031c633f0ccc5d858c29027e',
  },
  'proposed-v1-identity/0/_state.ms': {
    byteLength: 229,
    finalByte: 0x5d,
    sha256:
      '264b4298693f21d40e2f3b18c0b46f28181dbebfa5db16e7a83603972cd48f49',
  },
  'proposed-v1-identity/descendant.ml': {
    byteLength: 36,
    finalByte: 0x32,
    sha256:
      'b454f82c5857ebabf342b7258e5cf7def78b7cd975814119462973de9a38df10',
  },
  'proposed-v1-locless/_state.ms': {
    byteLength: 183,
    finalByte: 0x5d,
    sha256:
      'ec17ecdd597629245bc9dedf4900fccf8f2f12fb01758e821f11b23ec930c80e',
  },
  'proposed-v1-locless/0/_state.ms': {
    byteLength: 166,
    finalByte: 0x5d,
    sha256:
      '3edd861f5f51257021f27b3895139b7468f13da45ab44d0471b0a7e4edf0bd80',
  },
  'proposed-v1-locless/descendant.ml': {
    byteLength: 36,
    finalByte: 0x32,
    sha256:
      'b454f82c5857ebabf342b7258e5cf7def78b7cd975814119462973de9a38df10',
  },
  'proposed-v1-encoded-names/_state.ms': {
    byteLength: 183,
    finalByte: 0x5d,
    sha256:
      'ec17ecdd597629245bc9dedf4900fccf8f2f12fb01758e821f11b23ec930c80e',
  },
  'proposed-v1-encoded-names/n_0/_state.ms': {
    byteLength: 166,
    finalByte: 0x5d,
    sha256:
      '3edd861f5f51257021f27b3895139b7468f13da45ab44d0471b0a7e4edf0bd80',
  },
  'proposed-v1-encoded-names/k_64657363656e64616e74.ml': {
    byteLength: 36,
    finalByte: 0x32,
    sha256:
      'b454f82c5857ebabf342b7258e5cf7def78b7cd975814119462973de9a38df10',
  },
});

const PROPOSED_MARKER_CLASSIFICATION = Object.freeze({
  exact: 'exact-proposed-version-1-root-marker',
  unversioned: 'unversioned-root',
  invalid: 'invalid-or-unsupported-marker',
  nonRoot: 'marker-in-non-root-context',
});

const PROPOSED_IDENTITY_CLASSIFICATION = Object.freeze({
  exact: 'exact-proposed-version-1-identity',
  invalidRootId: 'invalid-root-node-id',
  invalidRootParent: 'invalid-root-parent-id',
  invalidNodeId: 'invalid-node-id',
  duplicateNodeId: 'duplicate-node-id',
  invalidParentId: 'invalid-parent-id',
  parentMismatch: 'parent-id-mismatch',
  invalidLinkBytes: 'invalid-named-link-bytes',
  danglingLink: 'dangling-named-link',
});

const PROPOSED_LOCLESS_CLASSIFICATION = Object.freeze({
  exact: 'exact-proposed-version-1-locless-state',
  invalidLocation: 'persisted-node-location',
  invalidMarker: 'invalid-root-only-marker',
});

const LOGICAL_NAME_CLASSIFICATION = Object.freeze({
  exact: 'canonical-logical-name',
  invalidType: 'invalid-logical-name-type',
  invalidScalar: 'invalid-unicode-scalar-value',
  invalidLength: 'invalid-normalized-utf8-length',
  invalidHex: 'invalid-canonical-lowercase-hex',
  invalidUtf8: 'invalid-strict-utf8',
  nonNfc: 'decoded-logical-name-is-not-nfc',
  nonCanonical: 'noncanonical-logical-name-round-trip',
});

const PHYSICAL_ENTRY_CLASSIFICATION = Object.freeze({
  nodeState: 'accepted-node-state-name',
  collectionState: 'reserved-unapproved-collection-state-name',
  nodeSlot: 'accepted-node-slot-name',
  data: 'accepted-data-key-name',
  link: 'accepted-node-link-key-name',
  storedFunction: 'reserved-unapproved-function-key-name',
  collection: 'reserved-unapproved-collection-directory-name',
  malformed: 'malformed-canonical-physical-name',
  unknown: 'unknown-physical-entry',
});

const PHYSICAL_NAMESPACE_CLASSIFICATION = Object.freeze({
  distinct: 'distinct-decoded-logical-names',
  collision: 'duplicate-decoded-logical-name',
  invalidEntry: 'invalid-physical-entry',
});

const ROOT_INPUT_CLASSIFICATION = Object.freeze({
  windowsLocal: 'windows-drive-absolute-local-path',
  posixLocal: 'posix-absolute-local-path',
  rejected: 'rejected-root-input-lexical-class',
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasUnpairedSurrogateForCharacterization(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return true;
      }
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function encodeLogicalNameForCharacterization(logicalName) {
  if (typeof logicalName !== 'string') {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.invalidType,
    };
  }

  if (hasUnpairedSurrogateForCharacterization(logicalName)) {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.invalidScalar,
    };
  }

  const normalized = logicalName.normalize('NFC');
  const bytes = Buffer.from(normalized, 'utf8');
  if (bytes.length < 1 || bytes.length > 100) {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.invalidLength,
    };
  }

  return {
    classification: LOGICAL_NAME_CLASSIFICATION.exact,
    logicalName: normalized,
    hex: bytes.toString('hex'),
  };
}

function decodeLogicalNameForCharacterization(hex) {
  if (
    typeof hex !== 'string' ||
    !/^(?:[0-9a-f]{2})+$/.test(hex)
  ) {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.invalidHex,
    };
  }

  let logicalName;
  try {
    logicalName = STRICT_UTF8_DECODER.decode(Buffer.from(hex, 'hex'));
  } catch {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.invalidUtf8,
    };
  }

  if (logicalName !== logicalName.normalize('NFC')) {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.nonNfc,
    };
  }

  const encoded = encodeLogicalNameForCharacterization(logicalName);
  if (
    encoded.classification !== LOGICAL_NAME_CLASSIFICATION.exact ||
    encoded.hex !== hex
  ) {
    return {
      classification: LOGICAL_NAME_CLASSIFICATION.nonCanonical,
    };
  }

  return {
    classification: LOGICAL_NAME_CLASSIFICATION.exact,
    logicalName,
    hex,
  };
}

function classifyPhysicalEntryForCharacterization(entryName) {
  if (entryName === '_state.ms') {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.nodeState,
    };
  }

  if (entryName === '_colstate.mc') {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.collectionState,
    };
  }

  if (
    typeof entryName !== 'string' ||
    entryName.length === 0
  ) {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.unknown,
    };
  }

  const nodeSlotMatch = /^n_(0|[1-9][0-9]*)$/.exec(entryName);
  if (nodeSlotMatch !== null) {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.nodeSlot,
      slot: nodeSlotMatch[1],
    };
  }

  if (entryName.toLowerCase().startsWith('n_')) {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.malformed,
    };
  }

  const logicalKeyMatch =
    /^k_([0-9a-f]+)\.(md|ml|mf)$/.exec(entryName);
  if (logicalKeyMatch !== null) {
    const decoded = decodeLogicalNameForCharacterization(
      logicalKeyMatch[1],
    );
    if (
      decoded.classification !== LOGICAL_NAME_CLASSIFICATION.exact
    ) {
      return {
        classification: PHYSICAL_ENTRY_CLASSIFICATION.malformed,
      };
    }

    const classifications = {
      md: PHYSICAL_ENTRY_CLASSIFICATION.data,
      ml: PHYSICAL_ENTRY_CLASSIFICATION.link,
      mf: PHYSICAL_ENTRY_CLASSIFICATION.storedFunction,
    };
    return {
      classification: classifications[logicalKeyMatch[2]],
      logicalName: decoded.logicalName,
      hex: decoded.hex,
    };
  }

  if (entryName.toLowerCase().startsWith('k_')) {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.malformed,
    };
  }

  const collectionMatch = /^c_([0-9a-f]+)$/.exec(entryName);
  if (collectionMatch !== null) {
    const decoded = decodeLogicalNameForCharacterization(
      collectionMatch[1],
    );
    if (
      decoded.classification !== LOGICAL_NAME_CLASSIFICATION.exact
    ) {
      return {
        classification: PHYSICAL_ENTRY_CLASSIFICATION.malformed,
      };
    }

    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.collection,
      logicalName: decoded.logicalName,
      hex: decoded.hex,
    };
  }

  if (
    entryName.toLowerCase().startsWith('c_') ||
    entryName.toLowerCase() === '_state.ms' ||
    entryName.toLowerCase() === '_colstate.mc'
  ) {
    return {
      classification: PHYSICAL_ENTRY_CLASSIFICATION.malformed,
    };
  }

  return {
    classification: PHYSICAL_ENTRY_CLASSIFICATION.unknown,
  };
}

function classifyPhysicalNamespaceForCharacterization(entryNames) {
  const logicalCategories = new Set([
    PHYSICAL_ENTRY_CLASSIFICATION.data,
    PHYSICAL_ENTRY_CLASSIFICATION.link,
    PHYSICAL_ENTRY_CLASSIFICATION.storedFunction,
    PHYSICAL_ENTRY_CLASSIFICATION.collection,
  ]);
  const logicalNames = new Map();

  for (const entryName of entryNames) {
    const entry =
      classifyPhysicalEntryForCharacterization(entryName);
    if (
      entry.classification ===
        PHYSICAL_ENTRY_CLASSIFICATION.malformed ||
      entry.classification === PHYSICAL_ENTRY_CLASSIFICATION.unknown
    ) {
      return {
        classification:
          PHYSICAL_NAMESPACE_CLASSIFICATION.invalidEntry,
        entryName,
      };
    }

    if (!logicalCategories.has(entry.classification)) {
      continue;
    }

    if (logicalNames.has(entry.logicalName)) {
      return {
        classification:
          PHYSICAL_NAMESPACE_CLASSIFICATION.collision,
        logicalName: entry.logicalName,
        categories: [
          logicalNames.get(entry.logicalName),
          entry.classification,
        ],
      };
    }

    logicalNames.set(entry.logicalName, entry.classification);
  }

  return {
    classification: PHYSICAL_NAMESPACE_CLASSIFICATION.distinct,
  };
}

function classifyRootInputForCharacterization(rootInput, flavor) {
  if (
    typeof rootInput !== 'string' ||
    rootInput.length === 0 ||
    rootInput.includes('\0') ||
    /^~(?:[\\/]|$)/.test(rootInput) ||
    /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\})(?:[\\/]|$)/
      .test(rootInput) ||
    /^%[^%]+%(?:[\\/]|$)/.test(rootInput)
  ) {
    return ROOT_INPUT_CLASSIFICATION.rejected;
  }

  if (flavor === 'windows') {
    if (
      /^\\\\[.?]\\/.test(rootInput) ||
      /^\\\\/.test(rootInput)
    ) {
      return ROOT_INPUT_CLASSIFICATION.rejected;
    }

    if (/^[A-Za-z]:\\/.test(rootInput)) {
      return ROOT_INPUT_CLASSIFICATION.windowsLocal;
    }

    return ROOT_INPUT_CLASSIFICATION.rejected;
  }

  if (flavor === 'posix') {
    if (
      /^\/(?!\/)/.test(rootInput) &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rootInput)
    ) {
      return ROOT_INPUT_CLASSIFICATION.posixLocal;
    }

    return ROOT_INPUT_CLASSIFICATION.rejected;
  }

  return ROOT_INPUT_CLASSIFICATION.rejected;
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

function classifyProposedIdentityForCharacterization({
  root,
  children = [],
  links = [],
}) {
  if (
    root === null ||
    typeof root !== 'object' ||
    Array.isArray(root) ||
    !CANONICAL_UUID_V4_PATTERN.test(root._id)
  ) {
    return PROPOSED_IDENTITY_CLASSIFICATION.invalidRootId;
  }

  if (!hasOwn(root, '_parentId') || root._parentId !== null) {
    return PROPOSED_IDENTITY_CLASSIFICATION.invalidRootParent;
  }

  const nodeIndex = new Map([[root._id, root]]);

  for (const childEvidence of children) {
    const child = childEvidence.state;
    if (
      child === null ||
      typeof child !== 'object' ||
      Array.isArray(child) ||
      !CANONICAL_UUID_V4_PATTERN.test(child._id)
    ) {
      return PROPOSED_IDENTITY_CLASSIFICATION.invalidNodeId;
    }

    if (nodeIndex.has(child._id)) {
      return PROPOSED_IDENTITY_CLASSIFICATION.duplicateNodeId;
    }

    nodeIndex.set(child._id, child);
  }

  for (const childEvidence of children) {
    const child = childEvidence.state;
    if (
      !hasOwn(child, '_parentId') ||
      !CANONICAL_UUID_V4_PATTERN.test(child._parentId)
    ) {
      return PROPOSED_IDENTITY_CLASSIFICATION.invalidParentId;
    }

    if (
      !nodeIndex.has(childEvidence.physicalParentId) ||
      child._parentId !== childEvidence.physicalParentId
    ) {
      return PROPOSED_IDENTITY_CLASSIFICATION.parentMismatch;
    }
  }

  for (const link of links) {
    if (!(link.bytes instanceof Uint8Array)) {
      return PROPOSED_IDENTITY_CLASSIFICATION.invalidLinkBytes;
    }

    let targetId;
    try {
      targetId = STRICT_UTF8_DECODER.decode(link.bytes);
    } catch {
      return PROPOSED_IDENTITY_CLASSIFICATION.invalidLinkBytes;
    }

    if (
      !CANONICAL_UUID_V4_PATTERN.test(targetId) ||
      !Buffer.from(targetId, 'utf8').equals(Buffer.from(link.bytes))
    ) {
      return PROPOSED_IDENTITY_CLASSIFICATION.invalidLinkBytes;
    }

    if (!nodeIndex.has(targetId)) {
      return PROPOSED_IDENTITY_CLASSIFICATION.danglingLink;
    }
  }

  return PROPOSED_IDENTITY_CLASSIFICATION.exact;
}

function classifyProposedLoclessStateForCharacterization(evidence) {
  const {
    root,
    child,
    linkBytes,
    physicalSlot = '0',
    aliasKey = 'descendant',
  } = evidence;

  if (
    (
      root !== null &&
      typeof root === 'object' &&
      hasOwn(root, '_loc')
    ) ||
    (
      child !== null &&
      typeof child === 'object' &&
      hasOwn(child, '_loc')
    )
  ) {
    return PROPOSED_LOCLESS_CLASSIFICATION.invalidLocation;
  }

  if (
    classifyProposedRootMarkerForCharacterization(root) !==
      PROPOSED_MARKER_CLASSIFICATION.exact ||
    (
      child !== null &&
      typeof child === 'object' &&
      (
        hasOwn(child, '_format') ||
        hasOwn(child, '_formatVersion')
      )
    )
  ) {
    return PROPOSED_LOCLESS_CLASSIFICATION.invalidMarker;
  }

  const physicalParentId = hasOwn(evidence, 'physicalParentId')
    ? evidence.physicalParentId
    : root?._id;
  const identityClassification =
    classifyProposedIdentityForCharacterization({
      root,
      children: [
        {
          state: child,
          physicalParentId,
          physicalSlot,
        },
      ],
      links: [
        {
          aliasKey,
          bytes: linkBytes,
        },
      ],
    });

  if (
    identityClassification !==
      PROPOSED_IDENTITY_CLASSIFICATION.exact
  ) {
    return identityClassification;
  }

  // Deployment-root labels are deliberately not read. They are not
  // persisted evidence and cannot affect this characterization result.
  return PROPOSED_LOCLESS_CLASSIFICATION.exact;
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

// The proposed identity fixture is synthetic contract-characterization
// evidence. It is not runtime-generated, loadable, released, qualified, or
// durable state. This reader and the classifier above operate only on bytes
// and parsed values; they never construct Moxley or call _loadFromDir().
async function readProposedIdentityFixtureEvidence() {
  const [rootBytes, childBytes, linkBytes] = await Promise.all([
    readCharacterizationFixture('proposed-v1-identity/_state.ms'),
    readCharacterizationFixture(
      'proposed-v1-identity/0/_state.ms',
    ),
    readCharacterizationFixture(
      'proposed-v1-identity/descendant.ml',
    ),
  ]);

  return {
    root: parseCharacterizationState(rootBytes),
    child: parseCharacterizationState(childBytes),
    linkBytes,
  };
}

// The locless fixture is synthetic contract-characterization evidence. It is
// not runtime-generated, loadable, released, qualified, portable, or durable
// state. Only these exact files are read; no Moxley constructor, loader,
// path resolution, or runtime tree traversal is used.
async function readProposedLoclessFixtureEvidence() {
  const [rootBytes, childBytes, linkBytes] = await Promise.all([
    readCharacterizationFixture('proposed-v1-locless/_state.ms'),
    readCharacterizationFixture(
      'proposed-v1-locless/0/_state.ms',
    ),
    readCharacterizationFixture(
      'proposed-v1-locless/descendant.ml',
    ),
  ]);

  return {
    root: parseCharacterizationState(rootBytes),
    child: parseCharacterizationState(childBytes),
    rootBytes,
    childBytes,
    linkBytes,
  };
}

// The encoded-name fixture is synthetic lexical-contract characterization
// evidence. It is not runtime-generated, loadable, released, qualified,
// portable, containment-safe, or durable state. This reader performs no
// Moxley construction, loading, path resolution, or database traversal.
async function readProposedEncodedNameFixtureEvidence() {
  const [rootBytes, childBytes, linkBytes] = await Promise.all([
    readCharacterizationFixture(
      'proposed-v1-encoded-names/_state.ms',
    ),
    readCharacterizationFixture(
      'proposed-v1-encoded-names/n_0/_state.ms',
    ),
    readCharacterizationFixture(
      `proposed-v1-encoded-names/${PROPOSED_ENCODED_LINK_FILENAME}`,
    ),
  ]);

  return {
    root: parseCharacterizationState(rootBytes),
    child: parseCharacterizationState(childBytes),
    rootBytes,
    childBytes,
    linkBytes,
  };
}

function proposedIdentityEvidence(
  root,
  child,
  linkBytes,
  {
    physicalSlot = '0',
    aliasKey = 'descendant',
  } = {},
) {
  return {
    root,
    children: [
      {
        state: child,
        physicalParentId: root._id,
        physicalSlot,
      },
    ],
    links: [
      {
        aliasKey,
        bytes: linkBytes,
      },
    ],
  };
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

test(
  'proposed version-1 identity preimage uses canonical node UUIDs',
  async () => {
    const identityPaths = (
      await enumerateCharacterizationFixturePaths()
    ).filter((relativePath) => (
      relativePath.startsWith('proposed-v1-identity/')
    ));
    assert.deepEqual(identityPaths, [
      'proposed-v1-identity/0/_state.ms',
      'proposed-v1-identity/_state.ms',
      'proposed-v1-identity/descendant.ml',
    ]);

    const {
      root,
      child,
    } = await readProposedIdentityFixtureEvidence();

    assert.deepEqual(root, {
      _loc: CHARACTERIZATION_SENTINEL_ROOT,
      _id: PROPOSED_ROOT_NODE_UUID,
      _parentId: null,
      _name: 'root',
      _keys: ['descendant'],
      _bindings: [],
      _format: 'moxley-db',
      _formatVersion: 1,
    });
    assert.deepEqual(child, {
      _loc: `${CHARACTERIZATION_SENTINEL_ROOT}0/`,
      _id: PROPOSED_CHILD_NODE_UUID,
      _parentId: PROPOSED_ROOT_NODE_UUID,
      _name: 'descendant',
      _keys: [],
      _bindings: [],
    });
    assert.equal(
      CANONICAL_UUID_V4_PATTERN.test(root._id),
      true,
    );
    assert.equal(
      CANONICAL_UUID_V4_PATTERN.test(child._id),
      true,
    );
    assert.notEqual(root._id, child._id);
    assert.equal(
      classifyProposedRootMarkerForCharacterization(root),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );
    assert.equal(hasOwn(child, '_format'), false);
    assert.equal(hasOwn(child, '_formatVersion'), false);
  },
);

test(
  'proposed version-1 identity preserves physical parent ownership separately from directory slots',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedIdentityFixtureEvidence();
    const originalEvidence = proposedIdentityEvidence(
      root,
      child,
      linkBytes,
    );
    const relabeledSlotEvidence = proposedIdentityEvidence(
      root,
      child,
      linkBytes,
      { physicalSlot: '37' },
    );
    const renamedEvidence = proposedIdentityEvidence(
      { ...root, _name: 'renamed-root' },
      { ...child, _name: 'renamed-child' },
      linkBytes,
      {
        physicalSlot: 'named-slot',
        aliasKey: 'independent-alias',
      },
    );

    assert.equal(root._parentId, null);
    assert.equal(child._parentId, root._id);
    assert.equal(root._id.includes('0'), false);
    assert.equal(child._id.includes('0'), false);
    assert.notEqual(root._id, '0');
    assert.notEqual(child._id, '0/0');
    assert.equal(
      classifyProposedIdentityForCharacterization(originalEvidence),
      PROPOSED_IDENTITY_CLASSIFICATION.exact,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        relabeledSlotEvidence,
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.exact,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(renamedEvidence),
      PROPOSED_IDENTITY_CLASSIFICATION.exact,
    );
    assert.equal(
      relabeledSlotEvidence.children[0].state._id,
      child._id,
    );
    assert.equal(
      renamedEvidence.children[0].state._id,
      child._id,
    );
  },
);

test(
  'proposed version-1 named link contains only the target node UUID',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedIdentityFixtureEvidence();
    const duplicateAliases = {
      root,
      children: [
        {
          state: child,
          physicalParentId: root._id,
          physicalSlot: '0',
        },
      ],
      links: [
        {
          aliasKey: 'first-alias',
          bytes: linkBytes,
        },
        {
          aliasKey: 'second-alias',
          bytes: Buffer.from(PROPOSED_CHILD_NODE_UUID, 'utf8'),
        },
      ],
    };
    const rootAlias = {
      ...duplicateAliases,
      links: [
        {
          aliasKey: 'root-alias',
          bytes: Buffer.from(PROPOSED_ROOT_NODE_UUID, 'utf8'),
        },
      ],
    };

    assert.deepEqual(
      linkBytes,
      Buffer.from(PROPOSED_CHILD_NODE_UUID, 'utf8'),
    );
    assert.equal(linkBytes.length, 36);
    assert.equal(
      classifyProposedIdentityForCharacterization(
        duplicateAliases,
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.exact,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(rootAlias),
      PROPOSED_IDENTITY_CLASSIFICATION.exact,
    );
    assert.equal(root._parentId, null);
    assert.equal(child._parentId, root._id);
  },
);

test(
  'positional malformed and duplicate node identities fail characterization',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedIdentityFixtureEvidence();
    const invalidChildIds = [
      '0/0',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa',
      'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
      'not-a-uuid',
    ];

    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          { ...root, _id: '0' },
          child,
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidRootId,
    );

    for (const invalidId of invalidChildIds) {
      assert.equal(
        classifyProposedIdentityForCharacterization(
          proposedIdentityEvidence(
            root,
            { ...child, _id: invalidId },
            linkBytes,
          ),
        ),
        PROPOSED_IDENTITY_CLASSIFICATION.invalidNodeId,
        invalidId,
      );
    }

    const duplicateIdentity = proposedIdentityEvidence(
      root,
      {
        ...child,
        _id: root._id,
      },
      linkBytes,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        duplicateIdentity,
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.duplicateNodeId,
    );
  },
);

test(
  'dangling and malformed named-link targets fail characterization',
  async () => {
    const {
      root,
      child,
    } = await readProposedIdentityFixtureEvidence();
    const unknownUuid =
      '33333333-3333-4333-8333-333333333333';
    const danglingEvidence = proposedIdentityEvidence(
      root,
      child,
      Buffer.from(unknownUuid, 'utf8'),
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(danglingEvidence),
      PROPOSED_IDENTITY_CLASSIFICATION.danglingLink,
    );

    const malformedLinks = [
      `"${PROPOSED_CHILD_NODE_UUID}"`,
      JSON.stringify({ id: PROPOSED_CHILD_NODE_UUID }),
      ` ${PROPOSED_CHILD_NODE_UUID} `,
      `${PROPOSED_CHILD_NODE_UUID}\r`,
      `${PROPOSED_CHILD_NODE_UUID}\n`,
      `${PROPOSED_CHILD_NODE_UUID}\r\n`,
      'not-a-uuid',
    ];

    for (const malformedLink of malformedLinks) {
      assert.equal(
        classifyProposedIdentityForCharacterization(
          proposedIdentityEvidence(
            root,
            child,
            Buffer.from(malformedLink, 'utf8'),
          ),
        ),
        PROPOSED_IDENTITY_CLASSIFICATION.invalidLinkBytes,
        JSON.stringify(malformedLink),
      );
    }

    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          root,
          child,
          Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(PROPOSED_CHILD_NODE_UUID, 'utf8'),
          ]),
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidLinkBytes,
    );
  },
);

test(
  'missing null and mismatched parent identities fail characterization',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedIdentityFixtureEvidence();
    const {
      _parentId: omittedRootParentId,
      ...rootWithoutParentId
    } = root;
    const {
      _parentId: omittedChildParentId,
      ...childWithoutParentId
    } = child;
    const differentParentId =
      '33333333-3333-4333-8333-333333333333';

    assert.equal(omittedRootParentId, null);
    assert.equal(omittedChildParentId, root._id);
    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          rootWithoutParentId,
          child,
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidRootParent,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          {
            ...root,
            _parentId: differentParentId,
          },
          child,
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidRootParent,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          root,
          {
            ...child,
            _parentId: null,
          },
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidParentId,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          root,
          childWithoutParentId,
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.invalidParentId,
    );
    assert.equal(
      classifyProposedIdentityForCharacterization(
        proposedIdentityEvidence(
          root,
          {
            ...child,
            _parentId: differentParentId,
          },
          linkBytes,
        ),
      ),
      PROPOSED_IDENTITY_CLASSIFICATION.parentMismatch,
    );
  },
);

test(
  'proposed version-1 locless preimage omits persisted locations',
  async () => {
    const loclessPaths = (
      await enumerateCharacterizationFixturePaths()
    ).filter((relativePath) => (
      relativePath.startsWith('proposed-v1-locless/')
    ));
    assert.deepEqual(loclessPaths, [
      'proposed-v1-locless/0/_state.ms',
      'proposed-v1-locless/_state.ms',
      'proposed-v1-locless/descendant.ml',
    ]);

    const {
      root,
      child,
      rootBytes,
      childBytes,
      linkBytes,
    } = await readProposedLoclessFixtureEvidence();
    const allBytes = [rootBytes, childBytes, linkBytes];

    assert.deepEqual(root, {
      _id: PROPOSED_ROOT_NODE_UUID,
      _parentId: null,
      _name: 'root',
      _keys: ['descendant'],
      _bindings: [],
      _format: 'moxley-db',
      _formatVersion: 1,
    });
    assert.deepEqual(child, {
      _id: PROPOSED_CHILD_NODE_UUID,
      _parentId: PROPOSED_ROOT_NODE_UUID,
      _name: 'descendant',
      _keys: [],
      _bindings: [],
    });
    assert.equal(hasOwn(root, '_loc'), false);
    assert.equal(hasOwn(child, '_loc'), false);

    for (const bytes of allBytes) {
      const text = STRICT_UTF8_DECODER.decode(bytes);
      assert.equal(text.includes('_loc'), false);
      assert.equal(
        text.includes(CHARACTERIZATION_SENTINEL_ROOT),
        false,
      );
      assert.equal(text.includes('/'), false);
      assert.equal(text.includes('\\'), false);
    }

    assert.equal(
      classifyProposedLoclessStateForCharacterization({
        root,
        child,
        linkBytes,
      }),
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
    );
  },
);

test(
  'persisted root or child location invalidates locless characterization',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedLoclessFixtureEvidence();
    const locationMutations = [
      {
        name: 'absolute string',
        value: '/untrusted/absolute',
      },
      {
        name: 'relative string',
        value: '../untrusted-relative',
      },
      {
        name: 'empty string',
        value: '',
      },
      {
        name: 'null',
        value: null,
      },
      {
        name: 'scalar',
        value: 17,
      },
      {
        name: 'object',
        value: { untrusted: true },
      },
    ];

    for (const mutation of locationMutations) {
      assert.equal(
        classifyProposedLoclessStateForCharacterization({
          root: {
            ...root,
            _loc: mutation.value,
          },
          child,
          linkBytes,
        }),
        PROPOSED_LOCLESS_CLASSIFICATION.invalidLocation,
        `root ${mutation.name}`,
      );
      assert.equal(
        classifyProposedLoclessStateForCharacterization({
          root,
          child: {
            ...child,
            _loc: mutation.value,
          },
          linkBytes,
        }),
        PROPOSED_LOCLESS_CLASSIFICATION.invalidLocation,
        `child ${mutation.name}`,
      );
    }
  },
);

test(
  'deployment root changes do not alter locless persisted identity evidence',
  async () => {
    const evidence = await readProposedLoclessFixtureEvidence();
    const deploymentRootLabels = [
      'opaque-deployment-root-alpha',
      'opaque-deployment-root-beta',
    ];
    const classifications = deploymentRootLabels.map(
      (deploymentRoot) => (
        classifyProposedLoclessStateForCharacterization({
          ...evidence,
          deploymentRoot,
        })
      ),
    );

    assert.deepEqual(classifications, [
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
    ]);
    assert.equal(evidence.root._id, PROPOSED_ROOT_NODE_UUID);
    assert.equal(evidence.child._id, PROPOSED_CHILD_NODE_UUID);
    assert.equal(
      evidence.child._parentId,
      evidence.root._id,
    );

    for (const label of deploymentRootLabels) {
      assert.equal(evidence.rootBytes.includes(label), false);
      assert.equal(evidence.childBytes.includes(label), false);
      assert.equal(evidence.linkBytes.includes(label), false);
    }
  },
);

test(
  'same-parent physical slot relabeling does not alter locless identity',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedLoclessFixtureEvidence();
    const originalIdentity = {
      rootId: root._id,
      childId: child._id,
      parentId: child._parentId,
      linkTarget: STRICT_UTF8_DECODER.decode(linkBytes),
    };
    const differentParentId =
      '33333333-3333-4333-8333-333333333333';

    assert.equal(
      classifyProposedLoclessStateForCharacterization({
        root,
        child,
        linkBytes,
        physicalSlot: '0',
      }),
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
    );
    assert.equal(
      classifyProposedLoclessStateForCharacterization({
        root,
        child,
        linkBytes,
        physicalSlot: 'same-parent-renamed-slot',
      }),
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
    );
    assert.deepEqual(
      {
        rootId: root._id,
        childId: child._id,
        parentId: child._parentId,
        linkTarget: STRICT_UTF8_DECODER.decode(linkBytes),
      },
      originalIdentity,
    );
    assert.equal(
      classifyProposedLoclessStateForCharacterization({
        root,
        child,
        linkBytes,
        physicalParentId: differentParentId,
        physicalSlot: 'different-parent-slot',
      }),
      PROPOSED_IDENTITY_CLASSIFICATION.parentMismatch,
    );
  },
);

test(
  'locless preimage retains UUID ownership and exact named-link evidence',
  async () => {
    const {
      root,
      child,
      linkBytes,
    } = await readProposedLoclessFixtureEvidence();

    assert.equal(root._id, PROPOSED_ROOT_NODE_UUID);
    assert.equal(child._id, PROPOSED_CHILD_NODE_UUID);
    assert.notEqual(root._id, child._id);
    assert.equal(CANONICAL_UUID_V4_PATTERN.test(root._id), true);
    assert.equal(CANONICAL_UUID_V4_PATTERN.test(child._id), true);
    assert.equal(root._parentId, null);
    assert.equal(child._parentId, root._id);
    assert.equal(
      classifyProposedRootMarkerForCharacterization(root),
      PROPOSED_MARKER_CLASSIFICATION.exact,
    );
    assert.equal(hasOwn(child, '_format'), false);
    assert.equal(hasOwn(child, '_formatVersion'), false);
    assert.deepEqual(
      linkBytes,
      Buffer.from(PROPOSED_CHILD_NODE_UUID, 'utf8'),
    );
    assert.equal(linkBytes.length, 36);
    assert.equal(
      classifyProposedLoclessStateForCharacterization({
        root,
        child,
        linkBytes,
      }),
      PROPOSED_LOCLESS_CLASSIFICATION.exact,
    );
  },
);

test(
  'proposed version-1 encoded-name preimage uses canonical physical names',
  async () => {
    const encodedPaths = (
      await enumerateCharacterizationFixturePaths()
    ).filter((relativePath) => (
      relativePath.startsWith('proposed-v1-encoded-names/')
    ));
    assert.deepEqual(encodedPaths, [
      'proposed-v1-encoded-names/_state.ms',
      `proposed-v1-encoded-names/${PROPOSED_ENCODED_LINK_FILENAME}`,
      'proposed-v1-encoded-names/n_0/_state.ms',
    ]);

    const {
      root,
      child,
      rootBytes,
      childBytes,
      linkBytes,
    } = await readProposedEncodedNameFixtureEvidence();
    const newFixtures = {
      'proposed-v1-encoded-names/_state.ms': rootBytes,
      'proposed-v1-encoded-names/n_0/_state.ms': childBytes,
      [`proposed-v1-encoded-names/${PROPOSED_ENCODED_LINK_FILENAME}`]:
        linkBytes,
    };

    for (const [relativePath, bytes] of Object.entries(newFixtures)) {
      const expectation = CHARACTERIZATION_FIXTURES[relativePath];
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
    }

    assert.deepEqual(
      rootBytes,
      await readCharacterizationFixture(
        'proposed-v1-locless/_state.ms',
      ),
    );
    assert.deepEqual(
      childBytes,
      await readCharacterizationFixture(
        'proposed-v1-locless/0/_state.ms',
      ),
    );
    assert.deepEqual(
      linkBytes,
      await readCharacterizationFixture(
        'proposed-v1-locless/descendant.ml',
      ),
    );
    assert.equal(root._id, PROPOSED_ROOT_NODE_UUID);
    assert.equal(child._id, PROPOSED_CHILD_NODE_UUID);
    assert.deepEqual(root._keys, [PROPOSED_LOGICAL_ALIAS]);
    assert.equal(child._name, PROPOSED_LOGICAL_ALIAS);
    assert.equal(hasOwn(root, '_loc'), false);
    assert.equal(hasOwn(child, '_loc'), false);
    assert.equal(
      STRICT_UTF8_DECODER.decode(linkBytes),
      PROPOSED_CHILD_NODE_UUID,
    );
    assert.equal(
      classifyPhysicalEntryForCharacterization('n_0')
        .classification,
      PHYSICAL_ENTRY_CLASSIFICATION.nodeSlot,
    );
    assert.equal(
      classifyPhysicalEntryForCharacterization(
        PROPOSED_ENCODED_LINK_FILENAME,
      ).classification,
      PHYSICAL_ENTRY_CLASSIFICATION.link,
    );
    assert.equal(
      encodedPaths.some((relativePath) => (
        relativePath.includes('/0/') ||
        relativePath.endsWith('/descendant.ml')
      )),
      false,
    );

    const readerSource =
      readProposedEncodedNameFixtureEvidence.toString();
    assert.equal(readerSource.includes('new Moxley'), false);
    assert.equal(readerSource.includes('_loadFromDir'), false);
    assert.equal(readerSource.includes('path.resolve'), false);
  },
);

test(
  'canonical logical names round-trip through NFC UTF-8 lowercase hex',
  () => {
    const encodedAlias =
      encodeLogicalNameForCharacterization(PROPOSED_LOGICAL_ALIAS);
    assert.deepEqual(encodedAlias, {
      classification: LOGICAL_NAME_CLASSIFICATION.exact,
      logicalName: PROPOSED_LOGICAL_ALIAS,
      hex: PROPOSED_LOGICAL_ALIAS_HEX,
    });
    assert.deepEqual(
      decodeLogicalNameForCharacterization(
        PROPOSED_LOGICAL_ALIAS_HEX,
      ),
      encodedAlias,
    );

    const differentCase =
      encodeLogicalNameForCharacterization('Descendant');
    assert.equal(
      differentCase.classification,
      LOGICAL_NAME_CLASSIFICATION.exact,
    );
    assert.notEqual(differentCase.hex, PROPOSED_LOGICAL_ALIAS_HEX);
    assert.equal(
      decodeLogicalNameForCharacterization(differentCase.hex)
        .logicalName,
      'Descendant',
    );

    for (const logicalName of ['é', '東京', '😀']) {
      const encoded =
        encodeLogicalNameForCharacterization(logicalName);
      assert.equal(
        encoded.classification,
        LOGICAL_NAME_CLASSIFICATION.exact,
        logicalName,
      );
      assert.deepEqual(
        decodeLogicalNameForCharacterization(encoded.hex),
        encoded,
        logicalName,
      );
    }

    const normalized =
      encodeLogicalNameForCharacterization('e\u0301');
    assert.equal(
      normalized.classification,
      LOGICAL_NAME_CLASSIFICATION.exact,
    );
    assert.equal(normalized.logicalName, 'é');
    assert.equal(normalized.hex, 'c3a9');

    const invalidLogicalNames = [
      ['', LOGICAL_NAME_CLASSIFICATION.invalidLength],
      ['a'.repeat(101), LOGICAL_NAME_CLASSIFICATION.invalidLength],
      [null, LOGICAL_NAME_CLASSIFICATION.invalidType],
      [17, LOGICAL_NAME_CLASSIFICATION.invalidType],
      [new String('descendant'), LOGICAL_NAME_CLASSIFICATION.invalidType],
      ['\ud800', LOGICAL_NAME_CLASSIFICATION.invalidScalar],
      ['\udc00', LOGICAL_NAME_CLASSIFICATION.invalidScalar],
      ['a\ud800b', LOGICAL_NAME_CLASSIFICATION.invalidScalar],
    ];
    for (const [logicalName, expected] of invalidLogicalNames) {
      assert.equal(
        encodeLogicalNameForCharacterization(logicalName)
          .classification,
        expected,
      );
    }
  },
);

test(
  'uppercase odd invalid UTF-8 and non-NFC encodings fail characterization',
  () => {
    assert.equal(
      decodeLogicalNameForCharacterization(
        PROPOSED_LOGICAL_ALIAS_HEX.toUpperCase(),
      ).classification,
      LOGICAL_NAME_CLASSIFICATION.invalidHex,
    );
    assert.equal(
      decodeLogicalNameForCharacterization('646')
        .classification,
      LOGICAL_NAME_CLASSIFICATION.invalidHex,
    );
    assert.equal(
      decodeLogicalNameForCharacterization('zz')
        .classification,
      LOGICAL_NAME_CLASSIFICATION.invalidHex,
    );
    assert.equal(
      decodeLogicalNameForCharacterization('80')
        .classification,
      LOGICAL_NAME_CLASSIFICATION.invalidUtf8,
    );
    assert.equal(
      decodeLogicalNameForCharacterization('c328')
        .classification,
      LOGICAL_NAME_CLASSIFICATION.invalidUtf8,
    );

    const nonNfcUtf8 = Buffer.from('e\u0301', 'utf8')
      .toString('hex');
    assert.equal(nonNfcUtf8, '65cc81');
    assert.equal(
      decodeLogicalNameForCharacterization(nonNfcUtf8)
        .classification,
      LOGICAL_NAME_CLASSIFICATION.nonNfc,
    );
  },
);

test(
  'legacy unknown and type-conflicting physical names fail characterization',
  () => {
    assert.equal(
      classifyPhysicalEntryForCharacterization('_state.ms')
        .classification,
      PHYSICAL_ENTRY_CLASSIFICATION.nodeState,
    );
    assert.equal(
      classifyPhysicalEntryForCharacterization('_colstate.mc')
        .classification,
      PHYSICAL_ENTRY_CLASSIFICATION.collectionState,
    );
    assert.equal(
      classifyPhysicalEntryForCharacterization(
        `k_${PROPOSED_LOGICAL_ALIAS_HEX}.mf`,
      ).classification,
      PHYSICAL_ENTRY_CLASSIFICATION.storedFunction,
    );
    assert.equal(
      classifyPhysicalEntryForCharacterization(
        `c_${PROPOSED_LOGICAL_ALIAS_HEX}`,
      ).classification,
      PHYSICAL_ENTRY_CLASSIFICATION.collection,
    );

    const unknownEntries = [
      '0',
      'descendant.ml',
      `x_${PROPOSED_LOGICAL_ALIAS_HEX}.ml`,
    ];
    for (const entryName of unknownEntries) {
      assert.equal(
        classifyPhysicalEntryForCharacterization(entryName)
          .classification,
        PHYSICAL_ENTRY_CLASSIFICATION.unknown,
        entryName,
      );
      assert.equal(
        classifyPhysicalNamespaceForCharacterization([entryName])
          .classification,
        PHYSICAL_NAMESPACE_CLASSIFICATION.invalidEntry,
        entryName,
      );
    }

    const malformedEntries = [
      `k_${PROPOSED_LOGICAL_ALIAS_HEX}.mx`,
      `K_${PROPOSED_LOGICAL_ALIAS_HEX}.ml`,
      `k_${PROPOSED_LOGICAL_ALIAS_HEX.toUpperCase()}.ml`,
      `k_${PROPOSED_LOGICAL_ALIAS_HEX}.ML`,
      '_STATE.ms',
      '_COLSTATE.mc',
      `C_${PROPOSED_LOGICAL_ALIAS_HEX}`,
    ];
    for (const entryName of malformedEntries) {
      assert.equal(
        classifyPhysicalEntryForCharacterization(entryName)
          .classification,
        PHYSICAL_ENTRY_CLASSIFICATION.malformed,
        entryName,
      );
    }

    assert.equal(
      classifyPhysicalNamespaceForCharacterization([
        `k_${PROPOSED_LOGICAL_ALIAS_HEX}.md`,
        PROPOSED_ENCODED_LINK_FILENAME,
      ]).classification,
      PHYSICAL_NAMESPACE_CLASSIFICATION.collision,
    );
  },
);

test(
  'duplicate decoded logical names fail across persisted entry types',
  () => {
    const dataName = `k_${PROPOSED_LOGICAL_ALIAS_HEX}.md`;
    const linkName = PROPOSED_ENCODED_LINK_FILENAME;
    const functionName = `k_${PROPOSED_LOGICAL_ALIAS_HEX}.mf`;
    const collectionName = `c_${PROPOSED_LOGICAL_ALIAS_HEX}`;
    const collisionPairs = [
      [dataName, linkName],
      [linkName, functionName],
      [dataName, collectionName],
      [functionName, collectionName],
    ];

    for (const entries of collisionPairs) {
      const result =
        classifyPhysicalNamespaceForCharacterization(entries);
      assert.equal(
        result.classification,
        PHYSICAL_NAMESPACE_CLASSIFICATION.collision,
        entries.join(' and '),
      );
      assert.equal(result.logicalName, PROPOSED_LOGICAL_ALIAS);
    }

    const uppercaseLogicalHex =
      encodeLogicalNameForCharacterization('Descendant').hex;
    assert.equal(
      classifyPhysicalNamespaceForCharacterization([
        dataName,
        `k_${uppercaseLogicalHex}.ml`,
      ]).classification,
      PHYSICAL_NAMESPACE_CLASSIFICATION.distinct,
    );
  },
);

test(
  'node slot names require canonical decimal placement grammar',
  () => {
    for (const slotName of ['n_0', 'n_1', 'n_10']) {
      assert.equal(
        classifyPhysicalEntryForCharacterization(slotName)
          .classification,
        PHYSICAL_ENTRY_CLASSIFICATION.nodeSlot,
        slotName,
      );
    }

    for (
      const slotName of [
        '0',
        'n_00',
        'n_01',
        'N_0',
        'n_-1',
        'n_+1',
        'n_1.0',
        'n_',
      ]
    ) {
      assert.notEqual(
        classifyPhysicalEntryForCharacterization(slotName)
          .classification,
        PHYSICAL_ENTRY_CLASSIFICATION.nodeSlot,
        slotName,
      );
    }
  },
);

test(
  'root input characterization rejects nonlocal and nonabsolute lexical classes',
  () => {
    assert.equal(
      classifyRootInputForCharacterization(
        String.raw`C:\moxley\database`,
        'windows',
      ),
      ROOT_INPUT_CLASSIFICATION.windowsLocal,
    );
    assert.equal(
      classifyRootInputForCharacterization(
        '/var/lib/moxley/database',
        'posix',
      ),
      ROOT_INPUT_CLASSIFICATION.posixLocal,
    );

    const rejectedInputs = [
      [null, 'windows'],
      [17, 'posix'],
      [{}, 'posix'],
      ['', 'windows'],
      [String.raw`C:\moxley\0database`.replace('\\0', '\0'), 'windows'],
      ['relative/database', 'posix'],
      [String.raw`relative\database`, 'windows'],
      [String.raw`C:relative\database`, 'windows'],
      [String.raw`\root-relative\database`, 'windows'],
      [String.raw`\\server\share\database`, 'windows'],
      [String.raw`\\.\C:\database`, 'windows'],
      [String.raw`\\?\C:\database`, 'windows'],
      ['file:///var/lib/moxley', 'posix'],
      ['https://example.invalid/database', 'posix'],
      ['~/database', 'posix'],
      ['$HOME/database', 'posix'],
      ['${HOME}/database', 'posix'],
      [String.raw`%USERPROFILE%\database`, 'windows'],
      ['//network-root/database', 'posix'],
      [String.raw`C:\moxley\database`, 'posix'],
      ['/var/lib/moxley/database', 'windows'],
    ];
    for (const [rootInput, flavor] of rejectedInputs) {
      assert.equal(
        classifyRootInputForCharacterization(rootInput, flavor),
        ROOT_INPUT_CLASSIFICATION.rejected,
        `${String(rootInput)} as ${flavor}`,
      );
    }

    const classifierSource =
      classifyRootInputForCharacterization.toString();
    for (
      const forbiddenOperation of [
        'path.',
        'resolve(',
        'realpath',
        'readFile',
        'readdir',
        'stat(',
        'exists',
      ]
    ) {
      assert.equal(
        classifierSource.includes(forbiddenOperation),
        false,
        forbiddenOperation,
      );
    }
  },
);
