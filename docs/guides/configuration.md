# Workspace Configuration

This file describes the recommended schema for `config/workspace.config.json`.

## Main Fields

- `workspaceName`: human-readable workspace name.
- `dataRoot`: directory where local data lives.
- `toolsRoot`: directory for sibling tools if desired.
- `projectsRoot`: directory where new projects are created.
- `projectTemplate`: path to the base template.
- `projectDefaults`: default values for new projects.
- `projectKinds`: list of supported project kinds.
- `tools`: list of external tools to verify or install.

## projectDefaults

- `repositoryMode`: `template` or `clone`
- `kind`: default project kind, for example `service`, `cli`, or `library`
- `preset`: suggested starting name, for example `default`, `dashboard`, `api`, `mcp`, or `library`
- `architecture`: suggested base style, for example `layered`, `clean`, or `feature`
- `profile`: suggested functional profile, for example `general`, `web`, `backend`, or `automation`
- `aiModelMode`: suggested AI mode, for example `none`, `local`, or `cloud`
- `aiModelProvider`: optional provider name such as `ollama`, `openai`, `anthropic`, or `google`
- `aiModelName`: optional model identifier
- `aiModelEndpoint`: optional endpoint or base URL
- `aiModelNotes`: optional free-form notes for setup, fallback, or validation
- `repoUrl`: default repository for cloning
- `cloneDir`: suggested clone directory
- `buildCommand`: suggested build command
- `testCommand`: suggested test command
- `postInstallCommand`: action after creation

## tools

Each tool can define:

- `name`
- `checkCommand`
- `checkPath`
- `requires`
- `install.windows`
- `install.linux`
- `install.macos`

Use `checkPath` when a tool is better validated by an existing directory than by a command in
`PATH`. Use `requires` to declare installation prerequisites such as `git`, `go`, or `bash`.

## Runtime State

- `dataRoot` is the base used by launchers to create isolated state.
- `scripts/run-engram.ps1` and `scripts/run-engram.sh` derive `ENGRAM_DATA_DIR` from `dataRoot` and
<!-- REF-OBSOLETA: scripts/run-engram.ps1 no tiene equivalente TS (migración PS1→TS) -->
  create a dedicated Engram subdirectory.
- Changing `dataRoot` also changes where the launcher stores the local database.

## Scaffolding Defaults

- `projectDefaults.kind`, `preset`, `architecture`, and `profile` are safe values that the scaffold
  can use without asking the user.
- `projectDefaults.aiModelMode`, `aiModelProvider`, `aiModelName`, `aiModelEndpoint`, and
  `aiModelNotes` let the scaffold capture AI intent without forcing a provider.
- If the user already defined the structure, command-line parameters take priority over the config.
- If there is no clear choice, the flow keeps the defaults and leaves the decisión open for the
  moment with more context.

## Maintenance Rule

The configuration describes behavior; it should not encode internal changes to external tools.

## Included Examples

- `config/workspace.example.json`: minimal and easy to adapt.
- `config/workspace.portable.example.json`: example with workspace-relative paths and concrete
  commands per platform.
- `config/workspace.config.json`: ready-to-use base that can be adjusted without starting from
  scratch.
