# Moxley State Compatibility Policy

Status: Marker separability, future node identity, derived runtime-location
authority, root-input lexical rules, and persisted-name grammar selected;
version-1 qualification remains a no-go pending other decisions; runtime
support remains unimplemented.
Date: 2026-07-29
Historical behavior baseline: `518ab5ab58500a84246770e8ef0180856e127abd`
Discriminator decision input baseline: `635a7c09bcca63c3abbb52d5c2fbbce4b87a9817`
Persisted-evidence inventory baseline: `3368824d8ab58d6ce8a5964b2acb8c846823430e`
Node-identity decision input baseline: `a2b06a9eecec16aa55869be1748dd03edff6b2ba`
Runtime-location decision input baseline: `0be070c041644ecd5c4ef2138f4654c17f15dcb3`
Root-input and persisted-name decision input baseline:
`44000d8625b5ba724bb090bd61ef287e3ac699f6`
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
- a fresh-versus-existing-directory decision;
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

The repository now contains 16 fixed persisted-preimage files. Every state
preimage that predates the locless tree, including the UUID-characterization
states, retains the sentinel `_loc` value selected for its earlier evidence
purpose. Those bytes remain immutable. The identity and locless trees prove
their selected layers independently, but neither uses the final typed physical
name grammar selected below and neither is an accepted version-1 database.

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
| Root and child node state: `_state.ms` | **Source fact:** `DB._saveState()` writes `flatted.stringify(state)`. Current fields, in writer order, are `_loc`, `_id`, `_name`, `_keys`, `_bindings`, plus optional `_childTemplate` containing another flatted string. **Selected authority:** a future version-1 root adds exact `_format: "moxley-db"` and integer `_formatVersion: 1`; every future version-1 node has UUID `_id` and `_parentId`, and root and child state omit `_loc`. | **Source fact:** `DB._loadState(loc)` selects `<loc>_state.ms` from its runtime argument and parses it. `_loadFromDir()` copies root `_keys` and `_bindings`, reconstructs optional `_childTemplate`, and reads child `_name`; it does not assign saved `_loc` or preserve saved child `_id`. Current master does not write or enforce the marker, UUID, `_parentId`, or locless contract. | Current `_loc` names a runtime path; current `_id` is root `0` or a positional child path. Future version-1 physical parentage is selected through `_parentId`; runtime location is derived from the opened root and physical traversal and is not persisted identity. | Parsing ordinary fields does not itself execute code. Reconstructing `_childTemplate` creates function-source-bearing template state. `DB`, child, proxy, and collection constructors are filesystem-mutation-capable: missing derived locations can be created and proxy assignments can persist files. | **Test or fixture evidence:** fixed historical, corrected-child, marker-only, UUID-identity, and locless preimages characterize their selected layers. Other tests characterize recursive readiness, parse-failure propagation, restart reconstruction, and duplicate positional children. **Source fact:** current load ignores saved `_loc` as traversal authority but does not reject or validate it and does not comprehensively validate the other relationships. | **Partially selected for future version 1:** UUID, `_parentId`, locless node-state semantics, exact internal state names, root-input lexical rules, and typed physical naming are defined below. Serialization, loading, generation, containment, validation, collection identity, and the complete accepted schema remain unimplemented or unresolved. |
| Node data: `*.md` | **Source fact:** the proxy `set` path writes `flatted.stringify(value)` to `<key>.md` and adds a new property name to node `_keys`. | **Source fact:** proxy `get` lazily reads and `flatted.parse`s `<key>.md` when the property is not already materialized. The logical value is any value accepted by the current flatted writer; no narrower persisted schema is selected. | Each filename stem is intended to correspond to one `_keys` entry on the containing node. **Selected authority:** a future version-1 data entry uses `k_<hex>.md`, where `<hex>` canonically encodes the normalized logical key. | Lazy data parsing does not call `eval`. Ordinary construction and later proxy writes remain mutation-capable, but a future preflight must not use them. | No current fixed preimage contains `*.md`. Current loading does not prove a one-to-one relation between `_keys` and data/link/function files, reject extra evidence, or reject missing or multiply typed evidence for one key. | **Partially selected:** the logical-name and physical-filename grammar is defined below. A serializable-data schema, complete `_keys` relationship, flatted-value limits, and runtime enforcement remain unresolved. |
| Named node links: `*.ml` | **Source fact:** assigning a current node through the proxy writes the target node's textual positional `_id` to `<key>.ml` and adds the stem to parent `_keys`. | **Source fact:** current lazy proxy access reads the file as text and resolves it through root `_getById()`, which traverses numeric child positions. The characterized legacy bytes for `descendant.ml` are exactly `0/0`. | The filename stem is the alias key and a parent `_keys` entry. **Selected authority:** future version-1 node links contain a target UUID, use `k_<hex>.ml`, and resolve through the complete same-database node-ID index; they are references, not ownership edges. | Reading current link text does not evaluate code or directly write, but target resolution depends on a constructor-reconstructed positional graph, and that construction path is mutation-capable. Future preflight resolution must occur before reconstruction without writes. | **Test or fixture evidence:** PR #14 proves byte identity of historical, post-PR #11, and marker-only positional links. PR #17 and PR #19 add synthetic UUID-only link evidence without runtime loading; their direct `descendant.ml` names predate the typed grammar. | **Selected for future version-1 node links only:** exact UUID bytes, same-tree resolution, alias semantics, failure conditions, and typed filename grammar are defined below. Collection item links, `_bindings`, and runtime enforcement remain deferred. |
| Stored functions: `*.mf` | **Source fact:** assigning a new function writes `Function.prototype.toString()`-style source through `arg.toString()` and adds the stem to `_keys`. | **Source fact:** lazy proxy access reads the source, passes it to `eval`, binds the resulting function to the origin node, and returns it. | The stem is a node `_keys` entry. Template hooks can store textual function IDs and resolve them through `_findFunction()`, which reaches the same lazy function reader. **Selected authority:** `k_<hex>.mf` is reserved as the future typed classification name only. | Reading the property crosses an `eval` boundary. Calling it or resolving a hook can execute persisted code with node access. The enclosing constructor-backed graph is mutation-capable even before later property writes. | No fixed preimage or automated qualification test covers `*.mf`, source grammar, origin binding, hook reference integrity, or code-execution policy. | **Unresolved and not approved for version 1.** Reserving the typed suffix does not approve executable persistence. David Giles must explicitly choose whether executable persisted evidence is included, excluded, or governed by a separate trust policy. |
| Collections: dotless directory, `_colstate.mc`, per-item `*.ml`, and node `_bindings` | **Source fact:** `DC._saveState()` writes a flatted object with `_loc`, `_name`, `_keys`, and `_indexBy`, plus optional `_keySort`, `_itemSort`, and `_accept` function source. Proxy assignment of node items writes textual-ID `*.ml` entries. `DB._bind()` stores collection IDs in node `_bindings`. | **Source fact:** `DC` derives runtime `_loc` as parent `_loc` plus collection name. A dotless entry without child `_state.ms` is constructed as a collection. `DC._loadState()` parses `_colstate.mc`, ignores saved `_loc`, and evaluates optional callback sources. A collection ID is derived from parent node ID plus directory/name rather than stored in `_colstate.mc`. | Collection `_keys` correspond to item-link stems; each link should resolve to a node; `_indexBy` influences keys; `_bindings` must resolve to a collection; parent path, collection name, and derived ID must agree. | Collection state loading evaluates callback source. `_accept`, `_keySort`, and `_itemSort` may execute during add/sort behavior. Collection construction can create a missing derived directory, and proxy-based item insertion can write links and state. | Current tests and fixtures do not give collections equivalent reconstruction, readiness, callback, binding, or restart coverage. Current load starts constructor-backed collection state loading without an equivalent complete readiness contract and does not validate its relationships. | **Unresolved.** Collections are not approved for version 1. The exact `c_<hex>` directory namespace and `_colstate.mc` reservation are selected only for unambiguous future classification. They do not select collection schema, identity, callbacks, links, bindings, or lifecycle. |
| Templates: node `_childTemplate` | **Source fact:** `DT` converts `apply` and function-valued nested fields to source strings; `DT.toString()` flatted-serializes `{strict, apply, keys}`; node `_saveState()` embeds that string in `_state.ms`. | **Source fact:** `_loadFromDir()` parses the nested string and constructs `DT`. Template initialization assigns defaults, contains a function-default evaluation branch, evaluates and invokes `apply`, and saves state. Proxy assignment evaluates and invokes validators. Hooks resolve stored function references and invoke them. | The parent carries the child template; newly created children receive it. Nested key rules relate defaults, validators, and hooks to node properties and stored functions. | `apply` and validators cross `eval` and invocation boundaries. Hooks can evaluate and invoke `*.mf`. The source contains a default-function evaluation path, while `DT` serializes function-valued fields to strings; the persisted default-function lifecycle has no qualification proof. Template application writes defaults and state. | No fixed preimage or automated qualification suite covers nested template framing, validator/default/apply/hook reconstruction, rejection behavior, or execution order. | **Unresolved and not approved for version 1.** Executable-template policy, hook/reference semantics, exact nested schema, and lifecycle evidence require owner decisions and dedicated fixtures. |
| Directory and entry classification | **Source fact:** root, child, and collection constructors create their expected directories when absent; there is no persisted directory type tag. | **Source fact:** `_loadFromDir()` enumerates a directory, ignores entries whose names contain `.`, forms a candidate child path by string concatenation, classifies a dotless entry with `<entry>/_state.ms` as a child, and otherwise constructs it as a collection. `path.resolve()` is used only to compare a candidate with already reconstructed child locations, not to establish the opening root or enforce containment. | Physical entries must eventually agree with state, UUID, parent, keys, collection, link, and binding evidence. **Selected authority:** future traversal locations come only from the resolved root and directly enumerated relative entries, never persisted `_loc`; exact typed entry names are defined below. | Current classification uses constructor-backed reconstruction before whole-tree validation; those paths can write and can reach executable collection or template evidence. | Tests characterize selected child recursion and failure propagation, not an exhaustive allowed-entry grammar. Existing fixtures use legacy `0` slots and direct `descendant.ml` names. No current test characterizes the new typed grammar, containment, symlinks, or junctions. | **Partially selected:** root-input lexical rules, typed entry grammar, canonical encoding, and fail-closed unknown-entry treatment are selected. Canonicalization, containment, filesystem-object policy, implementation, and complete relationship validation remain unresolved. |

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
2. Apply the later-selected canonicalization and containment policy.
3. Establish whether the target is an existing database without writing.
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

A later preflight contract must classify failures in this semantic order,
without this document inventing a public error class, error code, or final
message format:

1. Filesystem, access, or read failure, preserving the original cause.
2. Malformed root framing or root parse failure.
3. Validly parsed root with a missing, malformed, unknown, or unsupported
   marker.
4. Unsupported entry or feature category.
5. Malformed or contradictory marked-tree evidence.
6. Relationship or reference inconsistency.
7. Success only after the complete selected evidence set passes.

Current ordinary loading uses filesystem enumeration order and has no
independent preflight defect sorter. This record therefore does not select a
relative-path tie-breaker for multiple peer defects. A later contract may
select deterministic normalized relative-path ordering for the future
preflight only after confirming that doing so does not change ordinary load
order or imply current enforcement.

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

Exact path containment and symlink, junction, reparse-point, and mount
enforcement remain later contract and implementation decisions. If
collections are later admitted to version 1, their runtime locations must use
the same derived, non-persisted principle. That statement does not approve
collections or select their persisted schema, identity, bindings, or
lifecycle.

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

This record does not select the exact public opening or creation API,
canonicalization operation, `realpath` behavior, existence or open-versus-create
semantics, or symlink policy. It does not claim that current constructor input
handling already satisfies the selected lexical contract.

## 23. Child runtime location and physical placement

- A child runtime location is derived from the already-contained physical
  parent location and the enumerated direct child entry.
- The child's persisted `_parentId` validates logical ownership; it never
  supplies a filesystem path.
- A canonical future `n_<slot>` name supplies storage placement only.
- Renaming a slot beneath the same physical parent does not change `_id` or
  `_parentId`, subject to the later filename and path policy.
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
- All 16 persisted-preimage files remain immutable characterization evidence.
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
2. Apply the later-selected canonicalization and containment policy.
3. Read and parse root `_state.ms` from the resolved root.
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
persisted node state path-redirection authority. The root lexical and typed-name
decisions below close additional contract questions, but none is implemented.
Together they do not solve:

- root canonicalization or existence;
- dot-segment, separator-normalization, or trailing-separator handling;
- filesystem containment;
- drive-letter canonicalization or mounted-filesystem semantics;
- symlinks, junctions, reparse points, or mount boundaries;
- hard links;
- time-of-check/time-of-use races;
- locking or concurrent mutation;
- filesystem permissions; or
- atomicity, recovery, or durability.

Complete cross-platform portability and security qualification are not claimed.
The selected canonical physical grammar avoids raw logical names and physical
case variants; it does not establish containment or safe filesystem traversal.

## 28. Explicit deferrals and nonclaims

This record continues to defer:

- the exact public opening and creation API;
- separator normalization, dot-segment handling, trailing-separator behavior,
  drive-letter normalization, existence, and open-versus-create semantics;
- root canonicalization, `realpath`, and containment;
- symlink, junction, reparse-point, and mount policy;
- hard-link policy and filesystem-object identity;
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
normalization, name encoding, reconstruction, relocation, clone, or repair. It
does not claim that current master reads or writes the selected locless or
typed-name contract, that any existing database is version 1, or that the
synthetic fixtures are accepted, portable, secure, durable, or
runtime-supported state.

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
- Current tests and all 16 fixed preimages characterize only selected current,
  historical, marker, identity, and locless behavior. The existing physical
  exemplars use bare `0` slots and direct `descendant.ml` aliases. No existing
  fixture implements the grammar selected below.

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

This contract does not yet select exact separator normalization, dot-segment
handling, trailing-separator behavior, drive-letter normalization,
canonicalization, `realpath`, existence checks, open-versus-create semantics,
or symlink behavior. It also does not claim that a mounted or network-backed
POSIX path can be identified reliably from the input string alone.

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
- Future encoded-name fixtures must be a separate synthetic tree.
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
2. Apply the later-selected canonicalization and containment policy.
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
runtime traversal before the later containment and filesystem-object policy is
selected and implemented.

## 37. Security effects and nonclaims

Canonical typed encoding removes direct caller-controlled path syntax from
future internal filenames and gives exact lexical categories. It does not by
itself solve:

- containment;
- root canonicalization;
- symlinks, junctions, reparse points, or mounts;
- hard links;
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
later filesystem policy must still address containment, aliases, and races.

## 38. Qualification gate and next independently testable slice

The future marker, node identity, named-link target, locless runtime-location
authority, root-input lexical class, logical-name grammar, canonical encoding,
and typed physical namespaces are now selected owner decisions. Complete
version-1 qualification remains a no-go because containment and filesystem
object policy, executable-content policy, collection and binding scope,
complete `_keys` correspondence, the complete accepted state/data schema, and
runtime evidence remain unresolved.

The next independently testable slice is fixtures and characterization only.
It should:

- preserve all 16 existing persisted-preimage files byte-for-byte;
- add a separate synthetic encoded-name tree;
- use child slot directory `n_0`;
- use logical key `descendant`;
- use canonical UTF-8/lowercase-hex
  `64657363656e64616e74`;
- use link filename `k_64657363656e64616e74.ml`;
- retain locless root and child state, the fixed UUIDs, `_parentId`
  relationships, the root marker, and exact UUID-only link bytes; and
- avoid runtime construction, loading, traversal, mutation, or portability and
  security claims.

That later slice should create mutation cases only in memory for uppercase and
odd-length hex, invalid UTF-8, non-NFC decoded names, direct legacy filenames,
unknown prefixes or extensions, duplicate decoded names, data/link/function/
collection type collisions, node-slot leading zeros, and root-input lexical
rejection.

It must not modify or relabel existing fixtures and must not implement
production behavior. Until that evidence and the remaining owner decisions are
closed, version-1 qualification remains a no-go.
