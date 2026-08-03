# PC Migration Guide

Complete guide for migrating Gentle-Vanguard workspace to a new machine.

## Prerequisites (New Machine)

Before importing, install these on the new machine:

| Tool          | Install Command                                 | Required                           |
| ------------- | ----------------------------------------------- | ---------------------------------- |
| Git           | `winget install Git.Git`                        | Yes                                |
| Node.js (LTS) | `winget install OpenJS.NodeJS.LTS`              | Yes                                |
| Go            | `winget install GoLang.Go`                      | Yes                                |
| TypeScript 7  | `winget install Microsoft.TypeScript`           | Yes                                |
| Bun           | `TypeScript -c "irm bun.sh/install.ps1 \| iex"` | Yes                                |
| Cairo (GTK3)  | `.\scripts\utilities\install-cairo.ps1`         | No (needed for PNG diagram export) |

> Run `.\scripts\utilities\verify-tools.ps1` to check tool availability with hash caching (only
> re-checks on version change or 7+ days).

> Run `.\scripts\utilities\install-prerequisites.ps1 -Install` to install missing tools.

## Export (Current PC)

```TypeScript
# Export to Downloads folder
.\scripts\gentle-vanguard\export-profile.ps1

# Or export directly to external disk (e.g. D:)
.\scripts\gentle-vanguard\export-profile.ps1 -ExternalDisk D

# Specify custom repo root (default: auto-detected)
.\scripts\gentle-vanguard\export-profile.ps1 -ExternalDisk D -RepoRoot C:\Workspace_local\gentle-vanguard
```

### What Gets Exported

| Component       | Location                  | Contents                                            |
| --------------- | ------------------------- | --------------------------------------------------- |
| Engram DB       | `~/.engram/`              | `engram.db`, WAL files, `global/`, `instances.json` |
| Master Key      | `keys/master.key`         | AES-256 key for decrypting protected scripts        |
| OpenCode Config | `~/.config/opencode/`     | `opencode.json`, `tui.json`, `plugins/`             |
| Binaries        | `~/bin/`                  | `engram.exe`, `opencode`, `gga`, `lib/`             |
| Go Binaries     | `~/go/bin/`               | `engram.exe` (Go build)                             |
| PS Profile      | `~/Documents/TypeScript/` | `Microsoft.TypeScript_profile.ps1`                  |
| Manifest        | Generated                 | `manifest.json` with timestamp and metadata         |

## Import (New PC)

```TypeScript
# 1. Clone the Gentle-Vanguard repo first
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git C:\Workspace_local\gentle-vanguard
cd C:\Workspace_local\gentle-vanguard

# 2. Import profile from external disk
.\scripts\gentle-vanguard\import-profile.ps1 -ExternalDisk D

# 3. Run setup (repos + bootstrap)
.\scripts\gentle-vanguard\setup-multi-machine.ps1

# 4. Restart terminal for PATH changes to take effect
```

### What Import Does

1. Restores Engram DB to `~/.engram/`
2. Restores `master.key` to `<repo>/keys/` (backs up existing)
3. Restores OpenCode config to `~/.config/opencode/`
4. Restores binaries to `~/bin/` and `~/go/bin/`
5. Restores TypeScript profile
6. Adds `~/bin` and `~/go/bin` to user PATH
7. Clones repos + runs bootstrap (if `-SkipBootstrap` not set)

## Post-Import Verification

```TypeScript
# Verify Engram
engram health

# Verify OpenCode
opencode --version

# Verify tools
.\scripts\utilities\install-prerequisites.ps1 -CheckOnly

# Verify Gentle-Vanguard
.\gv.ps1 health
```

## Engram Updates

Engram can be updated at any time:

```TypeScript
# Via gv CLI
.\scripts\utilities\gv.ps1 install-engram

# Or directly
go install github.com/gentle-vanguard/engram/cmd/engram@latest
```

## Cairo/GTK3 (Diagram PNG Export)

For fireworks-tech-graph PNG export, install Cairo:

```TypeScript
.\scripts\utilities\install-cairo.ps1
```

This installs GTK3 Runtime which includes `libcairo-2.dll`. SVG generation works without Cairo; PNG
export requires it.

## Syncing to Gentle-Vanguard-Public

After changes to the private repo that need to be reflected in the public repo:

```TypeScript
# Build protected scripts + sync to public
.\scripts\utilities\DEPLOYMENT\sync-to-public.ps1

# Or skip git push (dry-run)
.\scripts\utilities\DEPLOYMENT\sync-to-public.ps1 -skipPush
```

This copies:

- Bootstrap scripts (plain text)
- Public documentation
- Encrypted `protected/` artifacts
- Public skill stubs
- Compiled executables (`Gentle-Vanguard-Launcher.exe`, `Gentle-Vanguard-Setup.exe`)
- Example configs (no secrets)

## Updating Gentle-Vanguard Itself

```TypeScript
# Pull latest changes
git pull origin develop

# Re-run bootstrap if needed
.\scripts\gentle-vanguard\bootstrap.ps1

# Update prerequisites
.\scripts\utilities\install-prerequisites.ps1

# Verify all tools
.\scripts\utilities\gv.ps1 health
```

## Troubleshooting

| Issue                               | Solution                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `engram health` fails               | Run `engram serve` to start the Engram server                                                                |
| `master.key` not found after import | Check `<repo>/keys/master.key` — re-run import with correct ZIP                                              |
| Protected scripts won't decrypt     | Verify `master.key` matches the one used to encrypt                                                          |
| PATH not updated                    | Restart terminal or run `$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path` |
| OpenCode can't find engram          | Verify `~/bin/engram.exe` exists and PATH includes `~/bin`                                                   |
