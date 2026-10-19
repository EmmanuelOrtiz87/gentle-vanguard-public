# GentleVanguard release process

Current process: 2026-10-19. Version authority: `package.json`, checked against `VERSION`, the dashboard package and the changelog by `npm run version:check`.

## Scope and preparation

Use an isolated checkout of the reviewed candidate. Snapshot the original workspace with `npm run guard:snapshot`; do not stage unrelated local work. Existing release tags and binaries are immutable: choose a new version for changed content.

Install the root lockfile and independent app lockfiles needed by the declared checks. The reproducible app-audit preparation is documented in the private release gate. Run typecheck, lint, relevant regression tests, the complete pre-push gate and, for website changes, `npm run web:gate`.

## Windows artifact

```sh
node --import tsx --test tests/unit/installer-payload.test.ts tests/unit/verify-installer.test.ts
node --import tsx src/cli/create-installer.ts
```

NSIS 3+ is required to build. The result is `dist/Gentle-Vanguard-Setup-<version>.exe` and its SHA-256 sidecar. It is a bootstrapper requiring Node 22.18+, pnpm 11+, Git and dependency downloads. Apps, client/session/status documentation, secrets, databases and node_modules are excluded; shared runtime primitives and adapters are included. Bootstrap is opt-in.

Signing, when configured with a real certificate, must finish before calculating the SHA-256 sidecar: Authenticode changes the executable bytes. Failed signing aborts finalization. The unsigned 4.3.0 executable is immutable; improvements to the build apply to future releases.

Validate archive integrity, extract to a dedicated temporary directory and compare the extracted payload with the staged file hashes. Scan the payload for secrets. Record signing status honestly. A structural/extraction test is not a clean-machine install/uninstall test.

The public `Public Windows Installer Qualification` workflow uses an ephemeral GitHub-hosted Windows runner, a pinned release executable digest and no private credentials. It checks installation, payload, user registry, Start menu shortcuts and complete uninstall cleanup without bootstrapping dependencies. The verifier refuses execution on normal profiles and self-hosted runners, aborts on checksum failure and preserves failed installations for inspection. Never spoof runner environment variables locally. This checks the installer lifecycle, not the complete first-use experience of the stack. Update the pinned version and digest deliberately for each new release; never replace an existing release binary.

## Public distribution

The product repository is `EmmanuelOrtiz87/gentle-vanguard-public`. The brand repository `gentlevanguard/gentlevanguard.github.io` receives only the web export. Never send the full stack to the brand repository.

Use a fresh, backed-up public checkout and stage the projection without pushing:

```sh
node --import tsx src/infrastructure/sync-to-public.ts --skip-push --public-repo <isolated-public-checkout>
```

Review the diff and publication boundary. From the public checkout run frozen dependency installation, `tsc --noEmit` and `node --import tsx src/infrastructure/installer-doctor.ts --strict --json`. Preserve histories while aligning main/develop; never force tags or branches. Publish the installer and checksum as release assets, update `releases/latest-version.json` with the real hash and a public URL, and verify anonymous download access with `npm run release:verify-dist`.

## Evidence and rollback

Record exact source revisions, public tree, installer bytes/hash, payload comparison, test results and known omissions. Keep Git bundles and the previous release. GitHub Actions blocked by billing or spending limits is **not** a CI pass; do not disable or bypass checks to conceal it. Paid infrastructure and real transactions require their own authorization.
