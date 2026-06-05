param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('discover', 'list', 'validate', 'paths')]
    [string]$Action = 'discover',

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = '',

    [switch]$AsJson,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$configPath = Join-Path $repoRoot 'config'
$pluginsConfigPath = Join-Path $configPath 'plugins.json'
$schemaPath = Join-Path $configPath 'plugin-manifest-schema.json'
$pluginDirs = @()

function Write-Info {
    param([string]$Message) if (-not $Quiet) { Write-Host "[INFO] $Message" -ForegroundColor Gray }
}
function Write-OK {
    param([string]$Message) if (-not $Quiet) { Write-Host "[OK] $Message" -ForegroundColor Green }
}
function Write-Warn {
    param([string]$Message) if (-not $Quiet) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
}
function Write-Err {
    param([string]$Message) if (-not $Quiet) { Write-Host "[ERROR] $Message" -ForegroundColor Red }
}

function Get-PluginPaths {
    $paths = @()

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.pluginsPaths) {
                foreach ($p in $config.pluginsPaths) {
                    $resolved = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $repoRoot $p }
                    $paths += $resolved
                }
            }
        } catch {
            Write-Err "Failed to parse plugins.json: $_"
        }
    }

    $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $localPath = Join-Path $homePath '.gentle-vanguard\plugins'
    if (Test-Path $localPath) { $paths += $localPath }

    return $paths | Select-Object -Unique
}

function Get-PluginManifest {
    param([string]$PluginDir)

    $manifestPath = Join-Path $PluginDir 'plugin.json'
    if (-not (Test-Path $manifestPath)) { return $null }

    try {
        $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }

    $hasMain = $manifest.main -and (Test-Path (Join-Path $PluginDir $manifest.main))
    $hasCode = Test-Path (Join-Path $PluginDir 'plugin.ps1')
    $isEnabled = $false

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $isEnabled = $config.enabledPlugins -contains $manifest.name
        } catch { Write-Debug "Exception caught: param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('discover', 'list', 'validate', 'paths')]
    [string]$Action = 'discover',

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = '',

    [switch]$AsJson,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$configPath = Join-Path $repoRoot 'config'
$pluginsConfigPath = Join-Path $configPath 'plugins.json'
$schemaPath = Join-Path $configPath 'plugin-manifest-schema.json'
$pluginDirs = @()

function Write-Info {
    param([string]$Message) if (-not $Quiet) { Write-Host "[INFO] $Message" -ForegroundColor Gray }
}
function Write-OK {
    param([string]$Message) if (-not $Quiet) { Write-Host "[OK] $Message" -ForegroundColor Green }
}
function Write-Warn {
    param([string]$Message) if (-not $Quiet) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
}
function Write-Err {
    param([string]$Message) if (-not $Quiet) { Write-Host "[ERROR] $Message" -ForegroundColor Red }
}

function Get-PluginPaths {
    $paths = @()

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.pluginsPaths) {
                foreach ($p in $config.pluginsPaths) {
                    $resolved = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $repoRoot $p }
                    $paths += $resolved
                }
            }
        } catch {
            Write-Err "Failed to parse plugins.json: $_"
        }
    }

    $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $localPath = Join-Path $homePath '.gentle-vanguard\plugins'
    if (Test-Path $localPath) { $paths += $localPath }

    return $paths | Select-Object -Unique
}

function Get-PluginManifest {
    param([string]$PluginDir)

    $manifestPath = Join-Path $PluginDir 'plugin.json'
    if (-not (Test-Path $manifestPath)) { return $null }

    try {
        $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }

    $hasMain = $manifest.main -and (Test-Path (Join-Path $PluginDir $manifest.main))
    $hasCode = Test-Path (Join-Path $PluginDir 'plugin.ps1')
    $isEnabled = $false

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $isEnabled = $config.enabledPlugins -contains $manifest.name
        } catch { Write-Debug "Exception caught: param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('discover', 'list', 'validate', 'paths')]
    [string]$Action = 'discover',

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = '',

    [switch]$AsJson,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$configPath = Join-Path $repoRoot 'config'
$pluginsConfigPath = Join-Path $configPath 'plugins.json'
$schemaPath = Join-Path $configPath 'plugin-manifest-schema.json'
$pluginDirs = @()

function Write-Info {
    param([string]$Message) if (-not $Quiet) { Write-Host "[INFO] $Message" -ForegroundColor Gray }
}
function Write-OK {
    param([string]$Message) if (-not $Quiet) { Write-Host "[OK] $Message" -ForegroundColor Green }
}
function Write-Warn {
    param([string]$Message) if (-not $Quiet) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
}
function Write-Err {
    param([string]$Message) if (-not $Quiet) { Write-Host "[ERROR] $Message" -ForegroundColor Red }
}

function Get-PluginPaths {
    $paths = @()

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.pluginsPaths) {
                foreach ($p in $config.pluginsPaths) {
                    $resolved = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $repoRoot $p }
                    $paths += $resolved
                }
            }
        } catch {
            Write-Err "Failed to parse plugins.json: $_"
        }
    }

    $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $localPath = Join-Path $homePath '.gentle-vanguard\plugins'
    if (Test-Path $localPath) { $paths += $localPath }

    return $paths | Select-Object -Unique
}

function Get-PluginManifest {
    param([string]$PluginDir)

    $manifestPath = Join-Path $PluginDir 'plugin.json'
    if (-not (Test-Path $manifestPath)) { return $null }

    try {
        $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }

    $hasMain = $manifest.main -and (Test-Path (Join-Path $PluginDir $manifest.main))
    $hasCode = Test-Path (Join-Path $PluginDir 'plugin.ps1')
    $isEnabled = $false

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $isEnabled = $config.enabledPlugins -contains $manifest.name
        } catch { Write-Debug "Exception caught: param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('discover', 'list', 'validate', 'paths')]
    [string]$Action = 'discover',

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = '',

    [switch]$AsJson,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$configPath = Join-Path $repoRoot 'config'
$pluginsConfigPath = Join-Path $configPath 'plugins.json'
$schemaPath = Join-Path $configPath 'plugin-manifest-schema.json'
$pluginDirs = @()

function Write-Info {
    param([string]$Message) if (-not $Quiet) { Write-Host "[INFO] $Message" -ForegroundColor Gray }
}
function Write-OK {
    param([string]$Message) if (-not $Quiet) { Write-Host "[OK] $Message" -ForegroundColor Green }
}
function Write-Warn {
    param([string]$Message) if (-not $Quiet) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
}
function Write-Err {
    param([string]$Message) if (-not $Quiet) { Write-Host "[ERROR] $Message" -ForegroundColor Red }
}

function Get-PluginPaths {
    $paths = @()

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.pluginsPaths) {
                foreach ($p in $config.pluginsPaths) {
                    $resolved = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $repoRoot $p }
                    $paths += $resolved
                }
            }
        } catch {
            Write-Err "Failed to parse plugins.json: $_"
        }
    }

    $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $localPath = Join-Path $homePath '.gentle-vanguard\plugins'
    if (Test-Path $localPath) { $paths += $localPath }

    return $paths | Select-Object -Unique
}

function Get-PluginManifest {
    param([string]$PluginDir)

    $manifestPath = Join-Path $PluginDir 'plugin.json'
    if (-not (Test-Path $manifestPath)) { return $null }

    try {
        $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }

    $hasMain = $manifest.main -and (Test-Path (Join-Path $PluginDir $manifest.main))
    $hasCode = Test-Path (Join-Path $PluginDir 'plugin.ps1')
    $isEnabled = $false

    if (Test-Path $pluginsConfigPath) {
        try {
            $config = Get-Content $pluginsConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $isEnabled = $config.enabledPlugins -contains $manifest.name
        } catch { Write-Output "[PLUGINS] Operation failed, continuing" }
    }

    return @{
        name        = $manifest.name
        version     = $manifest.version
        author      = $manifest.author
        description = $manifest.description
        path        = $PluginDir
        manifest    = $manifestPath
        has_main    = $hasMain
        has_code    = $hasCode
        is_enabled  = $isEnabled
        commands    = if ($manifest.commands) { @($manifest.commands) } else { @() }
        hooks       = if ($manifest.hooks) { @($manifest.hooks) } else { @() }
        provides    = if ($manifest.provides) { @($manifest.provides) } else { @() }
    }
}

function Discover-AllPlugins {
    $plugins = @()
    $paths = Get-PluginPaths

    foreach ($p in $paths) {
        if (-not (Test-Path $p)) { continue }

        $dirs = Get-ChildItem -Path $p -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '^\.' }

        foreach ($dir in $dirs) {
            $plugin = Get-PluginManifest -PluginDir $dir.FullName
            if ($plugin) { $plugins += $plugin }
        }
    }

    return $plugins
}

function Invoke-PluginsDiscover {
    $plugins = Discover-AllPlugins

    if ($AsJson) {
        $result = @{
            timestamp     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins = $plugins.Count
            plugins       = $plugins
        }
        $result | ConvertTo-Json -Depth 4
        return
    }

    Write-Host "`n=== PLUGINS AUTO-DISCOVERY ===" -ForegroundColor Cyan
    Write-Host "Found $($plugins.Count) plugins" -ForegroundColor White
    Write-Host ""

    $enabled = ($plugins | Where-Object { $_.is_enabled }).Count
    $hasCode = ($plugins | Where-Object { $_.has_code }).Count

    Write-Host "Summary:" -ForegroundColor Yellow
    Write-Host "  Total plugins: $($plugins.Count)"
    Write-Host "  Enabled:       $enabled"
    Write-Host "  With code:     $hasCode"
    Write-Host ""

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { '[*]' } else { '[ ]' }
        $hasMain = if ($p.has_main) { '*' } else { ' ' }
        Write-Host "$status $hasMain $($p.name) v$($p.version)" -ForegroundColor Green
        Write-Host "       by $($p.author) - $($p.description)" -ForegroundColor Gray
        if ($p.commands.Count -gt 0) {
            Write-Host "       commands: $($p.commands -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host "       path: $($p.path)" -ForegroundColor DarkGray
    }
}

function Invoke-PluginsList {
    $plugins = Discover-AllPlugins

    Write-Host "`n=== PLUGIN LIST ===" -ForegroundColor Cyan
    Write-Host ""

    if ($plugins.Count -eq 0) {
        Write-Host "No plugins found." -ForegroundColor DarkGray
        return
    }

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { 'ENABLED' } else { 'DISABLED' }
        $statusColor = if ($p.is_enabled) { 'Green' } else { 'DarkGray' }
        Write-Host "[$status] $($p.name) v$($p.version)" -ForegroundColor $statusColor
        Write-Host "       $($p.description)" -ForegroundColor Gray

        if ($p.commands.Count -gt 0) {
            Write-Host "       Commands:" -ForegroundColor Yellow
            foreach ($cmd in $p.commands) {
                $cmdName = if ($cmd -is [PSCustomObject]) { $cmd.name } else { $cmd }
                $cmdDesc = if ($cmd -is [PSCustomObject] -and $cmd.description) { " - $($cmd.description)" } else { '' }
                Write-Host "         - $cmdName$cmdDesc" -ForegroundColor Gray
            }
        }
        if ($p.hooks.Count -gt 0) {
            Write-Host "       Hooks: $($p.hooks -join ', ')" -ForegroundColor DarkGray
        }
        if ($p.provides.Count -gt 0) {
            Write-Host "       Provides: $($p.provides -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host ""
    }
}

function Invoke-PluginsValidate {
    $plugins = Discover-AllPlugins
    $issues = @()

    Write-Host "`n=== PLUGINS VALIDATION ===" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $schemaPath)) {
        Write-Err "Plugin manifest schema not found: $schemaPath"
        return
    }

    $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json

    foreach ($p in $plugins) {
        $manifestPath = Join-Path $p.path 'plugin.json'
        $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8

        foreach ($req in $schema.required) {
            if (-not ($manifestRaw -match "\`"$req\`"")) {
                $issues += @{
                    type     = 'missing-required-field'
                    plugin   = $p.name
                    field    = $req
                    severity = 'error'
                }
            }
        }

        if ($p.name -and $p.name -notmatch '^[a-z0-9-]+$') {
            $issues += @{
                type     = 'invalid-name-format'
                plugin   = $p.name
                severity = 'warning'
            }
        }

        if ($p.has_main -and -not $p.has_code) {
            $issues += @{
                type     = 'main-without-plugin.ps1'
                plugin   = $p.name
                severity = 'warning'
            }
        }
    }

    if ($issues.Count -eq 0) {
        Write-OK "All $($plugins.Count) plugins passed validation"
    } else {
        $errors = @($issues | Where-Object { $_.severity -eq 'error' }).Count
        $warnings = @($issues | Where-Object { $_.severity -eq 'warning' }).Count

        Write-Warn "Validation found issues:"
        Write-Host "  Errors:   $errors" -ForegroundColor Red
        Write-Host "  Warnings: $warnings" -ForegroundColor Yellow

        foreach ($issue in $issues) {
            $color = if ($issue.severity -eq 'error') { 'Red' } else { 'Yellow' }
            $field = if ($issue.field) { "/$($issue.field)" } else { '' }
            Write-Host ("  [{0}] {1}{2}: {3}" -f $issue.severity.ToUpper(), $issue.type, $field, $issue.plugin) -ForegroundColor $color
        }
    }

    if ($AsJson) {
        $result = @{
            timestamp        = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins    = $plugins.Count
            total_issues     = $issues.Count
            errors           = $errors
            warnings         = $warnings
            issues           = $issues
        }
        $result | ConvertTo-Json -Depth 4
    }
}

function Invoke-PluginsPaths {
    $paths = Get-PluginPaths

    Write-Host "`n=== PLUGIN SEARCH PATHS ===" -ForegroundColor Cyan
    Write-Host ""

    foreach ($p in $paths) {
        $exists = Test-Path $p
        $status = if ($exists) { '[EXISTS]' } else { '[MISSING]' }
        $color = if ($exists) { 'Green' } else { 'Yellow' }
        Write-Host "$status $p" -ForegroundColor $color
    }
}

switch ($Action) {
    'discover' { Invoke-PluginsDiscover }
    'list'     { Invoke-PluginsList }
    'validate' { Invoke-PluginsValidate }
    'paths'    { Invoke-PluginsPaths }
}

" }
    }

    return @{
        name        = $manifest.name
        version     = $manifest.version
        author      = $manifest.author
        description = $manifest.description
        path        = $PluginDir
        manifest    = $manifestPath
        has_main    = $hasMain
        has_code    = $hasCode
        is_enabled  = $isEnabled
        commands    = if ($manifest.commands) { @($manifest.commands) } else { @() }
        hooks       = if ($manifest.hooks) { @($manifest.hooks) } else { @() }
        provides    = if ($manifest.provides) { @($manifest.provides) } else { @() }
    }
}

function Discover-AllPlugins {
    $plugins = @()
    $paths = Get-PluginPaths

    foreach ($p in $paths) {
        if (-not (Test-Path $p)) { continue }

        $dirs = Get-ChildItem -Path $p -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '^\.' }

        foreach ($dir in $dirs) {
            $plugin = Get-PluginManifest -PluginDir $dir.FullName
            if ($plugin) { $plugins += $plugin }
        }
    }

    return $plugins
}

function Invoke-PluginsDiscover {
    $plugins = Discover-AllPlugins

    if ($AsJson) {
        $result = @{
            timestamp     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins = $plugins.Count
            plugins       = $plugins
        }
        $result | ConvertTo-Json -Depth 4
        return
    }

    Write-Host "`n=== PLUGINS AUTO-DISCOVERY ===" -ForegroundColor Cyan
    Write-Host "Found $($plugins.Count) plugins" -ForegroundColor White
    Write-Host ""

    $enabled = ($plugins | Where-Object { $_.is_enabled }).Count
    $hasCode = ($plugins | Where-Object { $_.has_code }).Count

    Write-Host "Summary:" -ForegroundColor Yellow
    Write-Host "  Total plugins: $($plugins.Count)"
    Write-Host "  Enabled:       $enabled"
    Write-Host "  With code:     $hasCode"
    Write-Host ""

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { '[*]' } else { '[ ]' }
        $hasMain = if ($p.has_main) { '*' } else { ' ' }
        Write-Host "$status $hasMain $($p.name) v$($p.version)" -ForegroundColor Green
        Write-Host "       by $($p.author) - $($p.description)" -ForegroundColor Gray
        if ($p.commands.Count -gt 0) {
            Write-Host "       commands: $($p.commands -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host "       path: $($p.path)" -ForegroundColor DarkGray
    }
}

function Invoke-PluginsList {
    $plugins = Discover-AllPlugins

    Write-Host "`n=== PLUGIN LIST ===" -ForegroundColor Cyan
    Write-Host ""

    if ($plugins.Count -eq 0) {
        Write-Host "No plugins found." -ForegroundColor DarkGray
        return
    }

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { 'ENABLED' } else { 'DISABLED' }
        $statusColor = if ($p.is_enabled) { 'Green' } else { 'DarkGray' }
        Write-Host "[$status] $($p.name) v$($p.version)" -ForegroundColor $statusColor
        Write-Host "       $($p.description)" -ForegroundColor Gray

        if ($p.commands.Count -gt 0) {
            Write-Host "       Commands:" -ForegroundColor Yellow
            foreach ($cmd in $p.commands) {
                $cmdName = if ($cmd -is [PSCustomObject]) { $cmd.name } else { $cmd }
                $cmdDesc = if ($cmd -is [PSCustomObject] -and $cmd.description) { " - $($cmd.description)" } else { '' }
                Write-Host "         - $cmdName$cmdDesc" -ForegroundColor Gray
            }
        }
        if ($p.hooks.Count -gt 0) {
            Write-Host "       Hooks: $($p.hooks -join ', ')" -ForegroundColor DarkGray
        }
        if ($p.provides.Count -gt 0) {
            Write-Host "       Provides: $($p.provides -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host ""
    }
}

function Invoke-PluginsValidate {
    $plugins = Discover-AllPlugins
    $issues = @()

    Write-Host "`n=== PLUGINS VALIDATION ===" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $schemaPath)) {
        Write-Err "Plugin manifest schema not found: $schemaPath"
        return
    }

    $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json

    foreach ($p in $plugins) {
        $manifestPath = Join-Path $p.path 'plugin.json'
        $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8

        foreach ($req in $schema.required) {
            if (-not ($manifestRaw -match "\`"$req\`"")) {
                $issues += @{
                    type     = 'missing-required-field'
                    plugin   = $p.name
                    field    = $req
                    severity = 'error'
                }
            }
        }

        if ($p.name -and $p.name -notmatch '^[a-z0-9-]+$') {
            $issues += @{
                type     = 'invalid-name-format'
                plugin   = $p.name
                severity = 'warning'
            }
        }

        if ($p.has_main -and -not $p.has_code) {
            $issues += @{
                type     = 'main-without-plugin.ps1'
                plugin   = $p.name
                severity = 'warning'
            }
        }
    }

    if ($issues.Count -eq 0) {
        Write-OK "All $($plugins.Count) plugins passed validation"
    } else {
        $errors = @($issues | Where-Object { $_.severity -eq 'error' }).Count
        $warnings = @($issues | Where-Object { $_.severity -eq 'warning' }).Count

        Write-Warn "Validation found issues:"
        Write-Host "  Errors:   $errors" -ForegroundColor Red
        Write-Host "  Warnings: $warnings" -ForegroundColor Yellow

        foreach ($issue in $issues) {
            $color = if ($issue.severity -eq 'error') { 'Red' } else { 'Yellow' }
            $field = if ($issue.field) { "/$($issue.field)" } else { '' }
            Write-Host ("  [{0}] {1}{2}: {3}" -f $issue.severity.ToUpper(), $issue.type, $field, $issue.plugin) -ForegroundColor $color
        }
    }

    if ($AsJson) {
        $result = @{
            timestamp        = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins    = $plugins.Count
            total_issues     = $issues.Count
            errors           = $errors
            warnings         = $warnings
            issues           = $issues
        }
        $result | ConvertTo-Json -Depth 4
    }
}

function Invoke-PluginsPaths {
    $paths = Get-PluginPaths

    Write-Host "`n=== PLUGIN SEARCH PATHS ===" -ForegroundColor Cyan
    Write-Host ""

    foreach ($p in $paths) {
        $exists = Test-Path $p
        $status = if ($exists) { '[EXISTS]' } else { '[MISSING]' }
        $color = if ($exists) { 'Green' } else { 'Yellow' }
        Write-Host "$status $p" -ForegroundColor $color
    }
}

switch ($Action) {
    'discover' { Invoke-PluginsDiscover }
    'list'     { Invoke-PluginsList }
    'validate' { Invoke-PluginsValidate }
    'paths'    { Invoke-PluginsPaths }
}


" }
    }

    return @{
        name        = $manifest.name
        version     = $manifest.version
        author      = $manifest.author
        description = $manifest.description
        path        = $PluginDir
        manifest    = $manifestPath
        has_main    = $hasMain
        has_code    = $hasCode
        is_enabled  = $isEnabled
        commands    = if ($manifest.commands) { @($manifest.commands) } else { @() }
        hooks       = if ($manifest.hooks) { @($manifest.hooks) } else { @() }
        provides    = if ($manifest.provides) { @($manifest.provides) } else { @() }
    }
}

function Discover-AllPlugins {
    $plugins = @()
    $paths = Get-PluginPaths

    foreach ($p in $paths) {
        if (-not (Test-Path $p)) { continue }

        $dirs = Get-ChildItem -Path $p -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '^\.' }

        foreach ($dir in $dirs) {
            $plugin = Get-PluginManifest -PluginDir $dir.FullName
            if ($plugin) { $plugins += $plugin }
        }
    }

    return $plugins
}

function Invoke-PluginsDiscover {
    $plugins = Discover-AllPlugins

    if ($AsJson) {
        $result = @{
            timestamp     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins = $plugins.Count
            plugins       = $plugins
        }
        $result | ConvertTo-Json -Depth 4
        return
    }

    Write-Host "`n=== PLUGINS AUTO-DISCOVERY ===" -ForegroundColor Cyan
    Write-Host "Found $($plugins.Count) plugins" -ForegroundColor White
    Write-Host ""

    $enabled = ($plugins | Where-Object { $_.is_enabled }).Count
    $hasCode = ($plugins | Where-Object { $_.has_code }).Count

    Write-Host "Summary:" -ForegroundColor Yellow
    Write-Host "  Total plugins: $($plugins.Count)"
    Write-Host "  Enabled:       $enabled"
    Write-Host "  With code:     $hasCode"
    Write-Host ""

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { '[*]' } else { '[ ]' }
        $hasMain = if ($p.has_main) { '*' } else { ' ' }
        Write-Host "$status $hasMain $($p.name) v$($p.version)" -ForegroundColor Green
        Write-Host "       by $($p.author) - $($p.description)" -ForegroundColor Gray
        if ($p.commands.Count -gt 0) {
            Write-Host "       commands: $($p.commands -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host "       path: $($p.path)" -ForegroundColor DarkGray
    }
}

function Invoke-PluginsList {
    $plugins = Discover-AllPlugins

    Write-Host "`n=== PLUGIN LIST ===" -ForegroundColor Cyan
    Write-Host ""

    if ($plugins.Count -eq 0) {
        Write-Host "No plugins found." -ForegroundColor DarkGray
        return
    }

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { 'ENABLED' } else { 'DISABLED' }
        $statusColor = if ($p.is_enabled) { 'Green' } else { 'DarkGray' }
        Write-Host "[$status] $($p.name) v$($p.version)" -ForegroundColor $statusColor
        Write-Host "       $($p.description)" -ForegroundColor Gray

        if ($p.commands.Count -gt 0) {
            Write-Host "       Commands:" -ForegroundColor Yellow
            foreach ($cmd in $p.commands) {
                $cmdName = if ($cmd -is [PSCustomObject]) { $cmd.name } else { $cmd }
                $cmdDesc = if ($cmd -is [PSCustomObject] -and $cmd.description) { " - $($cmd.description)" } else { '' }
                Write-Host "         - $cmdName$cmdDesc" -ForegroundColor Gray
            }
        }
        if ($p.hooks.Count -gt 0) {
            Write-Host "       Hooks: $($p.hooks -join ', ')" -ForegroundColor DarkGray
        }
        if ($p.provides.Count -gt 0) {
            Write-Host "       Provides: $($p.provides -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host ""
    }
}

function Invoke-PluginsValidate {
    $plugins = Discover-AllPlugins
    $issues = @()

    Write-Host "`n=== PLUGINS VALIDATION ===" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $schemaPath)) {
        Write-Err "Plugin manifest schema not found: $schemaPath"
        return
    }

    $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json

    foreach ($p in $plugins) {
        $manifestPath = Join-Path $p.path 'plugin.json'
        $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8

        foreach ($req in $schema.required) {
            if (-not ($manifestRaw -match "\`"$req\`"")) {
                $issues += @{
                    type     = 'missing-required-field'
                    plugin   = $p.name
                    field    = $req
                    severity = 'error'
                }
            }
        }

        if ($p.name -and $p.name -notmatch '^[a-z0-9-]+$') {
            $issues += @{
                type     = 'invalid-name-format'
                plugin   = $p.name
                severity = 'warning'
            }
        }

        if ($p.has_main -and -not $p.has_code) {
            $issues += @{
                type     = 'main-without-plugin.ps1'
                plugin   = $p.name
                severity = 'warning'
            }
        }
    }

    if ($issues.Count -eq 0) {
        Write-OK "All $($plugins.Count) plugins passed validation"
    } else {
        $errors = @($issues | Where-Object { $_.severity -eq 'error' }).Count
        $warnings = @($issues | Where-Object { $_.severity -eq 'warning' }).Count

        Write-Warn "Validation found issues:"
        Write-Host "  Errors:   $errors" -ForegroundColor Red
        Write-Host "  Warnings: $warnings" -ForegroundColor Yellow

        foreach ($issue in $issues) {
            $color = if ($issue.severity -eq 'error') { 'Red' } else { 'Yellow' }
            $field = if ($issue.field) { "/$($issue.field)" } else { '' }
            Write-Host ("  [{0}] {1}{2}: {3}" -f $issue.severity.ToUpper(), $issue.type, $field, $issue.plugin) -ForegroundColor $color
        }
    }

    if ($AsJson) {
        $result = @{
            timestamp        = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins    = $plugins.Count
            total_issues     = $issues.Count
            errors           = $errors
            warnings         = $warnings
            issues           = $issues
        }
        $result | ConvertTo-Json -Depth 4
    }
}

function Invoke-PluginsPaths {
    $paths = Get-PluginPaths

    Write-Host "`n=== PLUGIN SEARCH PATHS ===" -ForegroundColor Cyan
    Write-Host ""

    foreach ($p in $paths) {
        $exists = Test-Path $p
        $status = if ($exists) { '[EXISTS]' } else { '[MISSING]' }
        $color = if ($exists) { 'Green' } else { 'Yellow' }
        Write-Host "$status $p" -ForegroundColor $color
    }
}

switch ($Action) {
    'discover' { Invoke-PluginsDiscover }
    'list'     { Invoke-PluginsList }
    'validate' { Invoke-PluginsValidate }
    'paths'    { Invoke-PluginsPaths }
}

" }
    }

    return @{
        name        = $manifest.name
        version     = $manifest.version
        author      = $manifest.author
        description = $manifest.description
        path        = $PluginDir
        manifest    = $manifestPath
        has_main    = $hasMain
        has_code    = $hasCode
        is_enabled  = $isEnabled
        commands    = if ($manifest.commands) { @($manifest.commands) } else { @() }
        hooks       = if ($manifest.hooks) { @($manifest.hooks) } else { @() }
        provides    = if ($manifest.provides) { @($manifest.provides) } else { @() }
    }
}

function Discover-AllPlugins {
    $plugins = @()
    $paths = Get-PluginPaths

    foreach ($p in $paths) {
        if (-not (Test-Path $p)) { continue }

        $dirs = Get-ChildItem -Path $p -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '^\.' }

        foreach ($dir in $dirs) {
            $plugin = Get-PluginManifest -PluginDir $dir.FullName
            if ($plugin) { $plugins += $plugin }
        }
    }

    return $plugins
}

function Invoke-PluginsDiscover {
    $plugins = Discover-AllPlugins

    if ($AsJson) {
        $result = @{
            timestamp     = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins = $plugins.Count
            plugins       = $plugins
        }
        $result | ConvertTo-Json -Depth 4
        return
    }

    Write-Host "`n=== PLUGINS AUTO-DISCOVERY ===" -ForegroundColor Cyan
    Write-Host "Found $($plugins.Count) plugins" -ForegroundColor White
    Write-Host ""

    $enabled = ($plugins | Where-Object { $_.is_enabled }).Count
    $hasCode = ($plugins | Where-Object { $_.has_code }).Count

    Write-Host "Summary:" -ForegroundColor Yellow
    Write-Host "  Total plugins: $($plugins.Count)"
    Write-Host "  Enabled:       $enabled"
    Write-Host "  With code:     $hasCode"
    Write-Host ""

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { '[*]' } else { '[ ]' }
        $hasMain = if ($p.has_main) { '*' } else { ' ' }
        Write-Host "$status $hasMain $($p.name) v$($p.version)" -ForegroundColor Green
        Write-Host "       by $($p.author) - $($p.description)" -ForegroundColor Gray
        if ($p.commands.Count -gt 0) {
            Write-Host "       commands: $($p.commands -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host "       path: $($p.path)" -ForegroundColor DarkGray
    }
}

function Invoke-PluginsList {
    $plugins = Discover-AllPlugins

    Write-Host "`n=== PLUGIN LIST ===" -ForegroundColor Cyan
    Write-Host ""

    if ($plugins.Count -eq 0) {
        Write-Host "No plugins found." -ForegroundColor DarkGray
        return
    }

    foreach ($p in $plugins | Sort-Object { $_.name }) {
        $status = if ($p.is_enabled) { 'ENABLED' } else { 'DISABLED' }
        $statusColor = if ($p.is_enabled) { 'Green' } else { 'DarkGray' }
        Write-Host "[$status] $($p.name) v$($p.version)" -ForegroundColor $statusColor
        Write-Host "       $($p.description)" -ForegroundColor Gray

        if ($p.commands.Count -gt 0) {
            Write-Host "       Commands:" -ForegroundColor Yellow
            foreach ($cmd in $p.commands) {
                $cmdName = if ($cmd -is [PSCustomObject]) { $cmd.name } else { $cmd }
                $cmdDesc = if ($cmd -is [PSCustomObject] -and $cmd.description) { " - $($cmd.description)" } else { '' }
                Write-Host "         - $cmdName$cmdDesc" -ForegroundColor Gray
            }
        }
        if ($p.hooks.Count -gt 0) {
            Write-Host "       Hooks: $($p.hooks -join ', ')" -ForegroundColor DarkGray
        }
        if ($p.provides.Count -gt 0) {
            Write-Host "       Provides: $($p.provides -join ', ')" -ForegroundColor DarkGray
        }
        Write-Host ""
    }
}

function Invoke-PluginsValidate {
    $plugins = Discover-AllPlugins
    $issues = @()

    Write-Host "`n=== PLUGINS VALIDATION ===" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $schemaPath)) {
        Write-Err "Plugin manifest schema not found: $schemaPath"
        return
    }

    $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json

    foreach ($p in $plugins) {
        $manifestPath = Join-Path $p.path 'plugin.json'
        $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8

        foreach ($req in $schema.required) {
            if (-not ($manifestRaw -match "\`"$req\`"")) {
                $issues += @{
                    type     = 'missing-required-field'
                    plugin   = $p.name
                    field    = $req
                    severity = 'error'
                }
            }
        }

        if ($p.name -and $p.name -notmatch '^[a-z0-9-]+$') {
            $issues += @{
                type     = 'invalid-name-format'
                plugin   = $p.name
                severity = 'warning'
            }
        }

        if ($p.has_main -and -not $p.has_code) {
            $issues += @{
                type     = 'main-without-plugin.ps1'
                plugin   = $p.name
                severity = 'warning'
            }
        }
    }

    if ($issues.Count -eq 0) {
        Write-OK "All $($plugins.Count) plugins passed validation"
    } else {
        $errors = @($issues | Where-Object { $_.severity -eq 'error' }).Count
        $warnings = @($issues | Where-Object { $_.severity -eq 'warning' }).Count

        Write-Warn "Validation found issues:"
        Write-Host "  Errors:   $errors" -ForegroundColor Red
        Write-Host "  Warnings: $warnings" -ForegroundColor Yellow

        foreach ($issue in $issues) {
            $color = if ($issue.severity -eq 'error') { 'Red' } else { 'Yellow' }
            $field = if ($issue.field) { "/$($issue.field)" } else { '' }
            Write-Host ("  [{0}] {1}{2}: {3}" -f $issue.severity.ToUpper(), $issue.type, $field, $issue.plugin) -ForegroundColor $color
        }
    }

    if ($AsJson) {
        $result = @{
            timestamp        = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            total_plugins    = $plugins.Count
            total_issues     = $issues.Count
            errors           = $errors
            warnings         = $warnings
            issues           = $issues
        }
        $result | ConvertTo-Json -Depth 4
    }
}

function Invoke-PluginsPaths {
    $paths = Get-PluginPaths

    Write-Host "`n=== PLUGIN SEARCH PATHS ===" -ForegroundColor Cyan
    Write-Host ""

    foreach ($p in $paths) {
        $exists = Test-Path $p
        $status = if ($exists) { '[EXISTS]' } else { '[MISSING]' }
        $color = if ($exists) { 'Green' } else { 'Yellow' }
        Write-Host "$status $p" -ForegroundColor $color
    }
}

switch ($Action) {
    'discover' { Invoke-PluginsDiscover }
    'list'     { Invoke-PluginsList }
    'validate' { Invoke-PluginsValidate }
    'paths'    { Invoke-PluginsPaths }
}



