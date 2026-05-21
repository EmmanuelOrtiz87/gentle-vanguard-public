# gateway.tests.ps1
# Unit tests for multi-platform gateway

$script:rootDir = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
$script:gatewayDir = Join-Path $script:rootDir "scripts\gateway"
$script:configPath = Join-Path $script:rootDir "config\gateway.json"
$script:managerScript = Join-Path $script:gatewayDir "gateway-manager.ps1"

Describe 'Gateway Manager Script' {
    It 'exists' {
        Test-Path $script:managerScript | Should Be $true
    }

    It 'parses without syntax errors' {
        $errors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($script:managerScript, [ref]$null, [ref]$errors)
        ($errors | ForEach-Object { $_.Message }) -join ';' | Should Be ''
    }

    It 'shows status without errors' {
        $null = & $script:managerScript -Command status 2>&1
        $? | Should Be $true
    }
}

Describe 'Gateway Config' {
    It 'exists' {
        Test-Path $script:configPath | Should Be $true
    }

    It 'parses as valid JSON' {
        $config = Get-Content $script:configPath -Raw | ConvertFrom-Json
        ($config.enabled -is [bool]) | Should Be $true
        ($null -ne $config.platforms) | Should Be $true
    }

    It 'has telegram section' {
        $config = Get-Content $script:configPath -Raw | ConvertFrom-Json
        ($null -ne $config.platforms.telegram) | Should Be $true
    }

    It 'has discord section' {
        $config = Get-Content $script:configPath -Raw | ConvertFrom-Json
        ($null -ne $config.platforms.discord) | Should Be $true
    }

    It 'has whatsapp section' {
        $config = Get-Content $script:configPath -Raw | ConvertFrom-Json
        ($null -ne $config.platforms.whatsapp) | Should Be $true
    }
}

Describe 'Gateway JS Syntax' {
    It 'gateway.js has no syntax errors' {
        $gwJs = Join-Path $script:gatewayDir "gateway.js"
        Test-Path $gwJs | Should Be $true
        $result = & node --check $gwJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'telegram adapter has no syntax errors' {
        $tgJs = Join-Path $script:gatewayDir "platforms\telegram.js"
        Test-Path $tgJs | Should Be $true
        $result = & node --check $tgJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'discord adapter has no syntax errors' {
        $dcJs = Join-Path $script:gatewayDir "platforms\discord.js"
        Test-Path $dcJs | Should Be $true
        $result = & node --check $dcJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'whatsapp adapter has no syntax errors' {
        $waJs = Join-Path $script:gatewayDir "platforms\whatsapp.js"
        Test-Path $waJs | Should Be $true
        $result = & node --check $waJs 2>&1
        $LASTEXITCODE | Should Be 0
    }
}

Describe 'Gateway Inbox/Outbox' {
    It 'creates inbox directory' {
        $d = Join-Path $script:rootDir ".session\gateway\inbox"
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Test-Path $d | Should Be $true
    }

    It 'creates outbox directory' {
        $d = Join-Path $script:rootDir ".session\gateway\outbox"
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Test-Path $d | Should Be $true
    }
}

Describe 'GV Command Integration' {
    It 'gv.ps1 ValidateSet includes gateway' {
        $gvScript = Join-Path $script:rootDir "scripts\utilities\WORKFLOW-ORCHESTRATION\gv.ps1"
        Test-Path $gvScript | Should Be $true
        $line = Get-Content $gvScript | Select-String "ValidateSet" | Select-Object -First 1
        $line.Line | Should Match "gateway"
    }
}

Describe 'Gateway Skill' {
    It 'SKILL.md exists' {
        $skillMd = Join-Path $script:rootDir "skills\multi-platform-gateway\SKILL.md"
        Test-Path $skillMd | Should Be $true
    }
}

Describe 'Gateway Node Dependencies' {
    It 'package.json exists' {
        $pkg = Join-Path $script:gatewayDir "package.json"
        Test-Path $pkg | Should Be $true
    }

    It 'node_modules is installed' {
        Test-Path (Join-Path $script:gatewayDir "node_modules") | Should Be $true
    }
}

Describe 'Gateway Agent Module' {
    It 'agent.js has valid syntax' {
        $agentJs = Join-Path $script:gatewayDir "agent\agent.js"
        Test-Path $agentJs | Should Be $true
        $result = & node --check $agentJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'tools.js has valid syntax' {
        $toolsJs = Join-Path $script:gatewayDir "agent\tools.js"
        Test-Path $toolsJs | Should Be $true
        $result = & node --check $toolsJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'context.js has valid syntax' {
        $ctxJs = Join-Path $script:gatewayDir "agent\context.js"
        Test-Path $ctxJs | Should Be $true
        $result = & node --check $ctxJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'system-prompt.js has valid syntax' {
        $spJs = Join-Path $script:gatewayDir "agent\system-prompt.js"
        Test-Path $spJs | Should Be $true
        $result = & node --check $spJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'scheduler.js has valid syntax' {
        $schedJs = Join-Path $script:gatewayDir "agent\scheduler.js"
        Test-Path $schedJs | Should Be $true
        $result = & node --check $schedJs 2>&1
        $LASTEXITCODE | Should Be 0
    }

    It 'gateway-manager ValidateSet includes agent and schedule' {
        $content = Get-Content $script:managerScript -Raw
        $content | Should Match "'agent'"
        $content | Should Match "'schedule'"
    }

    It 'config has agent and ai sections' {
        $config = Get-Content $script:configPath -Raw | ConvertFrom-Json
        ($null -ne $config.agent) | Should Be $true
        ($null -ne $config.ai) | Should Be $true
    }
}
