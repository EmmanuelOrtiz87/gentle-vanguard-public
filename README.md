# GentleVanguard

Local-first orchestration, memory and verification for AI-assisted software work.

**Version 4.3.0** · [Company website](https://gentlevanguard.github.io/) · [Academy](https://gentlevanguard.github.io/academy/)

## Distribution scope

This repository provides the TypeScript core, shared runtime primitives, setup tools and curated documentation. Operational apps, client projects, private skill content, databases, credentials and internal session reports are excluded. The company website and Academy have a separate public deployment; the installer does not bundle those apps.

## Windows installer

Download **Gentle-Vanguard-Setup-4.3.0.exe** and its `.sha256` from the [4.3.0 release](https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases/tag/v4.3.0).

This is a **bootstrapper** requiring **Node.js 22.18+ (24 LTS recommended), pnpm 11+ and Git**. It installs sources and setup tools; bootstrap downloads locked dependencies when you choose to run it. It is not an offline or self-contained runtime.

The installer is unsigned unless the release states otherwise. Windows may display an unknown-publisher/SmartScreen prompt. Check the release checksum before running it:

```powershell
Get-FileHash .\Gentle-Vanguard-Setup-4.3.0.exe -Algorithm SHA256
```

After installing the prerequisites, run the installer and choose whether to launch bootstrap. It initializes local data and verifies dependencies; failed phases return errors.

## From source

```sh
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git
cd gentle-vanguard-public
pnpm install --frozen-lockfile
node --import tsx src/infrastructure/installer-bootstrap.ts
```

Dependencies and optional providers may require network access. Credentials are supplied locally by the operator. Cloud services and operational apps are separate integrations.

## Verification

Release evidence records the source revision, installer checksum and local commands. [Public Distribution Smoke passed for 4.3.0](https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/actions/runs/39318256892): frozen install, TypeScript and strict doctor. Private-repository CI jobs could not start because of an account billing/spending restriction; public CI does not certify the private app fleet.

The website has its own export/browser/identity gate. Public-core tests do not certify all private apps, client deployments, physical devices or payment/fulfilment flows.

## Documentation

- [Getting started](docs/getting-started/README.md)
- [Architecture](docs/architecture/README.md)
- [Changelog](CHANGELOG.md)
- [Release process](docs/guides/RELEASE-PROCESS.md)

## License

MIT © 2026 Emmanuel Ortiz. See [LICENSE](LICENSE).
