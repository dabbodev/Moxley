# Moxley State Compatibility Policy

Status: Marker selected and byte separability characterized; version-1
qualification is a no-go pending owner decisions; runtime support remains
unimplemented.
Date: 2026-07-28
Historical behavior baseline: `518ab5ab58500a84246770e8ef0180856e127abd`
Discriminator decision input baseline: `635a7c09bcca63c3abbb52d5c2fbbce4b87a9817`
Persisted-evidence inventory baseline: `3368824d8ab58d6ce8a5964b2acb8c846823430e`
Decision authority: David Giles, sole owner of Moxley

These repository baselines are evidence and decision inputs. Neither is a
persisted-format version, package release, or prediction of an eventual merge
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

These fields are additional to the existing root-state fields.

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

## 7. Completed byte-separability evidence

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

## 8. Persisted-evidence audit method and labels

This inventory is grounded in the complete `index.js`, the package manifests,
this policy, the complete README, legacy `test.js`, every current automated
test and worker, and every persisted-preimage fixture at the inventory
baseline. The audit traced every filesystem read and write, every
`flatted.parse` and `flatted.stringify`, every `eval` and function-source
conversion, and every constructor or proxy path capable of filesystem
mutation.

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
| Root and child node state: `_state.ms` | **Source fact:** `DB._saveState()` writes `flatted.stringify(state)`. Current fields, in writer order, are `_loc`, `_id`, `_name`, `_keys`, `_bindings`, plus optional `_childTemplate` containing another flatted string. **Selected authority:** a future version-1 root adds exact `_format: "moxley-db"` and integer `_formatVersion: 1`; children must not carry them. | **Source fact:** `DB._loadState()` parses `_state.ms`; `_loadFromDir()` copies root `_keys` and `_bindings`, reconstructs optional `_childTemplate`, and reads child `_name` before constructor-backed reconstruction. Current master does not write or enforce the marker. | `_loc` names a physical runtime path; `_id` is root `0` or a positional child path; `_name` supplies the reconstructed child name; `_keys` names node evidence; `_bindings` contains collection IDs; child directories are expected to match child positions. | Parsing ordinary fields does not itself execute code. Reconstructing `_childTemplate` creates function-source-bearing template state. `DB`, child, proxy, and collection constructors are filesystem-mutation-capable: missing inferred locations can be created and proxy assignments can persist files. | **Test or fixture evidence:** PR #14 fixes root, historical-child, corrected-child, and root-marker preimages. Other tests characterize recursive readiness, parse-failure propagation, restart reconstruction, and duplicate positional children. **Source fact:** load does not comprehensively validate field presence/types, stored `_loc`, stored `_id`, parent/child agreement, `_keys`, or `_bindings`. | **Unresolved.** The marker shape is selected and separable, but the complete state schema, location ownership, identity rules, binding rules, and accepted feature set are not. |
| Node data: `*.md` | **Source fact:** the proxy `set` path writes `flatted.stringify(value)` to `<key>.md` and adds a new property name to node `_keys`. | **Source fact:** proxy `get` lazily reads and `flatted.parse`s `<key>.md` when the property is not already materialized. The logical value is any value accepted by the current flatted writer; no narrower persisted schema is selected. | Each filename stem is intended to correspond to one `_keys` entry on the containing node. | Lazy data parsing does not call `eval`. Ordinary construction and later proxy writes remain mutation-capable, but a future preflight must not use them. | No PR #14 fixture contains `*.md`. Current loading does not prove a one-to-one relation between `_keys` and data/link/function files, reject extra evidence, or reject missing or multiply typed evidence for one key. | **Unresolved.** A serializable-data schema, filename/key rules, conflict rules, and flatted-value limits require contract evidence. |
| Named node links: `*.ml` | **Source fact:** assigning a node through the proxy writes the target node's textual `_id` to `<key>.ml` and adds the stem to parent `_keys`. | **Source fact:** lazy proxy access reads the file as text and resolves it through root `_getById()`. The characterized bytes for `descendant.ml` are exactly `0/0`. | The filename stem is a parent `_keys` entry. The text must designate an existing target under the chosen ID model. `_getById()` traverses numeric child positions. | Reading link text does not evaluate code or directly write, but target resolution depends on a constructor-reconstructed positional graph, and that construction path is mutation-capable. | **Test or fixture evidence:** PR #14 proves byte identity of historical, post-PR #11, and proposed-marker named links. Tests cover the first duplicate named binding remaining `0/0`. There is no whole-tree proof of target uniqueness, target existence, path containment, or persisted-ID consistency. | **Unresolved.** Stable identity and reference semantics are owner decisions. Positional IDs are not declared stable. |
| Stored functions: `*.mf` | **Source fact:** assigning a new function writes `Function.prototype.toString()`-style source through `arg.toString()` and adds the stem to `_keys`. | **Source fact:** lazy proxy access reads the source, passes it to `eval`, binds the resulting function to the origin node, and returns it. | The stem is a node `_keys` entry. Template hooks can store textual function IDs and resolve them through `_findFunction()`, which reaches the same lazy function reader. | Reading the property crosses an `eval` boundary. Calling it or resolving a hook can execute persisted code with node access. The enclosing constructor-backed graph is mutation-capable even before later property writes. | No fixed preimage or automated qualification test covers `*.mf`, source grammar, origin binding, hook reference integrity, or code-execution policy. | **Unresolved and not approved for version 1.** David Giles must explicitly choose whether executable persisted evidence is included, excluded, or governed by a separate trust policy. |
| Collections: dotless directory, `_colstate.mc`, per-item `*.ml`, and node `_bindings` | **Source fact:** `DC._saveState()` writes a flatted object with `_loc`, `_name`, `_keys`, and `_indexBy`, plus optional `_keySort`, `_itemSort`, and `_accept` function source. Proxy assignment of node items writes textual-ID `*.ml` entries. `DB._bind()` stores collection IDs in node `_bindings`. | **Source fact:** a dotless entry without child `_state.ms` is constructed as a collection. `DC._loadState()` parses `_colstate.mc` and evaluates optional callback sources. `_populate()` is intended to resolve per-item link IDs. A collection ID is derived from parent node ID plus directory/name rather than stored in `_colstate.mc`. | Collection `_keys` correspond to item-link stems; each link should resolve to a node; `_indexBy` influences keys; `_bindings` must resolve to a collection; parent path, collection name, and derived ID must agree. | Collection state loading evaluates callback source. `_accept`, `_keySort`, and `_itemSort` may execute during add/sort behavior. Collection construction can create a missing directory, and proxy-based item insertion can write links and state. | Current tests and PR #14 fixtures do not give collections equivalent reconstruction, readiness, callback, binding, or restart coverage. Current load starts constructor-backed collection state loading without an equivalent complete readiness contract and does not validate its relationships. | **Unresolved.** Optional callback fields are mechanically visible after parsing, but their absence alone does not qualify a “basic” collection: directory classification, lifecycle, IDs, bindings, item links, and readiness remain unproved. Owner authority is required to include collections or reduce the supported feature surface. |
| Templates: node `_childTemplate` | **Source fact:** `DT` converts `apply` and function-valued nested fields to source strings; `DT.toString()` flatted-serializes `{strict, apply, keys}`; node `_saveState()` embeds that string in `_state.ms`. | **Source fact:** `_loadFromDir()` parses the nested string and constructs `DT`. Template initialization assigns defaults, contains a function-default evaluation branch, evaluates and invokes `apply`, and saves state. Proxy assignment evaluates and invokes validators. Hooks resolve stored function references and invoke them. | The parent carries the child template; newly created children receive it. Nested key rules relate defaults, validators, and hooks to node properties and stored functions. | `apply` and validators cross `eval` and invocation boundaries. Hooks can evaluate and invoke `*.mf`. The source contains a default-function evaluation path, while `DT` serializes function-valued fields to strings; the persisted default-function lifecycle has no qualification proof. Template application writes defaults and state. | No fixed preimage or automated qualification suite covers nested template framing, validator/default/apply/hook reconstruction, rejection behavior, or execution order. | **Unresolved and not approved for version 1.** Executable-template policy, hook/reference semantics, exact nested schema, and lifecycle evidence require owner decisions and dedicated fixtures. |
| Directory and entry classification | **Source fact:** root, child, and collection constructors create their expected directories when absent; there is no persisted directory type tag. | **Source fact:** `_loadFromDir()` enumerates a directory, ignores entries whose names contain `.`, classifies a dotless entry with `<entry>/_state.ms` as a child node, and otherwise constructs it as a collection. There is no independent read-only classifier. Dotted evidence is reached later through fixed state filenames or lazy property access. Dotless type, unexpected entries, missing state, conflicting state, and file-versus-directory cases are not exhaustively classified before construction. | Physical entries must eventually agree with node positions, state names/locations/IDs, `_keys`, collection state, links, and bindings. | Current classification uses constructor-backed reconstruction before whole-tree validation; those paths can write and can reach executable collection or template evidence. | Tests characterize selected child recursion and failure propagation, not an exhaustive allowed-entry grammar. There is no evidence for rejecting unexpected, conflicting, missing, or aliased entries, and no selected symlink/junction policy. | **Unresolved.** A future preflight needs an exact entry allowlist, containment rules, missing/conflict behavior, and a no-constructor traversal contract. |

## 10. Cross-category limitations confirmed by live source

The following are **source facts** or direct **inferences** from the matrix:

- Current `_loc` values encode creator or runtime filesystem paths. They are not
  declared portable.
- Current child IDs are positional and path-derived. They are not declared
  stable.
- Named links contain textual IDs and depend on that positional graph.
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
| 3. Node/link characterization subset only | Only the root, one child-state relationship, and named-link evidence represented by PR #14 fixtures. | The marker and these fixture shapes are mechanically separable. The subset lacks general data, exhaustive trees, collections, bindings, templates, functions, unexpected-entry rules, and most relationship failures, so it is not a useful general database format. | **Evidence exemplar only; not selected as version 1.** |
| 4. Prerequisite-first boundary | Defers qualification until identity, persisted-location/relocation ownership, executable-feature policy, and supported collection/feature scope are selected. | Prevents the marker from being mistaken for a complete acceptance contract and preserves owner authority over compatibility reductions. It permits each prerequisite to receive its own fixtures and failure contract before runtime work. | **Recommendation and current gate disposition: no-go pending decisions.** This is not a selection of a reduced format. |

## 12. Future whole-database no-write evidence graph

If and only if a version-1 evidence set is later selected, a future read-only
preflight must follow this dependency order:

1. Resolve and contain the database root.
2. Establish whether the target is an existing database without writing.
3. Read and parse root `_state.ms`.
4. Classify marker absence, malformed marker, unknown format, and unsupported
   version.
5. Enumerate the complete candidate tree without constructors or proxy writes.
6. Classify every entry by an exact allowed category.
7. Read and parse all required state and link evidence.
8. Validate root, child, location, ID, and name relationships.
9. Validate `_keys` against persisted data, link, and function evidence.
10. Validate collections and bindings if their support is later approved.
11. Reject executable persisted evidence unless an explicit policy permits it.
12. Complete all validation before reconstruction, evaluation, or mutation.

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

## 14. Explicit deferrals and nonclaims

This record does not select or implement:

- the complete accepted version-1 schema or feature surface;
- stable persisted identity or named-link reference semantics;
- persisted-location authority, portability, or relocation behavior;
- executable-code, template, hook, or callback policy;
- collection support, exclusion, or lifecycle qualification;
- runtime marker writing or enforcement;
- production preflight, traversal, reconstruction, or rejection;
- a public API or exported error type;
- a stable error code or complete error wire shape;
- numeric resource limits;
- exact symlink, junction, or path-containment implementation;
- migration, automatic repair, normalization, or legacy conversion;
- duplicate `_create(name)` behavior;
- locking, race handling, or concurrent-writer behavior;
- atomic commits, journaling, recovery, durability, or cancellation;
- a package release, package-version change, tag, or npm publication; or
- Moxley adapter or Thoth behavior.

It does not claim that any existing database is version 1, that the synthetic
marked fixture is accepted, that current master is production-safe, or that
Moxley reads or writes a supported persisted-format version.

## 15. Version-1 qualification gate: NO-GO

The current evidence does not support a complete version-1 qualification
contract. The selected marker remains necessary and mechanically separable,
but it is not sufficient. Qualification is blocked on these exact owner or
contract decisions:

1. David Giles must choose whether persisted node identity is positional,
   topology-derived, or independently stable, and define named-link target,
   uniqueness, and missing-target semantics.
2. David Giles must choose whether `_loc` is authoritative persisted identity,
   derived evidence, a validation hint, or replaceable relocation metadata,
   including how parent/child physical placement is judged.
3. David Giles must choose whether version 1 includes persisted executable
   functions, templates, hooks, validators, defaults, and collection callbacks,
   excludes them, or requires a separately defined trust policy.
4. David Giles must choose whether collections and bindings are in the initial
   version-1 feature surface. If they are, their directory grammar, item-link
   model, derived identity, readiness, callbacks, and binding relationships
   need dedicated evidence. If they are not, that compatibility reduction must
   be explicitly authorized.
5. After those choices, a bounded contract must define the exact accepted
   files, logical field types, relationship invariants, unsupported-entry
   behavior, and read-only traversal evidence before any detector code.

The next smallest dependency-ordered slice is a documentation-only owner
decision on persisted node identity and named-link reference semantics. It
must add no runtime behavior and must not claim version-1 support. Until that
decision and the remaining prerequisites are closed, version-1 qualification
remains a no-go.
