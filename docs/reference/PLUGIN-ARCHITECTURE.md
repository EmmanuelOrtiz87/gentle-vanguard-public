# Plugin Architecture Specification

# FF-011: Extensibility contract for third-party plugins

> **Status**: IMPLEMENTED — Gentle-Vanguard v2.9.0  
> **Core scripts**: `src/skills/plugins-discovery.ts`, `plugin-loader.ps1`

<!-- REF-OBSOLETA: src/skills/plugins-discovery.ts no existe (ruta migrada o eliminada) -->

> **Manifest schema**: `config/plugin-manifest-schema.json`  
> **CI validation**: `.github/workflows/autonomous-validation.yml`

## Overview

Standardized interface for third-party plugins with clear contract. Plugins are auto-discovered from
`plugins/`, `~/.gentle-vanguard/plugins/`, and custom paths configured in `config/plugins.json`.
Each plugin provides a `plugin.json` manifest and one or more executable scripts.

## Plugin Interface

### Required Methods

```TypeScript
function Invoke-Plugin {
    param(
        [string]$Command,
        [hashtable]$Parameters
    )

    # Plugin implementation
    return @{
        success = $true
        result = $null
        message = ""
    }
}

function Get-PluginMetadata {
    return @{
        name = "plugin-name"
        version = "1.0.0"
        author = "Author"
        description = "Plugin description"
        minGentle-VanguardVersion = "2.6.0"
        provides = @("capability1", "capability2")
    }
}
```

## Plugin Discovery

Plugins discovered from:

1. `plugins/` directory (built-in)
2. `C:\Users\$env:USERNAME\.gentle-vanguard\plugins\` (user)
3. Configured paths in `config/plugins.json`

## Plugin Loading

```TypeScript
function Load-Plugin {
    param([string]$PluginPath)

    $pluginFile = Join-Path $PluginPath "plugin.ps1"
    if (-not (Test-Path $pluginFile)) { return $null }

    $plugin = . $pluginFile
    $metadata = Get-PluginMetadata

    return @{
        path = $PluginPath
        metadata = $metadata
        instance = $plugin
    }
}
```

## Security

- Plugins run in sandbox (restricted PSSession)
- Require signature validation
- Manifest whitelist approach

## Example Plugin Structure

```
plugins/
  example-plugin/
    plugin.ps1          # Main plugin code
    plugin.json         # Metadata manifest
    README.md           # Documentation
```

## Integration Points

- Hooks: Plugins can register git hooks
- Skills: Plugins can provide custom skills
- Commands: Plugins can add src/cli/gv.ts subcommands
- Tools: Plugins can provide new tool integrations

## Lifecycle

1. Discover → 2. Validate → 3. Load → 4. Initialize → 5. Execute → 6. Cleanup

## Implementation

### Core Scripts

| Script                  | Path                              | Purpose                                                     |
| ----------------------- | --------------------------------- | ----------------------------------------------------------- |
| `plugins-discovery.ps1` | `scripts/utilities/SKILLS-TOOLS/` | Discover, list, validate, and show search paths for plugins |
| `plugin-loader.ps1`     | `scripts/utilities/SKILLS-TOOLS/` | Runtime engine: load, register, invoke plugins              |

### Commands

```TypeScript
# Discover all plugins
.\scripts\utilities\SKILLS-TOOLS\plugins-discovery.ps1 -Action discover

# List plugins with detailed info
.\scripts\utilities\SKILLS-TOOLS\plugins-discovery.ps1 -Action list

# Validate all plugin manifests against schema
.\scripts\utilities\SKILLS-TOOLS\plugins-discovery.ps1 -Action validate

# Show configured plugin search paths
.\scripts\utilities\SKILLS-TOOLS\plugins-discovery.ps1 -Action paths

# Load all plugins into runtime registry
. .\scripts\utilities\SKILLS-TOOLS\plugin-loader.ps1
Initialize-Plugins

# Invoke a plugin command
Invoke-Plugin -PluginName "example-hello-world" -Command "hello" -Parameters @{ Name = "Gentle-Vanguard" }
```

### CI Integration

Plugin manifests are validated in `.github/workflows/autonomous-validation.yml` via the
`Validate Plugins` step, which runs `plugins-discovery.ps1 -Action validate` on every push/PR to
develop/main.

## Example Plugin Structure

```
plugins/
  my-plugin/
    plugin.json         # Manifest (required: name, version, author, description)
    plugin.ps1          # Entry point (default: plugin.ps1, or custom via "main" field)
    README.md           # Documentation (optional)
```

Built-in example: `plugins/example-hello-world/plugin.json` + `hello-world.ps1`
