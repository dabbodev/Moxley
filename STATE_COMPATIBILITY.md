# Moxley State Compatibility Policy

Status: Marker separability, future node identity, derived runtime-location
authority, root-input lexical rules, persisted-name grammar, filesystem
canonicalization and containment policy, the Windows reparse-classification
mechanism, and the future native build and private internal-loader contract are
selected; test-only native characterization is recorded, but no production
native implementation or traversal integration exists and complete version-1
qualification remains a no-go.
Date: 2026-07-31
Historical behavior baseline: `518ab5ab58500a84246770e8ef0180856e127abd`
Discriminator decision input baseline: `635a7c09bcca63c3abbb52d5c2fbbce4b87a9817`
Persisted-evidence inventory baseline: `3368824d8ab58d6ce8a5964b2acb8c846823430e`
Node-identity decision input baseline: `a2b06a9eecec16aa55869be1748dd03edff6b2ba`
Runtime-location decision input baseline: `0be070c041644ecd5c4ef2138f4654c17f15dcb3`
Root-input and persisted-name decision input baseline:
`44000d8625b5ba724bb090bd61ef287e3ac699f6`
Filesystem containment decision input baseline:
`f65acb4a413b462bd2ff8be1f5d668a9b151768a`
Windows reparse decision input baseline:
`9a33fca1ed185516b3c6433369a8279bb15cb9a9`
Native build and internal-loader contract input baseline:
`33822da91018be3ec8e2e8c76d4cf03036861473`
Decision authority: David Giles, sole owner of Moxley

These repository baselines are evidence and decision inputs. None is a
persisted-format version, package release, or prediction of a later merge
commit.

## 1. Historical evidence

The historical behavior characterized before the historical behavior baseline
showed that `_create('descendant')` wrote a non-root `0/_state.ms` containing:

- `_loc` pointing at physical child directory `0`;
- `_id` `0`;
- `_name` `root`;
- `_keys` `[]`; and
- `_bindings` `[]`.

The finalized in-memory child instead had `_id` `0/0` and `_name`
`descendant`. An ordinary reopen consumed the provisional persisted name,
reconstructed the child as `root`, and could create a `root.ml` binding
artifact.

PR #11 changed only new `_create()` writes so that the finalized `_id` and
`_name` are persisted after child construction. It deliberately left
historical provisional child-state bytes untouched. Current ordinary loading
still accepts the characterized historical shape and can reproduce its
historical reconstruction and binding-artifact behavior.

Current `master` does not store a persisted-format identifier or version.
Historical and current unversioned root `_state.ms` bytes can be
indistinguishable because PR #11 changed finalized child-state values, not the
root-state format. Structure alone therefore cannot establish whether an
otherwise identical root is historical, current, qualified, or version 1.

At the decision input baseline, PR #12 truthfully selected the
no-silent-migration policy and stopped before choosing a persisted-format
discriminator. This later owner decision resolves that one ambiguity without
rewriting the earlier decision history.

## 2. Already-selected no-silent-migration policy

- Ordinary load must never silently migrate historical or otherwise
  unversioned state.
- A future hardened runtime must fail closed when persisted state is
  unqualified or when an exact, separately approved detector rejects it.
- Fail-closed behavior means rejection without rewriting state, deleting
  files, synthesizing replacement bindings, or claiming successful readiness.
- Silent normalization, automatic rewrite, best-effort continuation, and
  implicit `root.ml` cleanup are prohibited.
- `_saveState()` must never convert legacy state merely because a legacy
  database was opened or mutated.
- Migration remains a separate, explicit, later-authorized operation.

Current code does not implement that detector or rejection behavior. These are
policy requirements, not claims of runtime enforcement.

## 3. Selected future persisted-format discriminator

On 2026-07-28, David Giles selected boundary 2: future-created databases will
carry an explicit, root-owned persisted-format discriminator and version.

The exact logical marker in the parsed root `_state.ms` object is:

```json
{
  "_format": "moxley-db",
  "_formatVersion": 1
}
```

At the time of the marker decision, these fields were described as additions
to the then-current root-state shape. Later owner decisions govern the complete
future version-1 shape: in particular, the selected location contract below
requires version-1 root and child state to omit the current `_loc` field.

- `_format` is the exact case-sensitive string `moxley-db`.
- `_formatVersion` is the JSON number and integer `1`, not the string `"1"`.
- The marker belongs only in the root `_state.ms`.
- Child `_state.ms`, collection `_colstate.mc`, named `*.ml` bindings, data
  files, functions, and templates must not carry the root marker.
- Object-property order and insignificant JSON or flatted framing are not
  semantic.
- Detection must operate on the parsed logical value, not substring matching.
- A matching marker is necessary but not sufficient for accepting a database.
  Later whole-database preflight must still validate all required structural
  evidence.
- Version 1 is a persisted-layout compatibility identifier. It is not an npm
  package version.

The structural-only alternative is rejected. Byte-identical unversioned
historical and current roots cannot be made qualified by inference, and a
future hardened loader must not infer a version from otherwise identical
structure.

## 4. Creation, legacy, and enforcement boundary

- Current `master` does not emit the marker.
- No existing database is retroactively version 1.
- Every database created before the future marker-writing implementation
  remains unversioned, including databases created after PR #11 and before
  that future implementation.
- An unversioned root is legacy, unqualified persisted state.
- Missing `_format`, missing `_formatVersion`, malformed marker values, unknown
  format names, unsupported versions, or a root marker appearing only below
  the root must fail closed once enforcement exists.
- Unknown future versions must not fall back to version 1 behavior.
- Ordinary load must not add the marker to an unversioned database.
- `_saveState()` must not add it as a side effect of opening or mutating legacy
  state.
- Mere absence of `_state.ms` inside an existing directory is not proof that
  the directory is a fresh database.
- The future creation implementation must establish new-database status before
  its first write and include the marker in the first persisted root state.
- This decision does not choose or add a new public create or open API.

The documentation decision alone does not cause version 1 state to exist.
Until separately approved writing and enforcement are implemented, there is no
runtime-supported version 1 database.

## 5. Persisted-format versioning policy

- Persisted-format versions are independent of npm/package SemVer.
- A package release must explicitly state which persisted-format versions it
  reads and writes.
- Writers emit one exact supported version.
- Readers fail closed for unsupported versions.
- An incompatible change to required files, field interpretation, identity
  rules, or structural invariants requires a new persisted-format version.
- Runtime-only fixes that do not alter accepted or emitted persisted structure
  do not automatically require a format-version increment.
- Version 1 is reserved for the future marker-writing implementation and its
  separately approved structural contract.
- This documentation decision does not create version 1 state.
- No tag, release, npm publication, or package-version change is authorized.

Repository `package.json` remains `moxley-db@3.1.1`. That package version does
not identify a persisted format.

## 6. Behavior not yet implemented

This decision record does not implement:

- writing the marker during creation;
- separate existing-database opening and new-database creation operations;
- root canonicalization, non-following entry inspection, or contained
  traversal;
- filesystem type, link, reparse, device, object-identity, or link-count
  enforcement;
- parsed-value marker detection;
- whole-database preflight or traversal;
- fail-closed loader enforcement;
- a public or exported detector API;
- migration, repair, normalization, or legacy conversion; or
- support for any persisted-format version.

No runtime may cite this document alone as evidence that it reads or writes
version 1.

## 7. Completed marker and identity characterization evidence

PR #14 completed the fixtures-and-characterization slice that the
discriminator decision required. At the persisted-evidence inventory baseline,
the repository contains fixed preimages for:

- an unversioned historical root shape;
- an unversioned historical nested shape;
- an unversioned post-PR #11 nested shape; and
- a synthetic proposed version-1 root-marker shape.

The fixtures use
`/__moxley_characterization_sentinel__/database/` as a visibly non-user
location. They are characterization exemplars, not archived user databases or
directly loadable runtime fixtures. Their byte lengths, SHA-256 values, final
framing, and exact `0/0` named-link bytes are asserted by the automated
characterization tests.

That evidence proves that marked and unversioned roots are mechanically
separable, that historical roots are not version 1 by structural inference,
that marker mutations are distinguishable, and that the marker is root-owned.
It does not prove that the proposed marked tree is a complete, accepted, or
runtime-supported database format.

PR #17 added a separate synthetic identity-characterization tree with fixed
root and child UUIDs, root `_parentId: null`, child `_parentId` equal to the
root UUID, and exact UUID-only named-link bytes. Its test-only classifier
characterizes UUID syntax, uniqueness, physical-parent agreement, and
same-tree link targets without constructing or loading the fixture tree.

PR #19 added a separate synthetic locless-characterization tree. Its root and
child state omit `_loc`, retain the fixed UUID and `_parentId` evidence, keep
the marker root-only, and preserve exact UUID-only link bytes. Its test-only
classifier rejects any own `_loc` property, treats deployment-root labels as
non-persisted inputs, and characterizes same-parent slot relabeling without
runtime construction, loading, or path resolution.

PR #21 added a separate synthetic encoded-name tree. Its state bytes are
identical to the locless fixture states, its child occupies exact slot `n_0`,
and its UUID-only link is named
`k_64657363656e64616e74.ml`, the canonical lowercase-hex encoding of logical
alias `descendant`. Test-only helpers characterize strict NFC, UTF-8,
lowercase-hex, typed-entry, collision, slot, and root-input lexical rules
without filesystem resolution or runtime loading.

The repository now contains 19 fixed persisted-preimage files. Every state
preimage that predates the locless tree, including the UUID-characterization
states, retains the sentinel `_loc` value selected for its earlier evidence
purpose. Those bytes remain immutable. The identity, locless, and encoded-name
trees prove their selected layers independently. None is an accepted
version-1 database or filesystem-containment fixture.

## 8. Persisted-evidence audit method and labels

This inventory and the later path/name decision audit are grounded in the
complete `index.js`, the package manifests, this policy, the complete README,
legacy `test.js`, every current automated test and worker, and every
persisted-preimage fixture at the applicable decision baseline. The audits
traced every filesystem read and write, every `flatted.parse` and
`flatted.stringify`, every `eval` and function-source conversion, every direct
logical-name-to-path construction, and every constructor or proxy path capable
of filesystem mutation.

Legacy `test.js` is manual example code rather than part of the npm test
command. It can create repository-local state if executed, so the audit read it
without running it. `_loadFromCSV()` consumes an external CSV and writes nodes
through the ordinary storage path; the CSV is import input, not a persisted
database-tree category.

The labels below keep different kinds of statements separate:

- **Selected authority** is a decision already made by David Giles.
- **Source fact** is directly present in current implementation behavior.
- **Test or fixture evidence** is an assertion made by the current automated
  suite or fixed preimages.
- **Inference** is a consequence of combining source facts; it is not a
  compatibility decision.
- **Recommendation** proposes dependency order only; it does not select format
  support.

README descriptions show intended or documented functionality. They are not
version-1 qualification evidence.

## 9. Complete persisted-category evidence matrix

| Category | Writer | Reader and exact known logical shape | Relationships | Execution and mutation boundary | Current validation and evidence | Version-1 disposition and missing decision |
| --- | --- | --- | --- | --- | --- | --- |
| Root and child node state: `_state.ms` | **Source fact:** `DB._saveState()` writes `flatted.stringify(state)`. Current fields, in writer order, are `_loc`, `_id`, `_name`, `_keys`, `_bindings`, plus optional `_childTemplate` containing another flatted string. **Selected authority:** a future version-1 root adds exact `_format: "moxley-db"` and integer `_formatVersion: 1`; every future version-1 node has UUID `_id` and `_parentId`, and root and child state omit `_loc`. | **Source fact:** `DB._loadState(loc)` selects `<loc>_state.ms` from its runtime argument and parses it. `_loadFromDir()` copies root `_keys` and `_bindings`, reconstructs optional `_childTemplate`, and reads child `_name`; it does not assign saved `_loc` or preserve saved child `_id`. Current master does not write or enforce the marker, UUID, `_parentId`, or locless contract. | Current `_loc` names a runtime path; current `_id` is root `0` or a positional child path. Future version-1 physical parentage is selected through `_parentId`; runtime location is derived from the opened root and physical traversal and is not persisted identity. | Parsing ordinary fields does not itself execute code. Reconstructing `_childTemplate` creates function-source-bearing template state. `DB`, child, proxy, and collection constructors are filesystem-mutation-capable: missing derived locations can be created and proxy assignments can persist files. | **Test or fixture evidence:** fixed historical, corrected-child, marker-only, UUID-identity, locless, and encoded-name preimages characterize their selected layers. Other tests characterize recursive readiness, parse-failure propagation, restart reconstruction, and duplicate positional children. **Source fact:** current load ignores saved `_loc` as traversal authority but does not reject or validate it and does not comprehensively validate the other relationships. | **Partially selected for future version 1:** UUID, `_parentId`, locless node-state semantics, exact internal state names, root-input lexical rules, typed physical naming, and the filesystem qualification policy are defined below. Serialization, loading, generation, platform-capability proof, collection identity, and the complete accepted schema remain unimplemented or unresolved. |
| Node data: `*.md` | **Source fact:** the proxy `set` path writes `flatted.stringify(value)` to `<key>.md` and adds a new property name to node `_keys`. | **Source fact:** proxy `get` lazily reads and `flatted.parse`s `<key>.md` when the property is not already materialized. The logical value is any value accepted by the current flatted writer; no narrower persisted schema is selected. | Each filename stem is intended to correspond to one `_keys` entry on the containing node. **Selected authority:** a future version-1 data entry uses `k_<hex>.md`, where `<hex>` canonically encodes the normalized logical key. | Lazy data parsing does not call `eval`. Ordinary construction and later proxy writes remain mutation-capable, but a future preflight must not use them. | No current fixed preimage contains `*.md`. Current loading does not prove a one-to-one relation between `_keys` and data/link/function files, reject extra evidence, or reject missing or multiply typed evidence for one key. | **Partially selected:** the logical-name and physical-filename grammar is defined below. A serializable-data schema, complete `_keys` relationship, flatted-value limits, and runtime enforcement remain unresolved. |
| Named node links: `*.ml` | **Source fact:** assigning a current node through the proxy writes the target node's textual positional `_id` to `<key>.ml` and adds the stem to parent `_keys`. | **Source fact:** current lazy proxy access reads the file as text and resolves it through root `_getById()`, which traverses numeric child positions. The characterized legacy bytes for `descendant.ml` are exactly `0/0`. | The filename stem is the alias key and a parent `_keys` entry. **Selected authority:** future version-1 node links contain a target UUID, use `k_<hex>.ml`, and resolve through the complete same-database node-ID index; they are references, not ownership edges. | Reading current link text does not evaluate code or directly write, but target resolution depends on a constructor-reconstructed positional graph, and that construction path is mutation-capable. Future preflight resolution must occur before reconstruction without writes. | **Test or fixture evidence:** PR #14 proves byte identity of historical, post-PR #11, and marker-only positional links. PR #17 and PR #19 add synthetic UUID-only link evidence without runtime loading; PR #21 adds the same UUID-only bytes under canonical encoded link name `k_64657363656e64616e74.ml`. | **Selected for future version-1 node links only:** exact UUID bytes, same-tree resolution, alias semantics, failure conditions, and typed filename grammar are defined below. Collection item links, `_bindings`, and runtime enforcement remain deferred. |
| Stored functions: `*.mf` | **Source fact:** assigning a new function writes `Function.prototype.toString()`-style source through `arg.toString()` and adds the stem to `_keys`. | **Source fact:** lazy proxy access reads the source, passes it to `eval`, binds the resulting function to the origin node, and returns it. | The stem is a node `_keys` entry. Template hooks can store textual function IDs and resolve them through `_findFunction()`, which reaches the same lazy function reader. **Selected authority:** `k_<hex>.mf` is reserved as the future typed classification name only. | Reading the property crosses an `eval` boundary. Calling it or resolving a hook can execute persisted code with node access. The enclosing constructor-backed graph is mutation-capable even before later property writes. | No fixed preimage or automated qualification test covers `*.mf`, source grammar, origin binding, hook reference integrity, or code-execution policy. | **Unresolved and not approved for version 1.** Reserving the typed suffix does not approve executable persistence. David Giles must explicitly choose whether executable persisted evidence is included, excluded, or governed by a separate trust policy. |
| Collections: dotless directory, `_colstate.mc`, per-item `*.ml`, and node `_bindings` | **Source fact:** `DC._saveState()` writes a flatted object with `_loc`, `_name`, `_keys`, and `_indexBy`, plus optional `_keySort`, `_itemSort`, and `_accept` function source. Proxy assignment of node items writes textual-ID `*.ml` entries. `DB._bind()` stores collection IDs in node `_bindings`. | **Source fact:** `DC` derives runtime `_loc` as parent `_loc` plus collection name. A dotless entry without child `_state.ms` is constructed as a collection. `DC._loadState()` parses `_colstate.mc`, ignores saved `_loc`, and evaluates optional callback sources. A collection ID is derived from parent node ID plus directory/name rather than stored in `_colstate.mc`. | Collection `_keys` correspond to item-link stems; each link should resolve to a node; `_indexBy` influences keys; `_bindings` must resolve to a collection; parent path, collection name, and derived ID must agree. | Collection state loading evaluates callback source. `_accept`, `_keySort`, and `_itemSort` may execute during add/sort behavior. Collection construction can create a missing derived directory, and proxy-based item insertion can write links and state. | Current tests and fixtures do not give collections equivalent reconstruction, readiness, callback, binding, or restart coverage. Current load starts constructor-backed collection state loading without an equivalent complete readiness contract and does not validate its relationships. | **Unresolved.** Collections are not approved for version 1. The exact `c_<hex>` directory namespace and `_colstate.mc` reservation are selected only for unambiguous future classification. They do not select collection schema, identity, callbacks, links, bindings, or lifecycle. |
| Templates: node `_childTemplate` | **Source fact:** `DT` converts `apply` and function-valued nested fields to source strings; `DT.toString()` flatted-serializes `{strict, apply, keys}`; node `_saveState()` embeds that string in `_state.ms`. | **Source fact:** `_loadFromDir()` parses the nested string and constructs `DT`. Template initialization assigns defaults, contains a function-default evaluation branch, evaluates and invokes `apply`, and saves state. Proxy assignment evaluates and invokes validators. Hooks resolve stored function references and invoke them. | The parent carries the child template; newly created children receive it. Nested key rules relate defaults, validators, and hooks to node properties and stored functions. | `apply` and validators cross `eval` and invocation boundaries. Hooks can evaluate and invoke `*.mf`. The source contains a default-function evaluation path, while `DT` serializes function-valued fields to strings; the persisted default-function lifecycle has no qualification proof. Template application writes defaults and state. | No fixed preimage or automated qualification suite covers nested template framing, validator/default/apply/hook reconstruction, rejection behavior, or execution order. | **Unresolved and not approved for version 1.** Executable-template policy, hook/reference semantics, exact nested schema, and lifecycle evidence require owner decisions and dedicated fixtures. |
| Directory and entry classification | **Source fact:** root, child, and collection constructors create their expected directories when absent; there is no persisted directory type tag. | **Source fact:** `_loadFromDir()` enumerates a directory, ignores entries whose names contain `.`, forms a candidate child path by string concatenation, classifies a dotless entry with `<entry>/_state.ms` as a child, and otherwise constructs it as a collection. `path.resolve()` is used only to compare a candidate with already reconstructed child locations, not to establish the opening root or enforce containment. | Physical entries must eventually agree with state, UUID, parent, keys, collection, link, and binding evidence. **Selected authority:** future traversal locations come only from the canonical root and directly enumerated, non-link, contained relative entries, never persisted `_loc`; exact typed entry names and filesystem qualification rules are defined below. | Current classification uses constructor-backed reconstruction before whole-tree validation; those paths can write and can reach executable collection or template evidence. | Tests characterize selected child recursion and failure propagation. PR #21 characterizes the typed lexical grammar only; no current test supplies the required `realpath`, non-following metadata, link/reparse, device, object-identity, or link-count platform evidence. | **Partially selected:** root-input lexical rules, typed entry grammar, canonical encoding, separate open/create modes, canonicalization sequence, containment, accepted object types, and fail-closed link/device/object policy are selected. Implementation, platform-capability proof, locking, and complete relationship validation remain unresolved. |

## 10. Cross-category limitations confirmed by live source

The following are **source facts** or direct **inferences** from the matrix:

- Current root `_loc` is the constructor input string supplied through
  `Lizzo(loc)` to `DB(loc)`. `_scanLocation()` tests and may create that string
  directly; current opening does not first establish a selected resolved-root,
  canonicalization, containment, or `realpath` policy.
- Current production code does not itself require that constructor input to be
  a primitive string or lexically absolute, and it performs no Moxley-level
  rejection of URLs, NUL, home or environment expansion syntax, UNC roots, or
  Windows device namespaces before invoking filesystem APIs.
- Current child `_loc` is `parent._loc`, the current child-array length, and
  `"/"` concatenated as strings. During load, `_loadFromDir()` also forms a
  candidate from `this._loc`, an enumerated entry, and separators, while the
  child constructor still derives its location from child count.
- Current `_saveState()` persists node `_loc` in every root and child
  `_state.ms`. `DC._saveState()` persists collection `_loc` in
  `_colstate.mc`.
- Current node and collection state readers parse saved `_loc` but do not
  assign or use it as traversal authority. After complete-tree relocation,
  those absolute or creator-specific bytes can therefore be stale until a
  later current-runtime save writes the newly derived runtime path.
- Current collection `_loc` is the parent node `_loc`, collection name, and
  `"/"` concatenated as strings. Collection construction can create that
  directory before equivalent whole-tree readiness is established.
- Current persisted link contents are textual IDs and do not supply filesystem
  paths. However, a saved child `_name` is passed into constructor/proxy
  reconstruction and can influence a parent `<name>.ml` filename, and property
  names are concatenated with runtime `_loc` for lazy data, link, and function
  files. Filename grammar and containment are therefore still required even
  when persisted `_loc` is removed.
- Current property and alias names are used directly as filename stems for
  `.md`, `.ml`, and `.mf`; collection names are used directly as directories;
  and collection keys are used directly as item-link stems. Current source
  performs no Unicode normalization, UTF-8/hex encoding, separator rejection,
  reserved-name check, case-collision check, or cross-type collision check.
- Current child directories are bare decimal array positions such as `0` and
  `1`, not typed slot names. `_loadFromDir()` ignores every entry whose name
  contains a dot and classifies every remaining entry by the presence or
  absence of child `_state.ms`; it does not fail closed for unknown entries.
- Current root setup conflates two modes: `_scanLocation()` creates the
  caller-supplied root with one `fs.mkdirSync()` call when `fs.existsSync()`
  reports absence and otherwise adopts the existing path. It does not first
  require an ordinary directory, distinguish an empty collision, canonicalize
  the parent or root, or post-check a new root.
- Current production code does not call `lstat`, `realpath`, `opendir`, or any
  symbolic-link classifier. It reads no `dev`, `ino`, or `nlink` evidence and
  maintains no filesystem-object identity set. It therefore does not enforce
  non-following metadata inspection, reject symlinks or reparse points, detect
  device crossings or hard links, detect physical aliases or cycles, or
  establish separator-aware containment.
- Current `fs.mkdirSync()` failures propagate from constructors. Production
  source contains no corresponding rollback, deletion, rename, or cleanup
  path after creation.
- As an inference from direct string concatenation, caller or persisted logical
  names can currently influence filesystem interpretation, including separator
  and dot behavior. The exact result is host-filesystem-dependent and is not a
  selected or qualified behavior.
- Current child IDs are positional and path-derived. They are not declared
  stable and are not future version-1 identities.
- Named links contain textual IDs and depend on that positional graph.
- Current collection IDs append a collection name to a node path, and current
  function references append a property name to a node path. Neither form is
  selected by the future node-only identity decision.
- Current loading does not fully validate persisted `_loc` or `_id`, nor their
  agreement with physical parent/child placement.
- `_keys` is used as a logical inventory, but current loading does not prove it
  matches exactly one persisted data, link, or function entry per key.
- Collection readiness and reconstruction have not received qualification
  coverage equivalent to the node/link characterization.
- Stored functions, template functions and hooks, and collection callbacks
  cross an `eval` or equivalent persisted-code execution boundary.
- Constructor-backed loading and proxy behavior are not suitable for a
  read-only preflight because those paths are capable of creating directories
  or writing state and property files.
- Marker separability resolves none of the identity, path, reference,
  executable-code, collection, lifecycle, or containment issues.
- README functionality is descriptive documentation, not qualification
  evidence.

## 11. Version-1 scope candidate comparison

| Candidate | What it would cover | Evidence and compatibility assessment | Disposition |
| --- | --- | --- | --- |
| 1. Full legacy feature surface | Nodes, data, links, functions, templates, collections, callbacks, and bindings. | Preserves the broad documented feature surface, but current evidence does not close positional identity, stored locations, link integrity, `_keys`, collection lifecycle/readiness, or constructor mutation. It would also accept multiple persisted-code evaluation paths without an approved execution policy. | **No-go under current authority and evidence.** |
| 2. Initial non-executable subset | Nodes, serializable data, and named links; excludes persisted functions, executable templates, and callback-bearing collection behavior. | Reduces execution exposure, but no owner decision authorizes dropping legacy features from version 1. Callback-bearing and callback-free `_colstate.mc` values can be distinguished at the optional-field level after parsing. That distinction does not reliably qualify a basic collection because collection identity, state, links, bindings, classification, and readiness are unresolved. | **Unresolved.** Requires explicit owner authority for the compatibility reduction and a separate collection decision. |
| 3. Node/link characterization subset only | Only the root, child-state, marker, identity, and named-link relationships represented by the PR #14 and PR #17 fixtures. | These fixture shapes are mechanically separable, and the identity layer has selected mutation evidence. The subset lacks general data, exhaustive trees, collections, bindings, templates, functions, unexpected-entry rules, locless state, and most whole-tree relationships, so it is not a useful general database format. | **Evidence exemplar only; not selected as version 1.** |
| 4. Prerequisite-first boundary | Defers qualification until identity, runtime-location/relocation authority, executable-feature policy, and supported collection/feature scope are selected. | Node identity, named-link semantics, and the locless runtime-location authority are selected below. Executable-feature, collection, detailed path, and complete-schema prerequisites remain open. This ordering prevents the marker or closed prerequisites from being mistaken for a complete acceptance contract. | **Current gate disposition: no-go pending the remaining decisions.** This is not a selection of a reduced format. |

## 12. Future whole-database no-write evidence graph

If and only if a version-1 evidence set is later selected, a future read-only
preflight must follow this dependency order:

1. Validate the selected root-input lexical class without writing.
2. Select the future semantic mode: open an existing database or create a new
   database.
3. Apply the selected root canonicalization, object-type, link/reparse, and
   containment policy without adopting pre-existing bytes in create-new mode.
4. Read and parse root `_state.ms`.
5. Classify marker absence, malformed marker, unknown format, and unsupported
   version.
6. Reject persisted `_loc` in marked version-1 node state and establish only
   process-local runtime locations from the resolved root and physical
   traversal.
7. Enumerate the complete candidate tree without constructors or proxy writes.
8. Classify every entry by the exact typed physical grammar, reject unknown or
   noncanonical entries, and decode canonical logical names.
9. Read and parse all required state and link evidence.
10. Validate root, child, UUID, physical-parent, and normalized-name
    relationships.
11. Validate `_keys` against persisted data, link, and function evidence,
    including duplicate decoded names and cross-type collisions.
12. Validate collections and bindings if their support is later approved.
13. Reject executable persisted evidence unless an explicit policy permits it.
14. Complete all validation before reconstruction, evaluation, or mutation.

Preflight must not use constructor-backed reconstruction. It must not perform
`eval`, function construction, hook execution, template application, callback
execution, or any file or directory creation, rewrite, deletion, rename, or
normalization. A matching marker is necessary but not sufficient; success
requires the complete selected evidence set.

No current or proposed check can be described as safely handling concurrent
filesystem mutation while locking and race policy remain deferred.

## 13. Semantic classification precedence

The selected future preflight classifies failures in this semantic order,
without this document inventing a public error class, error code, or final
message format:

1. Invalid root input or missing or invalid semantic mode.
2. Root existence, object-type, link, or reparse failure.
3. Root canonicalization failure.
4. Root-state access, read, framing, parse, or marker failure, preserving an
   underlying filesystem cause where one exists.
5. Raw entry-name failure.
6. Entry object-type, link, or reparse failure.
7. Containment, device, hard-link, or repeated physical-object-identity
   failure.
8. Persisted content, feature, structural, relationship, or reference
   failure.
9. Success only after the complete selected evidence set passes.

Peer entries are processed in deterministic canonical-relative-path order.
Valid canonical ASCII physical names sort bytewise. Invalid raw names are
never normalized or renamed. Where invalid peer names must be ordered, the
implementation must use stable raw-name byte ordering if the platform exposes
it. If stable raw-name bytes are unavailable, this record does not claim
cross-process deterministic precedence for that case.

This ordering applies only to a future independent preflight. Current ordinary
loading uses filesystem enumeration order and does not implement it.

## 14. Current identity and link behavior

The following are **source facts** about current unversioned behavior. They are
not the selected future contract:

- `DB` initializes the root `_id` to `"0"`.
- `DN` derives its physical directory from `parent._children.length`, calls the
  base constructor for that location, and only afterward assigns `_parent`,
  `_root`, positional `_id`, and final `_name`.
- If that child location did not exist, the base constructor creates the
  directory and writes provisional root-like state before the child has its
  finalized metadata. `_create()` later saves the finalized child state.
- `DN` derives a child `_id` as the parent `_id`, `/`, and the same current
  child-array length. The child is pushed into `_children` only after that
  constructor completes.
- `_loadFromDir()` reads the saved child `_name`, constructs a new child at the
  next positional slot, and does not assign the saved child `_id`; current load
  therefore reconstructs positional identity.
- Proxy assignment of a `DN` writes `arg._id` directly into `<alias>.ml`.
  Current lazy link access reads those bytes and calls `_getById()`, which
  splits the value on `/` and traverses `_children` indexes.
- Creating a named child can create a same-named alias on its parent, while
  `_link(target, alias)` accepts an independently supplied alias. Current source
  therefore distinguishes descriptive node name from alias key even though
  the common creation path makes them equal.
- `DC` derives a collection `_id` by appending its name to its parent node ID.
  `_bindings` stores those collection IDs, and `_findCollection()` splits the
  final path component from the node path.
- Template hook function references are documented and resolved as a node path
  plus function property. `_findFunction()` splits that path and delegates the
  node portion to `_getById()`.

Current runtime tests characterize `"0"`, `"0/0"`, `"0/1"`, numeric
directories, and `0/0` named-link bytes. Separate synthetic PR #17 and PR #19
fixtures characterize the selected UUID, `_parentId`, UUID-only link, and
locless layers without runtime loading. They do not implement UUID identity.
No live field named `_parentId` exists, so the selected field does not collide
with current serialization.

## 15. Selected future version-1 node-ID wire contract

On 2026-07-28, David Giles selected immutable opaque UUID identity for every
future version-1 node, including the root.

The logical node-state contract is:

- `_id` is one canonical lowercase UUID version 4 string.
- Its syntax is exactly:

  ```text
  ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
  ```

- `_parentId` is exactly `null` for the root.
- `_parentId` is the canonical UUID of the physical parent for every non-root
  node.
- Every `_id` is unique within the complete database tree.
- An ID is assigned once before that node's first filesystem write.
- An ID never changes because of close or reopen, directory enumeration order,
  insertion order, naming, aliasing, or physical-slot renumbering.
- Callers cannot supply, replace, or mutate a persisted node ID.
- Loading preserves the exact persisted `_id` instead of reconstructing it.
- The root has an ordinary node UUID. Version 1 has no reserved `"0"` identity.
- This slice does not create a separate database UUID.
- A complete copied database may preserve its node IDs as a clone. Uniqueness
  is required within each database tree and is not claimed globally across
  every copy.
- `_loc` is not a persisted version-1 node-state field. Runtime location is
  derived internal state under the contract selected below.

`node:crypto.randomUUID()` is the preferred future generator because it
requires no package dependency. This record does not call or implement it.
`package.json` currently selects no Node engine floor. Before later runtime
support, if the supported Node range cannot guarantee `randomUUID()`, David
Giles must select an explicit engine floor. An unreviewed dependency, weak
random fallback, or caller-supplied ID is not authorized.

Current positional values such as `"0"` and `"0/0"` are not UUIDs and are not
version-1 identities.

## 16. Physical ownership semantics

- The root is the only node with `_parentId: null`.
- Every non-root node has exactly one physical parent.
- Physical containment is the ownership edge.
- A non-root `_parentId` must equal the UUID of that physical parent.
- A node directory name is a physical storage slot only.
- Numeric directories are storage slots only and are never identity.
- Directory names, enumeration order, and child-array indexes do not determine
  `_id`.
- Duplicate node IDs reject the complete candidate database.
- A missing or mismatched parent ID rejects the complete candidate database.
- A non-root node claiming `_parentId: null` is invalid.
- A root claiming a non-null `_parentId` is invalid.
- Moving a node beneath another physical parent cannot be accepted silently.
  It requires a separately designed reparent operation or migration.
- `_loc` is not identity and must not derive `_id` or `_parentId`.
- Future runtime-location authority is derived from the caller-selected root
  and physical traversal, as selected below. Canonicalization, containment,
  filename, and filesystem enforcement remain unresolved.

The future slot lexical form is selected below as `n_<slot>`. This record does
not select allocation, reuse, numeric bounds, deletion, compaction, ordering,
renaming procedure, or renumbering behavior.

## 17. Named node-link semantics

For a future version-1 node `*.ml` link:

- The complete file contents are exactly one canonical node UUID.
- There is no BOM, whitespace, CR, LF, path, JSON wrapper, or additional field.
- Resolution uses the complete in-database node-ID index built during
  read-only preflight.
- The target must exist exactly once in the same database tree.
- A missing target is dangling and rejects the candidate database.
- A malformed UUID rejects the candidate database.
- A duplicate target ID rejects the database before link resolution.
- Links never refer to physical paths or positional IDs.
- Links are aliases or references, not physical ownership edges.
- Multiple aliases may refer to the same node.
- An alias may target the root or any other node in the same database.
- Reference cycles are not ownership cycles and are not rejected solely for
  being cyclic.
- The link filename supplies the alias key.
- The alias key need not equal the target node's `_name`.
- A named child created through `_create(name)` may create a matching alias,
  but identity does not depend on that alias.
- `_name` remains descriptive or creation metadata. It is not identity and is
  not globally unique.
- Cross-database links are not supported by this contract.

Collection item links and `_bindings` remain outside this node-link decision
until collection identity is separately selected. The future typed filename,
canonical encoding, and case-collision rules are selected below. Containment
and filesystem-object enforcement remain later decisions.

## 18. Compatibility consequences

- This is a breaking semantic change from unversioned positional IDs.
- Existing callers may interpret `_id` as a hierarchical path, as the current
  README describes.
- No current package release writes or loads the UUID and `_parentId` contract.
- No existing fixture is retroactively rewritten.
- The PR #14 proposed-marker fixture remains synthetic marker evidence, not
  UUID-identity or locless version-1 evidence.
- The PR #17 UUID-identity fixture remains synthetic identity evidence with a
  sentinel `_loc`; it is not locless version-1 evidence.
- The PR #19 locless fixture remains synthetic location/identity evidence with
  legacy physical names; it is not final typed-name version-1 evidence.
- Unversioned databases remain legacy and unqualified.
- Unversioned positional IDs are never silently upgraded.
- No deterministic or authorized automatic mapping exists from `"0/0"` or any
  other positional ID to a UUID.
- Migration requires an explicit old-to-new mapping ledger and separate owner
  approval.
- Package SemVer and release policy remain unselected.
- Documenting this contract does not qualify version 1.

## 19. Future preflight identity order

A later implementation must validate identity and node links in this order:

1. Parse and validate the exact root marker.
2. Validate the root `_id` UUID and `_parentId: null`.
3. Enumerate every physical node without constructing runtime nodes.
4. Parse each node state.
5. Validate UUID syntax and build the complete node-ID index.
6. Reject duplicate IDs.
7. Validate each physical parent/child edge against `_parentId`.
8. Only after the node index is complete, parse and resolve node `*.ml` links.
9. Reject malformed and dangling references.
10. Only after all identity and reference evidence passes may reconstruction
    begin.

No constructor, proxy write, `eval`, template application, callback, or
persisted mutation is allowed during these steps. This slice does not define a
stable public error class, final error wire shape, or numeric resource limits.

## 20. Current runtime-location source audit

The following are **source facts** about current master, not claims about the
future implementation:

- `Lizzo(loc)` passes the caller's string to `new DB(loc)`. The root constructor
  assigns that value to `_loc`, and `_scanLocation()` checks or creates that
  location directly. Current opening does not first apply a selected
  `path.resolve()`, `realpath`, containment, or symlink policy.
- A newly constructed child derives `_loc` by concatenating its physical
  parent's `_loc`, the parent's current child-array length, and `"/"`. This can
  create a numeric-slot directory before the child's final `_id` and `_name`
  are assigned.
- During loading, `_loadFromDir()` concatenates the current runtime parent
  location with each enumerated entry to form a candidate. The child
  constructor still derives its own location from child-array position.
  `path.resolve()` is used only to compare that candidate with reconstructed
  child locations; it does not establish or contain the opening root.
- `DB._saveState()` includes `_loc` in every current root and child
  `_state.ms`. `DC._saveState()` includes `_loc` in `_colstate.mc`.
- `DB._loadState(loc)` and `DC._loadState()` parse those persisted objects but
  do not assign saved `_loc` as traversal authority. Current runtime paths come
  from constructor state and concatenation. A stored absolute or
  creator-specific path can therefore become stale after relocation, remain
  present in the bytes, and later be replaced if current code saves state.
- A collection derives runtime `_loc` from its parent node's `_loc`, its
  collection name, and `"/"`. Its constructor can create the derived directory,
  and its saved `_loc` is parsed but ignored during reconstruction.
- Current `*.ml` contents are IDs, not paths. Persisted values can nevertheless
  influence later filenames: a saved child `_name` is used during
  reconstruction, and property names from `_keys` are concatenated with the
  runtime location for lazy `*.md`, `*.ml`, and `*.mf` access.

These facts support removing persisted node `_loc` as future path authority.
They do not prove that current constructor validation, string concatenation,
entry classification, or proxy access satisfies the future path contract.

## 21. Selected future version-1 node location contract

On 2026-07-28, David Giles selected these rules for future version-1 root and
child node state:

- `_loc` is not a persisted version-1 node-state field. Both root and child
  `_state.ms` must omit it.
- A marked version-1 node state containing `_loc` is structurally invalid.
- Runtime `_loc` is reserved internal, process-local state. It is not
  caller-owned persisted metadata.
- Runtime `_loc` does not contribute to node identity and cannot override
  `_id`, `_parentId`, physical ownership, or link resolution.
- Runtime locations are established only from trusted traversal state, never
  from a value in persisted state.
- No state file may redirect traversal to an absolute path, parent path,
  sibling path, drive, UNC target, URI, symlink target, or any other external
  location.

The filesystem contract below now selects exact fail-closed containment and
link, junction, detectable-reparse, mount/device, hard-link, and physical
object-identity rules. Their platform-capability proof and implementation
remain later gates. If collections are later admitted to version 1, their
runtime locations must use the same derived, non-persisted principle. That
statement does not approve collections or select their persisted schema,
identity, bindings, or lifecycle.

## 22. Root runtime location

- A future opening or creation boundary accepts one primitive JavaScript string
  that satisfies the absolute native local root-input lexical contract selected
  below.
- That root is resolved before persisted-tree traversal.
- The resolved runtime root is process-local and is never serialized into
  version-1 node state.
- The persisted tree neither defines nor authenticates its absolute deployment
  root.
- Database identity is not derived from the absolute root path.
- Opening identical persisted bytes at another root does not create new node
  identities.

The filesystem contract below separates open-existing and create-new
semantics and selects their native-`realpath` canonicalization order. This
record does not select public API names or shapes, exact handling of lexical
dot segments and trailing separators, platform-returned drive-letter or case
presentation, or implementation mechanics. It does not claim that current
constructor input handling satisfies either the lexical or filesystem
contract.

## 23. Child runtime location and physical placement

- A child runtime location is derived from the already-contained physical
  parent location and the enumerated direct child entry.
- The child's persisted `_parentId` validates logical ownership; it never
  supplies a filesystem path.
- A canonical future `n_<slot>` name supplies storage placement only.
- Renaming a slot beneath the same physical parent does not change `_id` or
  `_parentId`, provided the later operation preserves the selected typed-name
  and containment policy.
- Directory enumeration order does not change identity.
- Moving a node beneath another physical parent makes `_parentId` disagree
  with physical ownership. The candidate must fail unless a separately
  designed reparent operation updates all required evidence.
- Preflight must not silently repair or rewrite `_parentId`.

This record selects only the slot's lexical form. Allocation, reuse, numeric
bounds, deletion, compaction, ordering, and the mechanics of renaming or
renumbering remain deferred.

## 24. Relocation and clone semantics

For this contract:

- **Relocation** means moving the complete database tree to another filesystem
  root while preserving all internal persisted bytes and relative entries.
- **Clone** means copying the complete database tree to another filesystem root
  while preserving all internal persisted bytes and node UUIDs.

The selected rules are:

- Complete-tree relocation requires no persisted rewrite or migration solely
  because the absolute root changed.
- Complete-tree cloning preserves node UUIDs. A clone is an independent
  database copy, not a new globally unique identity domain.
- Links resolve only within the opened copy's complete node-ID index. A link
  never crosses from one clone or root into another.
- Concurrently opening an original and a clone establishes no cross-database
  coordination and no shared durability behavior.
- Partial copying, missing or conflicting entries, or changed physical-parent
  relationships are not valid complete relocation or clone evidence.
- Byte preservation is necessary for the defined operation but is not
  sufficient when whole-tree structural validation fails.

This contract does not claim atomic copying, crash-safe relocation,
distributed coordination, or safe live relocation while writers exist.

## 25. Existing fixtures and compatibility

- The 13 historical, marker-only, and UUID-characterization fixture files that
  predate PR #19 remain immutable evidence. Their state files retain the
  sentinel `_loc` selected for their earlier characterization purposes. They
  are not accepted version-1 location fixtures and must not be rewritten or
  relabeled as locless state.
- PR #19 adds three separate locless characterization files. Their root and
  child state omit `_loc`, but their physical child directory is still `0` and
  their link is still named `descendant.ml`. They prove locless identity
  evidence only; they are not canonical version-1 physical-name fixtures under
  the later decision in this record.
- PR #21 adds three separate encoded-name characterization files. Their state
  bytes and UUID-only link bytes are identical to the locless evidence, while
  the child uses slot `n_0` and the link uses canonical encoded name
  `k_64657363656e64616e74.ml`. They prove the selected lexical layer only.
- All 19 persisted-preimage files remain immutable characterization evidence.
- Current runtime continues to persist `_loc`. No current database or fixture
  is silently converted.
- Unversioned state remains legacy and unqualified.
- Omitting `_loc` from future version-1 state is a persisted-format
  incompatibility with current runtime output.
- Package SemVer, release policy, and migration remain unresolved.

Documentation of these semantics neither creates nor qualifies a version-1
database.

## 26. Future preflight location order

A later implementation must establish location evidence in this dependency
order:

1. Validate the selected root-input lexical class without writing.
2. Select open-existing or create-new semantics and apply the selected root
   canonicalization and containment policy.
3. Inspect, read, and parse root `_state.ms` from the canonical root without
   following a link or accepting a multiply linked file.
4. Reject `_loc` in marked version-1 persisted node state.
5. Establish the root's process-local runtime location.
6. Enumerate direct relative entries without constructors or proxy writes.
7. Classify raw entries by the exact typed physical grammar.
8. Derive each child runtime location from its already-contained physical
   parent and accepted enumerated entry.
9. Reject persisted path redirection or unexpected location evidence.
10. Validate UUID and `_parentId` relationships.
11. Continue complete whole-tree evidence validation.
12. Reconstruct runtime objects only after complete acceptance.

No constructor, proxy write, normalization, migration, persisted rewrite,
function evaluation, template application, or callback execution is allowed
during preflight.

## 27. Security limits and portability nonclaims

Omitting persisted `_loc` removes one source of stale-path bytes and denies
persisted node state path-redirection authority. The root lexical, typed-name,
and filesystem decisions below close additional contract questions, but none
is implemented. The selected filesystem contract is a bounded fail-closed
observation and does not solve:

- dot-segment, separator-normalization, or trailing-separator handling;
- time-of-check/time-of-use races;
- inability of a platform to expose reliable reparse, device, object-identity,
  or link-count evidence;
- locking or concurrent mutation;
- filesystem permissions; or
- atomicity, recovery, or durability.

Complete cross-platform portability and security qualification are not
claimed. The selected canonical physical grammar avoids raw logical names and
physical case variants. The selected containment policy still requires
platform evidence, race-safe implementation, and later locking decisions
before any production qualification claim.

## 28. Explicit deferrals and nonclaims

This record continues to defer:

- public opening and creation API names and shapes;
- rollback and error authority after a create-new post-check fails;
- separator normalization, dot-segment handling, trailing-separator behavior,
  drive-letter presentation, and platform-returned path case;
- generic Windows reparse-point detection and the platform adapters needed to
  prove device, object/inode, and link-count evidence;
- handle-relative traversal and race-resistant filesystem operations;
- physical-slot allocation, reuse, bounds, deletion, compaction, and ordering;
- Unicode confusable, bidirectional-text, whitespace, and UI-display policy;
- collection and binding qualification;
- collection identity and collection-item links;
- `_bindings`;
- stored functions and `*.mf`;
- templates, hooks, validators, and callbacks;
- complete `_keys` correspondence;
- executable-content policy;
- the complete version-1 schema;
- a stable error API, final error wire shape, and numeric resource limits;
- locking and concurrent writers;
- atomicity, journaling, recovery, and durability;
- migration, reparenting, and live relocation;
- runtime marker writing, enforcement, preflight, UUID generation,
  serialization, reconstruction, loading, and validation;
- package version, release, tag, and npm publication; and
- Moxley adapter or Thoth behavior.

This record implements no marker writer, detector, migration, path
normalization, name encoding, canonicalization, containment, reconstruction,
relocation, clone, or repair. It does not claim that current master reads or
writes the selected locless or typed-name contract, that any existing database
is version 1, or that the synthetic fixtures are accepted, portable, secure,
durable, or runtime-supported state.

## 29. Current root-input and persisted-name source audit

The following are **source facts** about current unversioned code and evidence:

- `Lizzo(loc)` passes its argument directly to `DB(loc)`. `DB` assigns it to
  `_loc`, and `_scanLocation()` calls `fs.existsSync()` and possibly
  `fs.mkdirSync()` with that value. Moxley performs no primitive-string check,
  absolute-path check, URL rejection, NUL rejection, home or environment
  expansion handling, UNC rejection, or Windows device-namespace rejection
  before invoking filesystem APIs.
- Current root setup does not call `path.resolve()` or `realpath()`.
  `path.resolve()` appears only inside `_loadFromDir()` to compare an
  already-derived candidate child location with an existing reconstructed
  child's `_loc`.
- A new child directory is the parent's `_loc`, the current child-array length,
  and `"/"` concatenated as strings. Current slots are bare decimal names such
  as `0` and `1`.
- `_create(name)` passes `name` into `DN`. A named `DN` assigns through
  `parent[name]`; the proxy can then write the raw property name as
  `<name>.ml`. `_link(target, name)` uses the supplied alias the same way.
- Proxy data, node-link, and function writes concatenate the raw property name
  with `_loc` and `.md`, `.ml`, or `.mf`. Lazy reads perform the same raw
  concatenation.
- `DC` concatenates the raw collection name into its directory and ID.
  Collection item lookup concatenates each raw collection key with `.ml`.
- `_loadFromDir()` ignores an entry if its name contains any dot. A remaining
  dotless entry with `<entry>/_state.ms` is treated as a child; every other
  dotless entry is constructed as a collection. Unknown entries do not fail
  closed.
- Current source contains no Unicode NFC normalization, strict scalar-value
  check, UTF-8/lowercase-hex name encoding, reserved-name check, physical-name
  case check, decoded-name uniqueness check, or cross-type collision check.
- Current tests and 19 fixed preimages characterize selected current,
  historical, marker, identity, locless, and encoded-name behavior. The 16
  earlier preimages retain bare `0` slots and direct `descendant.ml` aliases.
  PR #21's three encoded-name preimages implement the selected typed spelling
  but do not exercise filesystem canonicalization or containment.

The direct-concatenation consequences are **inferences**, not selected
compatibility rules: dots can affect current directory classification,
separators or platform-special spelling can affect path interpretation, and
case behavior depends on the host filesystem. Unicode is passed through as
ordinary JavaScript property text without normalization. No runtime experiment
is needed to establish these source-level facts, and none was run for this
decision.

README examples document direct caller names, relative root strings, and
current features. They are not qualification evidence and do not constrain the
future version-1 grammar selected by David Giles below.

## 30. Selected root-input lexical contract

For a future version-1 opening or creation boundary, David Giles selects one
primitive JavaScript string representing an exact absolute native local
filesystem path.

The lexical boundary rejects:

- every non-string value;
- the empty string;
- any string containing U+0000 NUL;
- relative paths;
- `file:` and every other URL form;
- input that relies on implicit `~` home expansion;
- input that relies on environment-variable interpolation;
- Windows UNC roots; and
- Windows device or extended namespaces, including `\\.\` and `\\?\`.

Callers must provide the root explicitly. Moxley does not expand environment
variables or home-directory notation. The root is process-local runtime input
and is never persisted in version-1 state. A lexically absolute root does not
prove containment, canonical identity, existence, or filesystem safety.

The filesystem contract below selects separate existing-open and new-create
modes, native-`realpath` canonicalization order, and fail-closed link and
containment policy. Exact separator normalization, lexical dot-segment and
trailing-separator handling, drive-letter presentation, and platform-returned
case remain implementation prerequisites. This record does not claim that a
mounted or network-backed POSIX path can be identified reliably from the input
string alone.

The exact public method signature remains deferred. Any later API must preserve
this lexical boundary; it may not silently broaden it through coercion or
implicit expansion.

## 31. Selected logical-name contract

A future version-1 persisted logical name must:

- be a primitive JavaScript string;
- contain only valid Unicode scalar values and no unpaired surrogate;
- normalize to Unicode Normalization Form C;
- be non-empty after NFC normalization; and
- encode to between 1 and 100 UTF-8 bytes, inclusive, after normalization.

This rule applies wherever a future version-1 contract admits a persisted
logical name, including node `_name`, node `_keys` entries, node-link aliases,
data and function keys, and any separately approved collection logical name.
Listing a category here does not approve that category's version-1 support.

The normalized string is the semantic logical value retained in `_keys` or
equivalent logical metadata. The 100-byte name bound is specific to this
logical-name contract and does not select general resource limits.

Logical names remain case-sensitive. They may contain characters that would be
unsafe as raw filenames because logical names are never placed directly into
physical names. They do not derive node identity or physical ownership and must
round-trip exactly through the canonical encoding below.

This record does not select a broader policy for Unicode confusables,
bidirectional text, whitespace, or user-interface display. It makes no claim
that visually similar logical names are semantically equal.

## 32. Canonical UTF-8 and lowercase-hex encoding

The future canonical physical encoding of one logical name is:

1. Normalize the primitive string to NFC.
2. Encode that normalized string as strict UTF-8.
3. Encode each UTF-8 byte as exactly two lowercase hexadecimal digits.
4. Reject uppercase hex, odd-length hex, invalid UTF-8, a decoded value that is
   not NFC, or any decode-and-re-encode mismatch.
5. Require exact canonical round-trip equivalence to the normalized logical
   name and physical byte spelling.

In the grammar below, `<hex>` means that non-empty canonical lowercase-hex byte
string. Decoding is not permissive normalization: a noncanonical physical name
fails closed and is never rewritten into canonical form.

## 33. Exact typed physical grammar

All prefixes, hex digits, extensions, and internal names are exact lowercase
ASCII.

### Internal state names

- Node or root state is exactly `_state.ms`.
- Collection state, only if collections are separately approved, is exactly
  `_colstate.mc`.

These names are reserved internal evidence and cannot represent logical user
keys.

### Physical node slots

A future physical node directory is:

```text
n_<slot>
```

`<slot>` is canonical ASCII decimal: either `0`, or a nonzero decimal with no
leading zero. Its exact lexical form is:

```text
^n_(0|[1-9][0-9]*)$
```

This decision selects only lexical form. Slot allocation, reuse, numeric and
resource bounds, deletion, compaction, and ordering remain deferred. A slot
name is placement only and never determines `_id`.

### Persisted logical keys

For one normalized logical key and its canonical `<hex>`:

- a data value is `k_<hex>.md`;
- a named node link is `k_<hex>.ml`; and
- a stored function, only if separately approved, is `k_<hex>.mf`.

The `.mf` classification name is reserved. Its presence in this grammar does
not approve persisted executable code.

### Collections

A collection directory, only if collections are separately approved, is:

```text
c_<hex>
```

This reserves an unambiguous classification namespace. It does not approve
collections, callbacks, bindings, collection identity, or collection
persistence.

## 34. Namespace, canonicalization, and collision rules

- One normalized logical key maps to exactly one canonical `<hex>`.
- Within one node's logical namespace, the same decoded logical key cannot
  exist simultaneously as data, a node link, a function, or a collection.
- Duplicate decoded names reject the complete candidate tree.
- Physical case variants reject rather than normalize.
- Noncanonical physical encodings reject rather than rewrite.
- Unknown files or directories reject unless a later persisted-format version
  explicitly admits them.
- The `n_`, `k_`, `c_`, and reserved `_` namespaces are disjoint.
- Logical case remains significant because distinct normalized UTF-8 bytes
  produce distinct lowercase-hex names.
- Canonical physical filenames contain no raw logical separators, dot segments,
  Windows reserved basenames, trailing dots or spaces, or caller-controlled
  path syntax.
- Direct legacy spellings such as `descendant.ml` are not canonical
  version-1 physical names.

A valid type suffix does not excuse a decoded-name collision. A later preflight
must build the complete normalized logical namespace before accepting the
node. It must fail closed rather than choose one conflicting type or one
filesystem spelling.

## 35. Compatibility consequences

- Current runtime continues to use direct caller names, bare numeric child
  directories, raw collection directories, and direct `.md`, `.ml`, and `.mf`
  filename stems.
- The existing fixture directories named `0` and links named
  `descendant.ml` remain immutable evidence of earlier decisions. They are not
  canonical version-1 physical names under this decision.
- The `proposed-v1-locless` tree proves locless UUID and link evidence only. It
  is not relabeled as final physical naming.
- PR #21's separate `proposed-v1-encoded-names` tree proves typed lexical
  spelling only. It is not relabeled as canonicalization, containment, link,
  mount, or hard-link evidence.
- Unversioned state remains legacy and unqualified.
- No current database is silently encoded, renamed, normalized, or upgraded.
- Migration requires a separate, byte-complete mapping ledger and explicit
  owner approval.

This is a persisted-layout incompatibility with current runtime output.
Package SemVer, package-version consequences, release policy, and migration
remain unresolved. Documentation of the grammar does not create or qualify
version 1.

## 36. Future preflight lexical order

A later read-only implementation must apply this dependency order:

1. Validate the root-input lexical class without writing.
2. Select open-existing or create-new mode and apply the filesystem
   canonicalization and containment policy below.
3. Enumerate raw directory entries.
4. Match exact internal names or the typed physical grammar.
5. Reject unknown, uppercase, malformed, or noncanonical physical names.
6. Decode every `<hex>` using strict UTF-8.
7. Require NFC and exact decode-and-encode round trip.
8. Build each node's normalized logical namespace.
9. Reject duplicate decoded names and cross-type collisions.
10. Validate state, key, and reference relationships.
11. Continue identity and whole-tree validation.
12. Reconstruct runtime objects only after complete acceptance.

Preflight performs no rename, case normalization, encoding repair, constructor
call, proxy write, or persisted mutation. The typed grammar does not authorize
runtime traversal before the selected containment and filesystem-object policy
is implemented and its platform evidence is demonstrated.

## 37. Security effects and nonclaims

Canonical typed encoding removes direct caller-controlled path syntax from
future internal filenames and gives exact lexical categories. The filesystem
contract below additionally selects containment and fail-closed physical
object rules. Those documentation decisions do not by themselves solve:

- reliable cross-platform reparse, device, object-identity, and link-count
  evidence;
- handle-relative or otherwise race-resistant traversal;
- time-of-check/time-of-use races;
- filesystem permissions;
- locking or concurrent writers;
- atomicity, recovery, or durability;
- Unicode display spoofing;
- resource exhaustion; or
- complete version-1 qualification.

This record does not claim cross-platform portability or security
qualification. Logical case sensitivity plus lowercase physical encoding
avoids relying on physical filename case distinctions for logical case, but the
filesystem implementation must still demonstrate the selected containment and
alias policy and later close races.

## 38. Encoded-name characterization disposition

PR #21 completed the previously identified encoded-name characterization
slice. It preserves the earlier 16 preimages, adds exact `n_0` and
`k_64657363656e64616e74.ml` spellings around byte-identical locless state and
UUID-link evidence, and characterizes the specified lexical mutation matrix
entirely in test-only code.

That result closes mechanical name separability only. It does not establish
root canonicalization, containment, filesystem object identity, runtime
support, migration, portability, or security qualification.

## 39. Current filesystem and constructor source audit

The filesystem audit for the containment decision inspected complete
`index.js`, this policy, the complete README, legacy `test.js`, both manifests,
every automated test and worker, and all 19 persisted-preimage files. It traced
every production `fs.existsSync`, `fs.mkdirSync`, `fs.readdirSync`,
`fs.readFileSync`, and `fs.writeFileSync` call and every production path
operation. No database or temporary observation was created because the
following behavior is visible directly in source and existing tests.

The following are **source facts** about current unversioned runtime behavior:

- `Lizzo(loc)` constructs `DB(loc)`. `DB._scanLocation()` calls
  `fs.existsSync(loc)`. When the supplied target is absent it calls
  `fs.mkdirSync(loc)` without recursive creation and immediately saves root
  state. When the target exists, the constructor adopts it without requiring
  an ordinary directory, canonical root state, or an empty/non-empty
  distinction.
- Opening and creation are therefore conflated. An absent target can become a
  database as a constructor side effect; an existing target is treated as the
  opening location. There is no explicit semantic mode.
- Current new-root creation neither creates intermediate directories nor
  specifies recursive creation. A filesystem collision or creation error
  propagates. Source contains no post-creation validation, rollback, removal,
  rename, or cleanup path.
- Root and child state, node data, node links, stored functions, collection
  state, and collection item links use synchronous direct reads and writes.
  `_loadFromDir()` uses `fs.readdirSync()` and raw string concatenation for
  descendant candidates.
- Production source does not call `lstat`, `stat`, `realpath`, `opendir`, or a
  directory-handle API. It contains no `isSymbolicLink()` check and reads no
  `dev`, `ino`, or `nlink` metadata.
- The only production `path.resolve()` call compares an enumerated candidate
  child location with locations of children already reconstructed through
  constructors. It does not canonicalize the database root or establish
  containment. Production source has no `path.relative()` or
  separator-aware containment check.
- Current constructors for root, node, and collection objects may create
  missing locations. `_loadFromDir()` classifies and constructs entries before
  complete-tree validation, so current reconstruction is not a read-only
  preflight.

Before the platform-capability characterization, existing automated tests
created uniquely named OS-temporary directories and cleaned up their own paths
while characterizing current construction, reopen, failure propagation, and
persisted preimages. They did not prove non-following metadata, native
canonicalization, link-like evidence, generic Windows reparse detection,
device continuity, hard-link count, filesystem object identity, or
separator-aware containment.

The later merged `test/filesystem-capabilities.test.cjs` is test-only
characterization. Each suite execution creates exactly one task-owned
OS-temporary tree, uses non-following metadata and native `realpath`, exercises
creation collision, containment, ordering, hard-link, and Windows junction
evidence, and proves bounded exact-tree cleanup. On the characterized host its
receipt confirmed those categories but retained `capability-gap` for generic
arbitrary Windows reparse detection and retained overall qualification
`no-go`. It neither imports production Moxley nor implements traversal.

Legacy `test.js` uses the current relative `./db/` constructor path and was
inspected but not executed because doing so would create repository-local
state.

The following is an **inference** from those source facts: current
`existsSync()` and direct path use cannot establish the filesystem identity and
containment guarantees selected below. That inference is not a claim that a
particular host path currently contains a link, reparse point, mount, or hard
link.

## 40. Selected separate filesystem modes

David Giles selects two distinct future internal semantic modes. This record
does not select their eventual public method names or exported shapes.

### Open existing

Future open-existing behavior requires:

- the root already exists;
- the root is an ordinary directory;
- the root is not a symbolic link, junction, device namespace, or detectable
  reparse point;
- native filesystem resolution can establish one canonical absolute root;
- no file or directory is created when the requested root is absent;
- an absent root is an error;
- an empty directory without a valid marked version-1 root state is not
  initialized; and
- opening never falls back to creation.

The opening operation adopts no bytes until the root and root-state boundaries
below pass. Existing files do not gain authority merely because the caller
selected open-existing mode.

### Create new

Future create-new behavior requires:

- the target root does not exist;
- its immediate parent already exists;
- that parent is an ordinary directory and satisfies the selected
  non-link/non-junction/detectable-reparse requirements;
- intermediate directories are not created;
- only the final root directory is created, using one non-recursive directory
  operation;
- any existing target, including an empty directory, is a collision;
- a collision between the absence check and creation fails rather than
  adopting the winner's object;
- the new root is inspected and canonicalized after creation;
- the canonical new root is the immediate child of the canonical parent; and
- creation never opens, initializes, or adopts pre-existing bytes.

This slice does not select whether or how the one newly created directory may
be rolled back after a later post-creation failure. Cleanup authority,
recoverability, original-cause preservation, and final error behavior must be
selected before implementation. No recursive deletion is implied.

## 41. Selected root canonicalization sequence

The future root boundary applies this order:

1. Validate the selected primitive-string, absolute-native-local lexical
   contract.
2. Require the caller-selected semantic mode: open-existing or create-new.
3. In open-existing mode, inspect the existing root using non-following
   metadata. In create-new mode, confirm target absence and inspect the
   already-existing immediate parent using non-following metadata.
4. Reject an unsupported object type, symbolic link, junction, device
   namespace, or detectable reparse condition.
5. Use native filesystem `realpath` behavior on the existing root, or on the
   existing parent before new-root creation.
6. Establish one canonical absolute process-local root, or one canonical
   absolute parent for creation.
7. In create-new mode, perform only the final non-recursive directory
   creation, then inspect and canonicalize the created directory.
8. Require the canonical created root to be the immediate child of the
   canonical parent.
9. Never serialize the canonical root and never derive database or node
   identity from it.

Lexical normalization is not filesystem identity. String equality is not
filesystem-object identity. String-prefix containment is prohibited.
Drive-letter spelling, platform-returned case, and absolute-root presentation
do not define a database or node identity.

The prior lexical contract deliberately did not select exact normalization of
separators, explicit `.` or `..` segments, trailing separators, drive-letter
presentation, or platform-returned case. Those remain explicit implementation
prerequisites. An implementation must resolve them consistently with the
selected native canonicalization sequence and fail closed until it can do so;
this record does not invent their normalization.

Current constructors do not implement any step in this sequence beyond calling
filesystem APIs with the supplied path and creating an absent target.

## 42. Selected per-entry traversal and containment sequence

For each direct child of an already accepted physical directory, a future
read-only preflight must:

1. Obtain the raw directory entry without constructing a runtime database,
   node, collection, template, or proxy.
2. Validate the raw entry against the exact selected version-1 physical-name
   grammar before joining it to any path.
3. Join exactly that one validated entry segment to the already-contained
   physical parent location.
4. Inspect the resulting entry with non-following metadata.
5. Reject a symbolic link, junction, detectable reparse point, unsupported
   object type, or a file/directory type that disagrees with the typed name.
6. Resolve the entry's native real path only after those non-following checks.
7. Compute the resolved entry's relationship to the canonical database root
   using separator-aware relative-path semantics.
8. Require a strict descendant: the relative result is non-empty, is not
   absolute, and does not begin with a complete `..` path segment.
9. Require the entry's filesystem device or volume identity to match the
   selected root baseline.
10. Apply the regular-file link-count and physical-object identity rules below.
11. Record the canonical physical object identity before any descent.
12. Recurse only after every entry-level check succeeds.

Simple string-prefix comparison is never containment. Preflight must not
follow a link first and then decide whether the resolved target appears to be
inside the root. Persisted state supplies no path and cannot redirect any of
these steps.

This strict-descendant rule applies to every entry, including exact
`_state.ms`. The canonical database root itself is the only accepted object
that is not strictly beneath itself.

## 43. Accepted filesystem object types

The initial hardened filesystem contract admits only:

- ordinary directories where the exact typed grammar requires a directory;
  and
- ordinary regular files where the exact typed grammar requires a file.

The root must be an ordinary directory. The contract rejects symbolic links,
junctions, detectable reparse-point-backed objects, sockets, FIFOs or pipes,
block devices, character devices, and every other special, unsupported, or
unknown object type.

The fail-closed reparse rule intentionally means that a OneDrive placeholder
or another provider-backed database object represented through a detectable
reparse point may be rejected by an initial hardened implementation. This
record does not assert that every OneDrive-managed path is a reparse point, and
it does not touch or characterize any existing OneDrive object.

## 44. Selected link, mount, and physical-object policy

The future initial hardened contract selects:

- no symbolic links anywhere in the candidate database tree;
- no junctions anywhere in the candidate database tree;
- no detectable reparse points anywhere in the candidate database tree;
- no descendant device or volume crossing after the canonical root establishes
  the allowed device or volume baseline;
- exactly one filesystem link for every admitted regular file;
- rejection of multiply linked regular files;
- a traversal-wide set of canonical filesystem object identities; and
- rejection when a `(device, object-or-inode)` identity repeats, whether the
  repetition would represent a directory cycle or another physical alias.

The implementation must establish equivalent reliable identity fields where a
platform does not use POSIX device and inode terminology. It must not
substitute a path string for object identity.

Ordinary Node `lstat` behavior is not documented here as sufficient to detect
every Windows reparse-point category. Generic reparse detection and reliable
device/volume, object/inode, and link-count evidence are platform-capability
gates. If the target platform cannot prove the required object type, identity,
link count, device/volume, or reparse status, the hardened operation stops as
unsupported. It must not silently weaken this contract.

## 45. Deterministic traversal and peer-failure precedence

The future preflight processes peers in deterministic
canonical-relative-path order:

- accepted physical names are canonical lowercase ASCII and sort bytewise;
- a descendant comparison key is the sequence of its accepted physical path
  components from the root, not the host's enumeration order;
- invalid raw names reject without case conversion, normalization, rename, or
  decoding repair;
- invalid peer names use stable raw-name byte ordering when the platform can
  expose those bytes; and
- when stable raw-name byte ordering cannot be established, no cross-process
  deterministic precedence claim is made for those invalid peers.

Within that peer order, the semantic category order in section 13 controls.
This contract does not change current ordinary load order and does not define a
public error class, numeric code, message, or complete wire shape.

## 46. Root-state physical read boundary

After establishing the canonical root, future open-existing preflight must:

1. locate exact `_state.ms` as a direct root entry;
2. validate its reserved exact physical name;
3. inspect it with non-following metadata;
4. require an ordinary, single-link regular file;
5. require its resolved object to be strictly contained beneath the canonical
   root and on the root device or volume;
6. record and de-duplicate its physical object identity;
7. read and parse its framing and logical value; and
8. validate the exact root marker before recursively accepting the remainder
   of the candidate tree.

Marker validation never bypasses physical checks on `_state.ms`. An
unversioned, malformed, unknown-format, or unsupported-version root can fail
before the rest of the tree is traversed. No constructor, proxy operation,
write, evaluation, normalization, repair, or migration occurs at this
boundary.

For create-new mode, the first persisted root write remains a future writer
decision. This record does not select an atomic create/write protocol and does
not claim that merely creating the directory establishes a valid database.

## 47. TOCTOU, platform capability, and security nonclaims

The selected path and metadata checks describe a bounded observation, not a
stable filesystem transaction:

- an object can change between inspection, canonicalization, read, and later
  use;
- `realpath`, non-following metadata, device/inode-like identity, and link
  count do not themselves lock an object;
- no concurrent-writer safety is claimed;
- no handle-relative or race-free traversal is claimed;
- no atomic open/create or commit protocol is selected;
- no crash recovery, journaling, or durability behavior is selected; and
- filesystem permissions and external mutation remain outside this bounded
  evidence.

Omitting persisted `_loc`, canonical typed names, native canonicalization,
strict containment, and fail-closed physical-object checks reduce selected
authority and alias risks. They do not close time-of-check/time-of-use races.
Production implementation remains blocked until required platform evidence is
demonstrated and the later locking and concurrency contract is selected.

No complete cross-platform portability, filesystem security qualification, or
version-1 support claim follows from this documentation.

## 48. Compatibility disposition, remaining deferrals, and no-go

The selected filesystem policy is incompatible with current constructor and
path behavior:

- current code conflates absent-root creation with existing-root use;
- current code does not canonicalize the root or inspect entries without
  following;
- current code does not enforce typed object categories, strict containment,
  device continuity, single-link files, or unique physical objects;
- every existing persisted fixture remains characterization evidence only;
- provider-backed or OneDrive content represented as detectable reparse
  objects may be rejected by a future hardened implementation;
- no existing database is rewritten, adopted, repaired, or migrated; and
- no best-effort traversal or compatibility fallback is authorized.

The exact public open/create API names and shapes, rollback after failed
new-root post-checks, stable error API, general numeric resource limits,
native-addon implementation and loading, compiler and build configuration,
handle-relative traversal, locking, concurrent writers, atomicity,
journaling, recovery, durability, collection and binding qualification,
executable-content policy, migration, repair, runtime implementation, package
version, release, npm publication, adapter, and Thoth behavior remain
deferred.

The truthful disposition remains a **no-go for complete version-1
qualification**. The filesystem policy and a bounded set of test-only host
observations now exist, but generic Windows reparse classification is not
implemented or build-characterized. Executable content, collection/binding
scope, complete `_keys` correspondence, and the complete accepted state/data
schema also remain unresolved.

## 49. Completed platform-capability characterization

The Windows reparse decision input baseline includes the merged test-only
platform-capability characterization. It added no production source,
persisted fixture, dependency, lockfile, or documentation-policy behavior.

The seven non-concurrent tests use one task-owned directory created by
`mkdtemp()` under `os.tmpdir()` per suite execution. On the decision host,
Windows Node `lstat`, native `realpath`, non-recursive creation collision,
separator-aware containment, deterministic canonical ASCII and raw-byte
ordering, stable device/object/link-count fields, a task-owned hard link, and
a task-owned directory junction all produced confirmed characterization
evidence. The exact owned tree was revalidated before bounded cleanup and its
absence was confirmed with `ENOENT`.

The in-memory receipt recorded:

- platform `win32`;
- Node `v24.13.0`;
- every characterized category above as `confirmed`;
- generic arbitrary Windows reparse detection as `capability-gap`;
- cleanup as `confirmed`; and
- overall qualification as `no-go`.

`lstat().isSymbolicLink()` on the task-owned junction and `realpath()` target
resolution are useful observed evidence. They are not a generic query for
every Windows reparse category and are not accepted as a substitute for the
native classification selected below.

## 50. Windows authority audit and evidence labels

The reparse-boundary audit inspected complete `STATE_COMPATIBILITY.md`,
`index.js`, both manifests and the lockfile, README, legacy `test.js`, the
Apache-2.0 license and repository licensing records, every automated test and
worker, all 19 persisted fixtures, the merged history from PR #12 through PR
#23, and the relevant PR descriptions. No persisted executable content was
run and no database or additional filesystem probe tree was created.

This section uses four explicit evidence labels:

- **Observed fact** means live repository, source, test receipt, or read-only
  host evidence.
- **Documented API fact** means a statement supported by the primary Microsoft
  or Node.js documentation recorded below.
- **Selected policy** means David Giles's future Moxley decision; it is not
  current runtime behavior.
- **Deferred decision** means no implementation or compatibility authority has
  been selected yet.

The following are **observed facts**:

- current `index.js` uses JavaScript `fs.existsSync`, `mkdirSync`,
  `readdirSync`, `readFileSync`, and `writeFileSync`; it has no native addon,
  Windows handle query, generic reparse classification, or production
  preflight;
- `package.json` has no addon, native wrapper, build helper, `engines` field, or
  dependency beyond `flatted`;
- the repository and future original Moxley work are Apache-2.0 licensed under
  the ownership record in `LICENSING.md`;
- the decision host reports `win32`, `x64`, Node `v24.13.0`, Windows 11 Home
  version 25H2 build `26200.8875`, and a fixed local NTFS volume for both the
  repository and task-temporary characterization;
- `Get-ComputerInfo` identifies the host as Windows 11 Home while the legacy
  `CurrentVersion.ProductName` registry field reports Windows 10 Home; the
  build and Microsoft release record, not that stale label, support the
  Windows 11 observation; and
- the merged capability receipt does not prove generic arbitrary reparse
  classification.

The following is an **inference**: a JavaScript-only combination of the
currently characterized `lstat().isSymbolicLink()` and `realpath()` evidence
cannot satisfy the selected requirement to classify every accepted object's
generic Windows reparse attribute. That inference selects no implementation by
itself; the owner selection below supplies the authority.

## 51. Primary source record and documented API facts

The following primary sources were retrieved on 2026-07-30:

- Microsoft [`CreateFileW`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew);
- Microsoft
  [`GetFileInformationByHandleEx`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex);
- Microsoft
  [`FILE_ATTRIBUTE_TAG_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_attribute_tag_info);
- Microsoft
  [reparse-point operations](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-operations);
- Microsoft
  [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information);
  and
- Node.js [Node-API](https://nodejs.org/api/n-api.html).

Those sources establish these **documented API facts**:

- `CreateFileW` permits `dwDesiredAccess` zero for metadata queries, supports
  read/write/delete sharing, opens an existing object with `OPEN_EXISTING`,
  uses `FILE_FLAG_OPEN_REPARSE_POINT` to avoid normal reparse processing, and
  requires `FILE_FLAG_BACKUP_SEMANTICS` to obtain a directory handle;
- a null `lpSecurityAttributes` makes the returned handle non-inheritable;
- `GetFileInformationByHandleEx` accepts `FileAttributeTagInfo` and returns
  `FILE_ATTRIBUTE_TAG_INFO`, whose fields are `FileAttributes` and
  `ReparseTag`;
- Microsoft identifies `FILE_ATTRIBUTE_REPARSE_POINT` as the attribute that
  indicates an associated reparse point, while `FSCTL_GET_REPARSE_POINT`
  retrieves the reparse payload;
- Microsoft documents Windows 11 25H2 as OS build 26200, consistent with the
  live build observation; and
- Node-API is stable and ABI-stable across Node versions when an addon confines
  its Node boundary to Node-API. Node's documentation specifically distinguishes
  `node_api.h` from V8, Node internal C++ APIs, and direct libuv APIs, which do
  not share that cross-major ABI guarantee.

Microsoft's historical minimum-client and minimum-server statements describe
API availability. They are not a Moxley support, test, distribution, or
qualification claim.

## 52. Selected Windows reparse-classification mechanism

David Giles selects this future mechanism:

1. Generic Windows reparse classification is performed only by a first-party,
   in-repository Windows Node-API addon.
2. The addon is an internal Moxley implementation component. It is not a
   public package, exported public API, or separately supported interface.
3. Its source will be original Moxley code under the repository's Apache-2.0
   license.
4. Its Node boundary uses stable Node-API through `node_api.h` only. It must
   not use V8, Node internal C++ APIs, `node.h`, `node_object_wrap.h`, or direct
   libuv APIs.
5. Its classification operation uses only Windows system APIs.
6. It must not invoke PowerShell, .NET subprocesses, WMI, `fsutil`, shell
   commands, external executables, or network services.
7. Node `lstat().isSymbolicLink()` and `realpath()` remain characterization
   evidence but are not generic Windows reparse-classification authority.
8. There is no permissive, JavaScript-only, or best-effort fallback. Addon
   absence, load failure, unsupported status, or incomplete native evidence
   fails closed.

This **selected policy** closes only the mechanism-selection gap. This
documentation does not add, build, load, or call an addon.

## 53. Exact selected native operation

For each already-existing filesystem object that a future hardened traversal
would otherwise consider accepting, the internal addon must perform this
operation:

1. Call `CreateFileW` for the exact object with:
   - `dwDesiredAccess = 0` for metadata-only access;
   - `dwShareMode = FILE_SHARE_READ | FILE_SHARE_WRITE |
     FILE_SHARE_DELETE`;
   - `lpSecurityAttributes = NULL`, producing a non-inheritable handle;
   - `dwCreationDisposition = OPEN_EXISTING`;
   - `dwFlagsAndAttributes = FILE_FLAG_OPEN_REPARSE_POINT |
     FILE_FLAG_BACKUP_SEMANTICS`; and
   - `hTemplateFile = NULL`.
2. Treat `INVALID_HANDLE_VALUE` as classification failure and retain the
   original `GetLastError()` value as internal causal evidence.
3. Call `GetFileInformationByHandleEx` with
   `FileAttributeTagInfo`, a correctly sized `FILE_ATTRIBUTE_TAG_INFO`
   destination, and the handle returned above.
4. Treat a false return as classification failure and retain the original
   `GetLastError()` value as internal causal evidence.
5. Inspect both `FILE_ATTRIBUTE_TAG_INFO.FileAttributes` and
   `FILE_ATTRIBUTE_TAG_INFO.ReparseTag`.
6. Reject the object whenever `FILE_ATTRIBUTE_REPARSE_POINT` is present,
   regardless of the tag value or whether the tag is recognized.
7. Fail closed on incomplete, contradictory, or malformed attribute/tag
   evidence rather than normalizing it.
8. Close the handle on every success and failure path after handle acquisition.

`FSCTL_GET_REPARSE_POINT` is not required for the acceptance decision. A later
slice may consider it for bounded internal diagnostics, but inability to
retrieve optional reparse payload data must never convert a reparse object
into an accepted object.

This classification result is evidence about the object represented by the
open handle during that bounded operation. It does not authorize path
traversal, file reads, writes, creation, deletion, normalization, or
reconstruction.

## 54. Fail-closed result and error boundary

Future classification rejects or stops as unsupported for:

- handle-open failure;
- unsupported or failed `FileAttributeTagInfo` query;
- incomplete, contradictory, truncated, or malformed native evidence;
- helper absence, load failure, initialization failure, or incompatible
  binary;
- unsupported platform, architecture, Node version, OS/build, or filesystem;
- any detected `FILE_ATTRIBUTE_REPARSE_POINT`, regardless of `ReparseTag`;
- inability to close or account for a successfully acquired handle; or
- any attempt to substitute path-only JavaScript evidence for the selected
  native result.

The implementation must preserve the original Windows error code internally
as causal evidence before cleanup can overwrite thread-local last-error state.
This slice does not select a caller-visible JavaScript error class, error code,
message, public method, or wire shape.

An absent `FILE_ATTRIBUTE_REPARSE_POINT` bit is necessary for acceptance on
the selected target, not sufficient for whole-object or whole-database
acceptance. Object type, containment, device identity, link count, unique
physical identity, persisted evidence, and every later gate still apply.

## 55. Initial platform and source-distribution boundary

The initial future qualification target is deliberately narrow:

- platform: `win32`;
- architecture: `x64`;
- Node line: `>=24.13.0 <25`;
- OS: Windows 11 x64; and
- filesystem: fixed local NTFS.

This is not current runtime support and does not change `package.json`
`engines`, package version, dependency metadata, or release policy. The live
characterization is specifically Windows 11 Home 25H2 build `26200.8875`,
x64, Node `v24.13.0`, on fixed local NTFS. It does not by itself qualify every
Windows 11 edition, build, storage provider, or NTFS deployment.

Until separately characterized and authorized, the target excludes:

- Windows 10;
- Windows Server;
- Windows on ARM64;
- 32-bit Windows;
- Wine and compatibility layers;
- network shares and remote filesystems;
- non-NTFS and provider-specific filesystems;
- other Node major versions; and
- other architectures.

Node-API's ABI-stability guarantee supports the selected implementation
boundary. It does not qualify untested Node versions, Windows versions or
builds, architectures, compiler/SDK combinations, filesystems, addon loading,
or Moxley behavior.

The first implementation slice is selected as source-only ownership:

- no checked-in native binaries;
- no downloaded prebuilds;
- no install-time network downloader;
- no third-party native wrapper; and
- no release artifact or npm publication in this contract sprint.

The exact compiler, MSVC and Windows SDK floor, build-system files, CI matrix,
binary-signing policy, prebuilt-binary policy, and npm packaging behavior are
**deferred decisions** for a separately authorized build-and-release contract.

## 56. Limitations, nonclaims, and continuing no-go

This mechanism decision does not implement or qualify:

- native addon compilation or loading;
- production preflight or traversal;
- handle-relative traversal or intermediate-component race resistance;
- TOCTOU protection;
- safe create-new sequencing or rollback;
- locking, concurrent readers, or concurrent writers;
- atomic writes or commits;
- journaling, recovery, crash behavior, durability, or acknowledgement;
- migration, repair, or detector enforcement;
- complete persisted-format qualification;
- package release or npm state; or
- adapter or Thoth behavior.

A successful handle-based classification does not prove that a path still
identifies the same object after the handle closes or when later path-based
work occurs. It also does not prove that intermediate components were stable.
Complete hardened Windows version-1 qualification therefore remains a
**no-go**.

Current runtime behavior is unchanged: it loads no addon, enforces none of
these rules, and must not be described as Windows reparse-safe or version-1
qualified.

## 57. Next independently testable slice

The next dependency-ordered slice is characterization/build-preflight only. It
must remain isolated from Moxley production traversal and must not change
runtime acceptance.

On the exact approved Windows 11 x64, Node `>=24.13.0 <25`, fixed-local-NTFS
target, that slice should:

- add the smallest original, task-owned Node-API source necessary to expose
  the selected classification result without creating a public API;
- select and record the exact compiler, MSVC, Windows SDK, and build-tool
  preflight needed for that isolated build;
- compile and load the addon locally without checked-in binaries, downloaded
  prebuilds, install-time networking, or third-party native wrappers;
- classify task-owned ordinary files and directories;
- classify a task-owned junction and, where permissions permit, a task-owned
  symbolic link;
- characterize any other safely constructible task-owned reparse evidence;
- assert fail-closed behavior for addon load/query failure and malformed
  result evidence;
- preserve Windows causal error codes internally;
- remove only exact task-owned build and filesystem paths; and
- end with an explicit qualification no-go.

That slice must not wire the addon into constructors, loaders, preflight,
traversal, creation, migration, package publication, or ordinary runtime
behavior.

## 58. Native build and internal-loader authority and evidence labels

**Currently implemented characterization:** PR #25 completed the test-only
slice described in section 57 and was squash-merged as
`33822da91018be3ec8e2e8c76d4cf03036861473`. The authoritative merge adds the
disposable source `test/native/windows-reparse-classifier.c`, its same-file
worker and test harness, and the test-script entry that runs the harness. It
does not add production native or JavaScript source.

**Currently implemented characterization:** The authority audit for this
contract inspected complete `STATE_COMPATIBILITY.md`, complete `index.js`, both
manifests, `.gitignore`, `.gitattributes`, the merged native C source and test
harness, every current test and worker relevant to filesystem behavior, all 19
persisted fixtures, the Apache-2.0 license and ownership/notice records, the
merged PRs and first-parent history from #12 through #25, and the complete
tracked package layout. The merged baseline has 50 passing tests, 11 tracked
JavaScript/CJS/MJS files, one test-only C file, 19 persisted fixtures, three
Markdown files, and two JSON manifests.

**Currently implemented characterization:** `index.js` remains the only
production entry point. `test/native/windows-reparse-classifier.c` remains
test-only. There is no production native source, internal loader, build or
clean driver, `binding.gyp`, native dependency, package export, lifecycle
build, or generated output. `build/Release` is already ignored. Package
installation does not build a native addon. `npm test` builds only disposable
test variants in a task-owned OS-temporary directory and removes them.

The following labels govern every item in this contract:

- **Selected future contract** is an owner-selected requirement for a later,
  separately authorized implementation. It is not current behavior.
- **Currently implemented characterization** is evidence present at the input
  baseline. It is not production qualification.
- **Deferred implementation** identifies work that this documentation-only
  slice does not perform.
- **Explicit nonclaim** states a guarantee, threat model, runtime behavior, or
  distribution decision that this contract does not establish.

**Explicit nonclaim:** Nothing in sections 58 through 72 changes current
runtime behavior, authorizes production traversal, creates a build artifact,
or qualifies complete Windows version-1 support. The continuing disposition is
**no-go**.

## 59. Ownership and exact future paths

**Selected future contract:** The one authoritative production C source is:

```text
native/windows-reparse-classifier.c
```

The later implementation must promote and adapt the characterized test source
into that single production source. Production and test copies must not remain
independently maintained. After promotion, native characterization tests must
compile the production source, and the old test-only C source must be removed
in the same separately authorized implementation. The production source
remains original Moxley code under Apache-2.0.

**Selected future contract:** The exact future internal paths are:

- production native source:
  `native/windows-reparse-classifier.c`;
- explicit build driver: `scripts/build-windows-native.cjs`;
- explicit clean driver: `scripts/clean-windows-native.cjs`;
- private internal loader:
  `lib/internal/windows-reparse-classifier.cjs`;
- generated binary:
  `build/Release/moxley-windows-reparse.node`;
- generated receipt:
  `build/Release/moxley-windows-reparse.receipt.json`; and
- generated exclusive build lock:
  `build/Release/.moxley-windows-reparse-build.lock`.

**Deferred implementation:** None of those future paths is created by this
contract. Source promotion, removal of the old test source, and every build,
clean, loader, or test change require separate authorization.

**Explicit nonclaim:** Listing a path does not make it a package export,
public API, installed artifact, published file, or currently supported runtime
component.

## 60. Dependency direction and visibility

**Selected future contract:** The only permitted dependency direction is:

```text
future hardened traversal
  -> lib/internal/windows-reparse-classifier.cjs
    -> build/Release/moxley-windows-reparse.node
      -> Windows system APIs
```

No reverse dependency is permitted. The first build/loader implementation
slice must not import the loader from `index.js` and must not expose it. Only a
later separately authorized hardened traversal component may depend on the
internal loader. The loader may depend on the exact generated addon. The addon
must not depend on Moxley JavaScript state, persisted formats, Thoth,
Yggdrasil, or an adapter.

**Selected future contract:** The loader and addon remain private
implementation details. No package export, documented public method,
caller-accessible native API, or direct import by another package or repository
is approved.

**Deferred implementation:** Traversal integration and any mapping from native
classification to traversal behavior remain later slices.

**Explicit nonclaim:** This dependency diagram does not claim that a hardened
traversal, internal loader, generated addon, adapter, or Thoth consumer exists.

## 61. Explicit build and clean commands

**Selected future contract:** The future package scripts are exactly:

```text
npm run build:native:windows
npm run clean:native:windows
```

They are explicit operator commands. Native building is prohibited from
`install`, `preinstall`, `postinstall`, `prepare`, `prepublish`, `npm test`,
ordinary `require("moxley-db")`, and loader invocation. No runtime or package
command may download headers, compilers, SDKs, prebuilds, or binaries.

**Currently implemented characterization:** `package.json` has only the `test`
script, has no lifecycle script, and has no production native build command.
There is no `binding.gyp`, so package installation has no implicit repository
addon build input.

**Deferred implementation:** The two manifest scripts and their driver files
are not added in this documentation-only slice.

**Explicit nonclaim:** The selected command names do not authorize install-time
building, automatic repair, loader-triggered compilation, or any network
access.

## 62. Build mechanism and exact initial target

**Selected future contract:** The build uses direct source-only MSVC
compilation, consistent with the accepted PR #25 characterization. The future
build driver must:

- support only `win32` / `x64`;
- require the approved exact Node and Node-API boundary;
- locate a complete, launchable, signed MSVC x64 toolchain;
- locate the selected Windows SDK;
- locate exact local Node headers and the matching AMD64 `node.lib`;
- authenticate required files and versions before compilation;
- use no `node-gyp`, Python, CMake, `node-addon-api`, V8, Node internal C++ API,
  or direct libuv;
- perform no networking;
- compile with warnings as errors and the characterized compiler and linker
  hardening flags;
- build all intermediate output in one exact task-owned staging directory;
- never write intermediate output outside that staging directory;
- load and probe the staged addon in a bounded child process before promotion;
  and
- apply the phase-specific cleanup authority in section 63: a handled failure
  before the first final promotion may remove only the exact authenticated
  staging directory and exact owned lock, while a failure at or after the first
  final promotion preserves final-output and lock evidence.

**Selected future contract:** The initial exact qualified build target is
Windows 11 Home 25H2 build `26200.8875`, `win32` / `x64`, fixed local NTFS,
Node `v24.13.0`, modules ABI 137, Node runtime Node-API 10, and the stable
Node-API version 8 addon surface. The accepted toolchain evidence is Visual
Studio Build Tools `17.14.37516.0`, MSVC tools `14.44.35207`, `cl.exe`
`19.44.35228.0`, `link.exe` `14.44.35228.0`, and Windows SDK
`10.0.26100.0`. The accepted AMD64 `node.lib` is 2,869,366 bytes with SHA-256
`be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd`.
The accepted x64 `Kernel32.Lib` is 311,908 bytes with SHA-256
`341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb`.

**Selected future contract:** The broader Node range `>=24.13.0 <25` remains an
eligibility boundary only. It is not automatic qualification. Every exact Node
patch requires an exact build receipt and separate verification before use.

**Currently implemented characterization:** PR #25 directly compiles normal
and injected test-only variants with the exact approved local toolchain, loads
them only in bounded same-file child workers, and removes every task-owned
build and filesystem path. It does not build a production addon.

**Deferred implementation:** Exact discovery mechanics, signing verification,
the final staging-directory spelling, receipt production, promotion logic, and
production build-driver errors remain implementation work constrained by this
contract.

**Explicit nonclaim:** Node-API ABI stability does not qualify another Node
patch, toolchain, SDK, OS build, filesystem, architecture, or generated binary.

## 63. Collision failure, locking, staging, and promotion

**Selected future contract:** Generation is collision-failing. A build must not
overwrite or silently replace an existing final binary, receipt, or lock. If
either final output already exists, the build fails and instructs the operator
to run the explicit clean command first. Concurrent builds are unsupported and
must fail through exclusive creation of the exact lock file. An abandoned lock
is not automatically removed. The explicit clean command is the only approved
recovery for an abandoned task-owned lock, and only after verifying that no
build process is active. No retry loop or automatic recovery is approved.

**Selected future contract:** The build sequence is exactly:

1. Authenticate the platform, filesystem boundary, toolchain, SDK, Node
   inputs, production source, package-relative output paths, and output
   containment.
2. Acquire the exclusive build lock through collision-failing creation.
3. Require both final output paths to be absent.
4. Create and authenticate one exact task-owned staging directory on the same
   fixed local NTFS volume as the final output.
5. Compile and link all intermediate output within staging.
6. Load and characterize the staged addon in a bounded child process.
7. Produce and validate the canonical receipt in staging.
8. Immediately before promotion, require both final output paths still to be
   absent.
9. Promote the binary into its absent final destination using the selected
   collision-failing rename primitive.
10. Promote the receipt into its absent final destination using the selected
    collision-failing rename primitive.
11. While the exclusive lock is still held:
    - reopen the final receipt;
    - require exact canonical bytes, schema, versions, paths, types, and
      framing;
    - reopen the final binary;
    - recompute its byte length and SHA-256;
    - require an exact match to the final receipt;
    - load and probe the final addon in a bounded child process; and
    - require the exact native export and classification contract.
12. Remove the authenticated staging directory.
13. Release the exclusive build lock last.
14. Return build success without performing another acceptance check outside
    the lock.

**Selected future contract:** No cooperating build or clean command may mutate
generated state while step 11 executes. The lock is released only after final
acceptance and staging cleanup succeed. There is no post-unlock acceptance
step. Build success is not reported before successful lock release. A
lock-release failure means the command fails and reports the retained exact
lock; it does not report successful completion.

**Selected future contract:** Each promotion rename is individually atomic on
the supported fixed local NTFS boundary and must fail rather than replace an
existing destination. The binary/receipt pair is not transactionally atomic. A
crash between promotions leaves an incomplete pair, which the loader must
reject.

**Selected future contract — before the first final promotion:** For a handled
failure after acquiring the lock but before step 9, the build removes only the
exact authenticated staging directory if it was created, releases only the
exact owned lock, leaves both final output paths absent, reports failure, and
does not retry. If safe staging cleanup or lock release fails, it reports the
retained exact path and fails without broadening cleanup.

**Selected future contract — at or after the first final promotion:** For a
handled failure at or after step 9, the build does not delete, overwrite,
replace, or roll back either final output; does not report build success;
leaves the lock present as incomplete-build evidence; preserves any incomplete
binary/receipt pair; and stops without retry. A later explicit clean command is
required. Clean may remove the incomplete generated state and abandoned lock
only after independently proving that no build process remains active.

**Selected future contract — crash behavior:** A process crash may leave
staging, the lock, only the final binary, both final outputs without completed
verification, or another incomplete subset of generated state. The loader
rejects every missing, incomplete, invalid, or mismatched final pair. The
explicit clean command is the only selected recovery. No rollback, automatic
repair, stale-lock timeout, PID-reuse inference, retry, or resume is selected.

**Deferred implementation:** The later implementation must select one exact
contained staging path and a collision-failing Windows promotion primitive
that satisfies this sequence. This document neither creates that staging path
nor selects a retry mechanism.

**Explicit nonclaim:** The lock coordinates only the future cooperating build
and clean drivers. It is not a database lock, a hostile-local-user defense, a
transaction, or crash recovery.

## 64. Canonical generated receipt

**Selected future contract:** The generated, ignored, nonauthoritative local
receipt has this exact logical key set and key order:

```json
{
  "receiptFormat": "moxley-native-build-receipt",
  "receiptVersion": 1,
  "nativeContractVersion": 1,
  "target": {
    "platform": "win32",
    "architecture": "x64",
    "nodeVersion": "v24.13.0",
    "nodeApiVersion": 8
  },
  "source": {
    "path": "native/windows-reparse-classifier.c",
    "byteLength": 0,
    "sha256": ""
  },
  "toolchain": {
    "msvcVersion": "",
    "compilerVersion": "",
    "linkerVersion": "",
    "windowsSdkVersion": "",
    "nodeHeadersTreeSha256": "",
    "nodeImportLibraryByteLength": 0,
    "nodeImportLibrarySha256": "",
    "kernel32ImportLibraryByteLength": 0,
    "kernel32ImportLibrarySha256": ""
  },
  "artifact": {
    "path": "build/Release/moxley-windows-reparse.node",
    "byteLength": 0,
    "sha256": ""
  }
}
```

The zero and empty values are type placeholders only. They are not authorized
emitted values. The future builder must populate nonempty exact evidence.

**Selected future contract:** Receipt bytes are strict UTF-8 without BOM, with
one final LF, the exact key set and order above, no duplicate or additional
keys, integers for byte lengths and versions, positive safe-integer byte
lengths for emitted source/import-library/artifact evidence, lowercase
64-character SHA-256 strings, and forward-slash repository-relative paths.
The receipt contains no timestamp, username, absolute path, environment
variable, hostname, secret, or unrelated machine state.

**Selected future contract:** The exact required Node-header set is
`node_api.h`, `node_api_types.h`, `js_native_api.h`,
`js_native_api_types.h`, and `node_version.h`. The headers-tree hash algorithm
is:

1. Include only those exact required headers beneath the selected Node header
   root.
2. Express each path with forward slashes relative to that root.
3. Ordinal-sort the paths.
4. SHA-256 each file.
5. Encode each ledger row as the UTF-8 bytes of
   `PATH_NUL_BYTECOUNT_NUL_SHA256_LF`, where the separators are literal NUL
   bytes, `BYTECOUNT` is canonical unsigned decimal, `SHA256` is lowercase
   hexadecimal, and `LF` is one byte `0x0a`.
6. SHA-256 the complete concatenated ledger bytes.

**Selected future contract:** `receiptVersion` is independent of Moxley
package SemVer and persisted `_formatVersion`. Any receipt-shape change requires
a new `receiptVersion`. `nativeContractVersion` is independently versioned; any
native wire or export-contract change requires a new
`nativeContractVersion`.

**Currently implemented characterization:** PR #25 requires the exact five
local header names and validates the matching Node version and ABI macros. It
separately authenticates the accepted `node.lib` and `Kernel32.Lib` byte
lengths and hashes before disposable compilation. It does not hash the headers
as a canonical tree and does not emit this production receipt.

**Deferred implementation:** Receipt serialization, canonical validation, and
the first populated receipt are deferred to the implementation slice.

**Explicit nonclaim:** The receipt is reproducibility and accidental-mismatch
evidence. It is not signed provenance, a trust anchor, or protection against an
attacker who can replace both the binary and receipt.

## 65. Explicit clean behavior

**Selected future contract:** The clean driver resolves every path from the
Moxley package root, never from the current working directory. It may operate
only on the exact generated binary, receipt, and lock paths from section 59. It
may additionally remove only the exact authenticated staging directory created
by the build driver.

**Selected future contract:** Explicit clean is the only selected recovery for
post-promotion or crash-retained incomplete generated state and an abandoned
lock. It is not invoked automatically by the build. It may remove that state
only after independently proving that no build process remains active.

**Selected future contract:** Before removal, clean must reject a symbolic
link, junction, detectable reparse point, unexpected filesystem type,
containment mismatch, unauthenticated staging directory, or unknown staging
entry. It must never recursively delete `build`, `build/Release`, the
repository, a home directory, or an unresolved path. Unrelated entries outside
the exact generated targets are not deletion authority. If clean cannot prove
that a build process is inactive, it fails. It reports exactly what it removed
and treats already-absent exact outputs as idempotent success.

**Deferred implementation:** The active-build proof, exact staging
authentication record, safe removal primitives, and stable clean-command
output remain implementation details that must preserve these bounds.

**Explicit nonclaim:** Clean removes generated local build state only. It is
not rollback of database state, package installation, runtime behavior, or a
published artifact.

## 66. Private synchronous loader contract

**Selected future contract:** The one future private loader function is:

```js
loadWindowsReparseClassifier()
```

It is synchronous, takes no arguments, and returns one frozen internal object
containing exactly one JavaScript wrapper function:

```js
{
  classify(path)
}
```

The wrapper is named `classify`; it does not expose the cached raw native
function directly. The accepted native `classify(path)` result has exactly this
field order:

```js
{
  outcome,
  fileAttributes,
  reparseTag,
  win32Error,
  closeWin32Error
}
```

**Selected future contract:** The loader must, in order:

1. Resolve all paths from its own package location, never `cwd`, environment
   expansion, or caller input.
2. Enforce `process.platform === "win32"` and
   `process.arch === "x64"`.
3. Read and parse the exact receipt before loading the binary.
4. Validate the receipt's exact schema, versions, target, paths, types, bounds,
   key order, and canonical framing.
5. Require receipt `nodeVersion` to equal the running Node version exactly.
6. Require receipt `nodeApiVersion` 8 and a running Node-API version capable of
   the supported version 8 surface.
7. Recompute the binary byte length and SHA-256.
8. Reject any binary/receipt mismatch.
9. Load only the exact generated binary path.
10. Require the addon export object to contain exactly one function-valued own
    export named `classify`.
11. Cache that native function privately and return a frozen object containing
    exactly the JavaScript wrapper function `classify`.
12. Never build, clean, download, retry, or fall back.

**Selected future contract:** On every wrapper call, the wrapper must:

1. Invoke the cached native `classify` function exactly once.
2. Receive the native result synchronously.
3. Validate the result before returning it.
4. Return a newly frozen accepted result object containing only the five
   validated fields.
5. Never return the original native object.

**Selected future contract:** An accepted result is an ordinary, non-null
object whose prototype is exactly `Object.prototype`, with exactly the five own
enumerable string-keyed data properties shown above in that order. Arrays,
primitives, proxies, additional or missing string keys, symbol keys, inherited
contract fields, accessors, getters, setters, non-enumerable contract fields,
and unexpected prototypes are invalid. Inspection that throws, including any
own-key, prototype, or descriptor operation, is invalid.

The implementation must reject a proxy using the selected Node `util.types`
proxy check, obtain the complete own-key list once, and obtain each property
descriptor once through non-invoking reflection. It reads accepted field values
only from validated data descriptors, never by repeated property access. It
must not spread, stringify, log, mutate, freeze, expose, or retain a malformed
native object.

**Selected future contract:** `outcome` must be a primitive string exactly
equal to `ordinary`, `reparse`, or `capability-gap`. Each of
`fileAttributes`, `reparseTag`, `win32Error`, and `closeWin32Error` must be a
JavaScript number that is finite, is an integer, and is between `0` and
`0xffffffff`, inclusive. Numeric coercion is prohibited.

Consistency validation uses
`FILE_ATTRIBUTE_REPARSE_POINT === 0x00000400`:

- `ordinary` is accepted only when the reparse attribute is absent,
  `reparseTag === 0`, `win32Error === 0`, and `closeWin32Error === 0`;
- `reparse` is accepted only when the reparse attribute is present,
  `win32Error === 0`, and `closeWin32Error === 0`; a nonzero tag is not required
  for every reparse category, and the selected policy rejects the reparse
  attribute regardless of tag; and
- `capability-gap` is accepted only when `win32Error !== 0` or
  `closeWin32Error !== 0`; it is never interpreted as ordinary or reparse
  acceptance.

The current native contradictory-evidence result—reparse attribute absent,
nonzero tag, and `ERROR_INVALID_DATA`—therefore remains a valid
`capability-gap`. Every field, shape, descriptor, or outcome-consistency
mismatch is invalid native-result evidence.

**Selected future contract:** For a valid native result, the wrapper creates a
new JavaScript object, copies only the five validated primitive values in the
exact key order shown above, freezes the new object, and returns it
synchronously. It does not return, freeze, mutate, or expose the native-owned
object. A valid `capability-gap` result is returned as a valid classification
result; mapping it to traversal behavior remains deferred.

**Selected future contract:** Loading is one-shot per process. The first load
success is cached. The first load failure is terminal for that process. No
retry occurs after generated output changes; process restart is required for
another load attempt. This prevents silent mid-process capability substitution.

**Deferred implementation:** The validation policy, accepted shape,
consistency rules, result-invalid code, and poisoned-state behavior are
selected by this contract. The JavaScript code and tests that enforce them,
loader caching, and traversal-specific result mapping remain deferred to
separately authorized implementation.

**Explicit nonclaim:** Receipt verification followed by `require()` does not
eliminate the filesystem race between verification and native loading.

## 67. Internal loader errors

**Selected future contract:** The internal error name is
`MoxleyNativeCapabilityError`. The stable private codes are:

- `MOXLEY_NATIVE_PLATFORM_UNSUPPORTED`;
- `MOXLEY_NATIVE_ARTIFACT_MISSING`;
- `MOXLEY_NATIVE_RECEIPT_INVALID`;
- `MOXLEY_NATIVE_INTEGRITY_MISMATCH`;
- `MOXLEY_NATIVE_LOAD_FAILED`;
- `MOXLEY_NATIVE_EXPORT_INVALID`; and
- `MOXLEY_NATIVE_RESULT_INVALID`.

**Selected future contract:** The loader retains original filesystem, JSON,
hashing, and `require` failures as `cause` where applicable. Stable messages do
not expose absolute build paths. A failure is never converted into JavaScript
`lstat`, `realpath`, a permissive classification, or any other fallback. These
codes are private implementation contracts, not public package API.

**Selected future contract:** `MOXLEY_NATIVE_RESULT_INVALID` is used only when
the successfully loaded native function returns malformed, inconsistent,
throwing, or otherwise invalid result evidence. Its stable message is
`Native classifier returned invalid result evidence.` It contains no absolute
path or raw native value. The error retains only a newly created bounded
internal `TypeError` cause whose message is exactly one of this closed causal
validation-reason vocabulary:

- `RESULT_NOT_OBJECT`;
- `RESULT_KEY_SET_INVALID`;
- `RESULT_DESCRIPTOR_INVALID`;
- `RESULT_FIELD_INVALID`;
- `RESULT_OUTCOME_INCONSISTENT`; or
- `RESULT_INSPECTION_FAILED`.

These reason identifiers are causal diagnostics, not additional public loader
codes. `RESULT_NOT_OBJECT` covers null, a primitive, an array, a proxy, or an
unexpected prototype. `RESULT_KEY_SET_INVALID` covers any own-key count, kind,
order, or identity mismatch. `RESULT_DESCRIPTOR_INVALID` covers a missing,
non-enumerable, or accessor descriptor. `RESULT_FIELD_INVALID` covers an
invalid outcome value or numeric field. `RESULT_OUTCOME_INCONSISTENT` covers a
field combination that violates the selected outcome rules. Any exception from
the selected result-inspection operations is discarded and replaced with the
bounded `RESULT_INSPECTION_FAILED` cause. The error and poisoned state do not
retain the malformed object or an exception obtained from it, invoke arbitrary
serialization, invoke getters, or include stack material from the returned
value, host state, or environment data.

**Selected future contract:** A successfully loaded classifier begins usable.
A valid `ordinary`, `reparse`, or `capability-gap` result does not poison it.
The first `MOXLEY_NATIVE_RESULT_INVALID` disposition permanently poisons the
cached classifier for that process, and the malformed result is never returned.
Subsequent wrapper calls do not invoke native code again and fail with the same
stable private code, message, and bounded causal reason. Process restart is
required before another load attempt. There is no retry, reload, artifact
replacement, JavaScript fallback, or self-repair.

Loader-load failure caching and post-load result poisoning are separate states.
The former prevents another load after a terminal load failure; the latter
prevents another native call after invalid native-result evidence. Both are
fail-closed and restart-required.

**Deferred implementation:** Traversal-specific mapping remains deferred.
Build-driver failures, including a busy lock or toolchain rejection, remain
build-command concerns and are not loader error codes.

**Explicit nonclaim:** Selecting internal names and codes does not expose them
from `index.js`, promise stability to external callers, or implement an error
class in this slice.

## 68. Loader bootstrapping and security boundary

**Selected future contract:** The generated build directory is trusted local
build output under the operator's filesystem permissions. The loader uses
package-relative resolution and receipt hashing to detect missing,
incomplete, or accidentally mismatched output and rejects an incomplete
binary/receipt pair.

**Currently implemented characterization:** The addon cannot classify its own
binary before it has been loaded. JavaScript `lstat` cannot prove absence of
every generic Windows reparse category. PR #25 proves only bounded test-worker
loading and classification on the accepted host.

**Explicit nonclaim:** No production loader or production runtime behavior is
implemented by this documentation-only contract.

**Explicit nonclaim:** Receipt hashing and package-relative resolution do not
defend against an attacker who can replace both the binary and receipt.
Verification followed by `require()` retains a TOCTOU window. No hostile local
user, malicious administrator, compromised toolchain, or supply-chain
resistance is claimed. No production traversal or complete hardened
qualification is authorized by this contract.

## 69. Packaging and distribution

**Selected future contract:** Generated `.node`, receipt, lock, and staging
state remain ignored and uncommitted. No prebuilt binary, install-time
downloader, npm lifecycle build, `npm pack`, npm publication, release asset, or
binary distribution is approved. Source-build distribution policy remains a
later release decision. The first implementation is repository-development
only on the exact qualified host.

**Currently implemented characterization:** `build/Release` is ignored and
absent. No generated output is tracked or present. The package remains
`moxley-db@3.1.1`, Apache-2.0, with only `flatted` as a dependency and no
package export map or engine declaration. No new npm publication decision has
been made.

**Deferred implementation:** Any source-distribution policy, prebuild,
signature, release asset, package-file allowlist, engine declaration, package
version, tag, release, or npm publication requires a later decision.

**Explicit nonclaim:** This contract does not change package installation,
license, version, dependency graph, public entry point, release state, or npm
state.

## 70. Explicitly deferred implementation and integration

**Deferred implementation:** This documentation-only slice defers:

- production C source promotion and removal of the old test-only source;
- build and clean drivers;
- loader code and loader tests;
- manifest scripts;
- `.gitignore` changes if any later prove necessary;
- `index.js` changes or public exports;
- traversal integration;
- persisted-format loading;
- adapter and Thoth consumption;
- Windows root traversal and component-by-component enforcement;
- artifact signing and prebuilds;
- a CI build matrix;
- other Node patches, majors, platforms, filesystems, or architectures;
- database locking;
- write atomicity;
- crash recovery;
- durability and acknowledgement;
- migration; and
- npm publication.

**Explicit nonclaim:** A selected future build/loader contract does not select
the complete accepted persisted schema, collection or executable-content
policy, public open/create API, traversal error mapping, database locking,
write protocol, recovery, durability, migration, adapter behavior, or Thoth
behavior.

## 71. Documentation-only delta and continuing qualification no-go

**Currently implemented characterization:** This contract changes only
`STATE_COMPATIBILITY.md`. It adds no test, production source, native source,
manifest, lockfile, dependency, package version, fixture, binary, build output,
or generated receipt. The authoritative baseline remains 50 tests, 11
JavaScript/CJS/MJS files, one test-only C file, 19 persisted fixtures, three
Markdown files, and two manifests.

**Selected future contract:** Policy, current characterization evidence,
deferred implementation, and nonclaims remain separate. A future implementer
must satisfy every selected gate without citing this documentation as current
enforcement.

**Explicit nonclaim:** Complete Windows version-1 qualification remains
**no-go**. This document does not claim TOCTOU resistance, hostile-local-user
resistance, production traversal, package distribution, database locking,
atomicity, rollback, recovery, durability, acknowledgement, migration, or
runtime support.

## 72. Next independently testable boundary

**Deferred implementation:** The next slice requires separate authorization
and is limited to production-source promotion, the explicit build and clean
drivers, the private loader, and their isolated tests. It must compile the one
production source from the characterization tests and remove the old test-only
C copy in the same slice.

**Selected future contract:** That slice must still exclude `index.js`, public
exports, production traversal integration, persisted-state loading, adapter
behavior, and Thoth consumption. It must preserve explicit operator-only
building, collision failure, exclusive locking, contained staging,
no-replace promotion, canonical receipts, bounded clean behavior, one-shot
loader caching, exact per-call native result validation, result poisoning,
exact private errors, ignored generated output, and the continuing
qualification no-go.

**Explicit nonclaim:** Completion of that isolated implementation slice would
not by itself authorize traversal, persisted-format acceptance, distribution,
release, npm publication, or complete version-1 qualification.
