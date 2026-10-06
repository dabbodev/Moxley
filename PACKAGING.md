# Local package qualification workflow

Use npm pack --json --pack-destination <outside-source-directory> on a clean,
identified source checkpoint. Pack twice with unchanged bytes and toolchain.
Retain the tarballs, npm manifests and independently derived archive-member
SHA-256 manifests. Compare tarball SHA-256 values, then install the exact file
into a fresh private consumer and authenticate its package root, metadata,
lock integrity and every installed member against the archive.

The files allowlist intentionally includes tests/fixtures to support installed runtime acceptance.
The complete canonical npm test requires a Git source checkout for its native
custody checks. npm run test:runtime runs all eight installable canonical
files plus atomic/close suites, retaining every assertion and excluding only
the Git-dependent native-build custody suite. Native C source and the
manual build/clean scripts support declared optional tooling. Tests, fixtures
and native tooling are development content; index.js imports only the two lib
helpers and flatted. No generated native binary is distributed. The unrelated
root test.js demonstration and Git attributes are excluded. No secrets, local
evidence, temporary files, cache or node_modules belongs in a tarball.

Run npm test from a Git source checkout for the complete canonical suite.
Run npm run test:runtime from the installed package, followed by npm run
test:package for packing, intentional members, runtime closure, licensing,
metadata consistency and fresh installed-consumer acceptance. Retain failed
artifacts and test-owned roots rather than rewriting evidence. Independent
release qualification must still inspect the archive itself and exercise its
installed runtime and relevant consumer contract separately.

Reproducibility is scoped to identical checkout bytes and Node/npm toolchain.
Git text=auto can produce different LF/CRLF bytes in other checkouts; repeated
packing on one host does not certify cross-platform byte identity. No bespoke
archive rewriting is used. The archive has no package-lock.json or bundled
flatted; a fresh consumer resolves the unchanged dependency range and its
consumer lock binds that tested dependency. The development lock remains the
qualified source lock and is not a published dependency pin.

The engines floor is a runtime prerequisite, not a qualification matrix. This
campaign uses Windows x64, Node 24.13.0 and npm 11.6.2. Optional native tooling
retains its separate exact host/runtime admission. Package qualification does
not establish durable storage, crash/resume, full OEWN loading, publication,
remote release integrity or production admission.

SemVer reasoning uses https://semver.org/, built-in require support documented
at https://nodejs.org/api/modules.html#built-in-modules, and randomUUID history
at https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidoptions.
The release decision also uses the retained live npm version history.
