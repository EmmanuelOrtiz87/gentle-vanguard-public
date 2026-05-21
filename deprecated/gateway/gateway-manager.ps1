param(
  [ValidateSet('start','stop','restart','status','install','uninstall','process','send','agent','schedule','setup','logs','tools','rpc')]
  [string]$Command,
  [string]$ConfigPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'config\gateway.json')
)

$sendPlatform = $args[0]
$sendTo = $args[1]
$sendText = if ($args.Count -ge 3) { $args[2..($args.Count-1)] -join ' ' } else { '' }

$agentSubCmd = $args[0]
$scheduleSubCmd = $args[0]
$scheduleArgs = if ($args.Count -ge 2) { $args[1..($args.Count-1)] } else { @() }

$ErrorActionPreference = 'Stop'
$GatewayDir = $PSScriptRoot
$RootDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$GwPidFile = Join-Path $RootDir '.session\gateway\gateway.pid'
$LogDir = Join-Path $RootDir '.session\gateway\logs'
$InboxDir = Join-Path $RootDir '.session\gateway\inbox'
$OutboxDir = Join-Path $RootDir '.session\gateway\outbox'
$GatewayLog = Join-Path $RootDir '.session\gateway\gateway.log'
$NodeBin = (Get-Command node).Source

function Ensure-Dirs {
  @($LogDir, $InboxDir, $OutboxDir) | ForEach-Object {
    New-Item -ItemType Directory -Path $_ -Force | Out-Null
  }
}

function Get-GwPid {
  if (Test-Path $GwPidFile) {
    try { return [int](Get-Content $GwPidFile -Raw).Trim() } catch { }
  }
  return $null
}

function Test-Running {
  $gwPidValue = Get-GwPid
  if (-not $gwPidValue) { return $false }
  try {
    $proc = Get-Process -Id $gwPidValue -ErrorAction Stop
    return $proc.ProcessName -like '*node*'
  } catch { return $false }
}

function Get-Status {
  $running = Test-Running
  $config = $null
  if (Test-Path $ConfigPath) {
    try { $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { }
  }
  $stats = @{
    running = $running
    pid = Get-GwPid
    configEnabled = if ($config) { $config.enabled } else { $false }
    platforms = @{}
    inboxCount = 0
    outboxCount = 0
  }
  if ($config?.platforms) {
    $config.platforms.PSObject.Properties | ForEach-Object {
      $stats.platforms[$_.Name] = $_.Value.enabled
    }
  }
  if (Test-Path $InboxDir) { $stats.inboxCount = @(Get-ChildItem $InboxDir -Filter '*.json').Count }
  if (Test-Path $OutboxDir) { $stats.outboxCount = @(Get-ChildItem $OutboxDir -Filter '*.json').Count }
  return $stats
}

function Start-Gateway {
  if (Test-Running) { Write-Host 'Gateway already running (PID: ' (Get-GwPid) ')'; return }
  Ensure-Dirs
  $nodeArgs = @(Join-Path $GatewayDir 'gateway.js')
  $logFile = $GatewayLog
  $proc = Start-Process -FilePath $NodeBin -ArgumentList $nodeArgs -NoNewWindow -PassThru `
    -RedirectStandardOutput $logFile -RedirectStandardError ($logFile -replace '\.log$', '-err.log')
  Start-Sleep -Seconds 2
  $proc | Out-Null
  Write-Host "Gateway started (PID: $($proc.Id))"
  $proc.Id | Out-File -FilePath $GwPidFile -Encoding ascii
  if (-not $?) { Write-Host 'ERROR: gateway failed to start' -ForegroundColor Red; return }
}

function Stop-Gateway {
  $gwPid = Get-GwPid
  if (-not $gwPid) { Write-Host 'Gateway not running'; return }
  try {
    Stop-Process -Id $gwPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Remove-Item $GwPidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Gateway stopped (PID: $gwPid)"
  } catch {
    Write-Host "ERROR stopping gateway: $_" -ForegroundColor Red
  }
}

function Install-Service {
  $taskName = 'GentleVanguardGateway'
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Scheduled task '$taskName' already exists. Use 'uninstall' first." -ForegroundColor Yellow
    return
  }
  $psPath = (Get-Command pwsh).Source
  $action = New-ScheduledTaskAction -Execute $psPath -Argument "-NoProfile -File `"$GatewayDir\gateway-manager.ps1`" -Command start"
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
  Write-Host "Service '$taskName' installed. Gateway will start automatically at login."
}

function Uninstall-Service {
  $taskName = 'GentleVanguardGateway'
  Stop-Gateway
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Service '$taskName' uninstalled."
}

function Process-Inbox {
  $files = @(Get-ChildItem $InboxDir -Filter '*.json' | Sort-Object LastWriteTime)
  if ($files.Count -eq 0) { Write-Host 'No pending messages.'; return }
  Write-Host "`n=== Pending Gateway Messages ($($files.Count)) ===" -ForegroundColor Cyan
  foreach ($f in $files) {
    $msg = Get-Content $f.FullName -Raw | ConvertFrom-Json
    if (-not $msg.processed) {
      Write-Host "`n[$($msg.platform)] $($msg.ts)" -ForegroundColor Yellow
      Write-Host "  From: $($msg.from)" -ForegroundColor Green
      Write-Host "  Text: $($msg.text)" -ForegroundColor White
      $msg.processed = $true
      $msg | ConvertTo-Json | Set-Content $f.FullName -Encoding utf8
    }
  }
  Write-Host "`n=== End of Messages ===" -ForegroundColor Cyan
}

function Show-Tools {
  Write-Host "`n=== Gateway Agent Tools ===" -ForegroundColor Cyan
  Write-Host "`nExecution & Files:" -ForegroundColor Yellow
  Write-Host "  execute_command   - Run any PowerShell/shell command"
  Write-Host "  read_file         - Read file contents (configs, logs, SKILL.md)"
  Write-Host "  write_file        - Write content to a file (creates dirs)"
  Write-Host "  search_files      - Regex search across the codebase"
  Write-Host "  list_directory    - Explore project structure"
  Write-Host "  git_command       - Git operations (status, diff, commit, etc.)"
  Write-Host "`nGateway & Agent:" -ForegroundColor Yellow
  Write-Host "  gateway_status    - Show gateway state (running, platforms, counts)"
  Write-Host "  process_inbox     - Process pending inbox messages"
  Write-Host "  list_schedules    - List active cron scheduler tasks"
  Write-Host "  load_skill        - Load a skill (skills/<name>/SKILL.md)"
  Write-Host "  session_info      - Show current session context"
  Write-Host "`nCommunication:" -ForegroundColor Yellow
  Write-Host "  send_message      - Send final response to user's platform"
  Write-Host "`nUsage: The ReAct agent calls these tools automatically based on user intent."
}

switch ($Command) {
  'status' {
    $s = Get-Status
    Write-Host "Gateway Status: $(if ($s.running) { 'RUNNING' } else { 'STOPPED' })" -ForegroundColor $(if ($s.running) { 'Green' } else { 'Red' })
    Write-Host "PID: $($s.pid)"
    Write-Host "Config enabled: $($s.configEnabled)"
    Write-Host "Platforms:"
    $s.platforms.GetEnumerator() | Sort-Object Name | ForEach-Object {
      Write-Host "  $($_.Key): $(if ($_.Value) { 'ENABLED' } else { 'disabled' })"
    }
    Write-Host "Inbox: $($s.inboxCount) pending"
    Write-Host "Outbox: $($s.outboxCount) pending"
  }
  'start' { Start-Gateway }
  'stop' { Stop-Gateway }
  'restart' { Stop-Gateway; Start-Sleep 1; Start-Gateway }
  'install' { Install-Service }
  'uninstall' { Uninstall-Service }
  'process' { Process-Inbox }
  'logs' {
    if (Test-Path $GatewayLog) { Get-Content $GatewayLog -Tail 50 }
    else { Write-Host 'No gateway logs found.' }
  }
  'send' {
    if (-not $sendPlatform -or -not $sendTo -or -not $sendText) {
      Write-Host 'Usage: .\gateway-manager.ps1 -Command send [platform] [to] [message]' -ForegroundColor Yellow
      Write-Host '  platform: telegram | discord | whatsapp'
      Write-Host '  to: chatId (Telegram), channelId (Discord), or phone@c.us (WhatsApp)'
      Write-Host '  Example: send whatsapp 541155512345@c.us Hola desde GV'
      exit 1
    }
    $outbox = Join-Path $RootDir '.session\gateway\outbox'
    New-Item -ItemType Directory -Path $outbox -Force | Out-Null
    $id = "send-$(Get-Date -Format 'yyyyMMddHHmmss')-$([System.Guid]::NewGuid().ToString().Substring(0,8))"
    $entry = @{ platform = $sendPlatform; to = $sendTo; text = $sendText } | ConvertTo-Json
    $entry | Set-Content (Join-Path $outbox "$id.json") -Encoding utf8
    Write-Host "Message queued for $sendPlatform -> $sendTo" -ForegroundColor Green
  }
  'agent' {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    switch ($agentSubCmd) {
      'status' {
        Write-Host "Agent: $(if ($config.agent.enabled) { 'ENABLED' } else { 'disabled' })" -ForegroundColor $(if ($config.agent.enabled) { 'Green' } else { 'Red' })
        Write-Host "AI: $(if ($config.ai.enabled) { 'ENABLED' } else { 'disabled' })"
        Write-Host "Provider: $($config.ai.provider)"
        Write-Host "Model: $($config.ai.model)"
      }
      'on' {
        $config.agent.enabled = $true
        $config | ConvertTo-Json -Depth 5 | Set-Content $ConfigPath -Encoding utf8
        Write-Host 'Agent enabled. Restart gateway to apply.' -ForegroundColor Green
      }
      'off' {
        $config.agent.enabled = $false
        $config | ConvertTo-Json -Depth 5 | Set-Content $ConfigPath -Encoding utf8
        Write-Host 'Agent disabled. Restart gateway to apply.' -ForegroundColor Yellow
      }
      'ai-on' {
        $config.ai.enabled = $true
        $config | ConvertTo-Json -Depth 5 | Set-Content $ConfigPath -Encoding utf8
        Write-Host 'AI auto-response enabled. Restart gateway to apply.' -ForegroundColor Green
      }
      'ai-off' {
        $config.ai.enabled = $false
        $config | ConvertTo-Json -Depth 5 | Set-Content $ConfigPath -Encoding utf8
        Write-Host 'AI auto-response disabled.' -ForegroundColor Yellow
      }
      default {
        Write-Host 'Usage: .\gateway-manager.ps1 -Command agent [subcommand]' -ForegroundColor Yellow
        Write-Host '  status   Show agent/AI status'
        Write-Host '  on       Enable agent processing'
        Write-Host '  off      Disable agent processing'
        Write-Host '  ai-on    Enable AI auto-response'
        Write-Host '  ai-off   Disable AI auto-response'
      }
    }
  }
  'schedule' {
    $scheduleFile = Join-Path $RootDir '.session\gateway\schedules.json'
    switch ($scheduleSubCmd) {
      'list' {
        if (Test-Path $scheduleFile) {
          $tasks = Get-Content $scheduleFile -Raw | ConvertFrom-Json
          if ($tasks.Count -eq 0) { Write-Host 'No scheduled tasks.'; return }
          Write-Host "`n=== Scheduled Tasks ===" -ForegroundColor Cyan
          foreach ($t in $tasks) {
            $status = if ($t.enabled) { 'ON' } else { 'OFF' }
            Write-Host "$status [$($t.id)] $($t.description) -- cron: $($t.cron) -> $($t.platform)"
          }
        } else { Write-Host 'No scheduled tasks.' }
      }
      'add' {
        if ($scheduleArgs.Count -lt 3) {
          Write-Host 'Usage: schedule add [cron] [platform] [description]' -ForegroundColor Yellow
          Write-Host '  cron: "*/5 * * * *" (every 5 min), "0 9 * * 1-5" (weekdays 9am)'
          Write-Host '  platform: whatsapp | telegram'
          Write-Host 'Example: schedule add "0 9 * * *" whatsapp Daily morning report'
          exit 1
        }
        $cron = $scheduleArgs[0]
        $platformArg = $scheduleArgs[1]
        $desc = $scheduleArgs[2..($scheduleArgs.Count-1)] -join ' '
        $nodeExe = (Get-Command node).Source
        $result = & $nodeExe -e "
          import('${GatewayDir}/agent/scheduler.js').then(m => {
            const s = new m.Scheduler({}, () => {});
            const t = s.addTask('$desc', '$cron', 'report', '$platformArg', '');
            console.log(JSON.stringify(t));
          })
        " 2>&1
        Write-Host "Task added: $desc (cron: $cron -> $platformArg)" -ForegroundColor Green
      }
      'remove' {
        if ($scheduleArgs.Count -lt 1) { Write-Host 'Usage: schedule remove [task-id]' -ForegroundColor Yellow; exit 1 }
        $id = $scheduleArgs[0]
        if (Test-Path $scheduleFile) {
          $tasks = Get-Content $scheduleFile -Raw | ConvertFrom-Json | Where-Object { $_.id -ne $id }
          $tasks | ConvertTo-Json -Depth 5 | Set-Content $scheduleFile -Encoding utf8
          Write-Host "Task $id removed." -ForegroundColor Yellow
        }
      }
      default {
        Write-Host 'Usage: .\gateway-manager.ps1 -Command schedule [subcommand]' -ForegroundColor Yellow
        Write-Host '  list              Show all scheduled tasks'
        Write-Host '  add [cron] [platform] [desc]   Add a scheduled task'
        Write-Host '  remove [id]       Remove a task by ID'
      }
    }
  }
  'rpc' {
    $rpcSubCmd = $args[0]
    $rpcPort = if ($args[1]) { $args[1] } else { 8732 }
    switch ($rpcSubCmd) {
      'start' {
        $rpcLog = Join-Path $RootDir '.session\rpc-logs\rpc-server.log'
        $proc = Start-Process -FilePath $NodeBin -ArgumentList @(Join-Path $GatewayDir '..\rpc\rpc-server.js', "--port", "$rpcPort") -NoNewWindow -PassThru `
          -RedirectStandardOutput $rpcLog -RedirectStandardError ($rpcLog -replace '\.log$', '-err.log')
        Start-Sleep -Seconds 1
        Write-Host "RPC server started (PID: $($proc.Id), port: $rpcPort)" -ForegroundColor Green
        $proc.Id | Out-File -FilePath (Join-Path $RootDir '.session\gateway\rpc.pid') -Encoding ascii
      }
      'stop' {
        $rpcPidFile = Join-Path $RootDir '.session\gateway\rpc.pid'
        if (Test-Path $rpcPidFile) {
          $pid = Get-Content $rpcPidFile -Raw
          Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
          Remove-Item $rpcPidFile -Force -ErrorAction SilentlyContinue
          Write-Host "RPC server stopped (PID: $pid)" -ForegroundColor Yellow
        } else { Write-Host 'RPC server not running' -ForegroundColor Yellow }
      }
      'status' {
        try {
          $res = Invoke-RestMethod -Uri "http://localhost:$rpcPort/health" -TimeoutSec 3
          Write-Host "RPC: RUNNING (port $rpcPort, $($res.tools.Count) tools, $($res.requestCount) requests)" -ForegroundColor Green
        } catch { Write-Host 'RPC: STOPPED' -ForegroundColor Red }
      }
      default {
        Write-Host 'Usage: .\gateway-manager.ps1 -Command rpc [start|stop|status] [port]' -ForegroundColor Yellow
      }
    }
  }
  'tools' { Show-Tools }
  'setup' {
    Write-Host "=== Gateway Setup Guide ===" -ForegroundColor Cyan
    Write-Host "`n1. Edit config: $ConfigPath"
    Write-Host "   - Set `"enabled`": true"
    Write-Host "`n2. Telegram:"
    Write-Host "   - Chat @BotFather on Telegram, create bot, get token"
    Write-Host "   - Set telegram.token in config"
    Write-Host "   - Set telegram.allowedChatIds (your chat ID)"
    Write-Host "`n3. Discord:"
    Write-Host "   - Go to https://discord.com/developers/applications"
    Write-Host "   - New Application -> Bot -> Copy token"
    Write-Host "   - Enable Message Content Intent"
    Write-Host "   - Set discord.token and allowedChannelIds"
    Write-Host "`n4. WhatsApp:"
    Write-Host "   - Set whatsapp.enabled: true"
    Write-Host "   - Run 'gateway-manager.ps1 -Command start'"
    Write-Host "   - Scan QR code shown in terminal"
    Write-Host "`n5. Start gateway:"
    Write-Host "   .\scripts\gateway\gateway-manager.ps1 -Command start"
    Write-Host "`n6. (Optional) Install as Windows service:"
    Write-Host "   .\scripts\gateway\gateway-manager.ps1 -Command install"
    Write-Host "`n7. Check messages:"
    Write-Host "   .\scripts\gateway\gateway-manager.ps1 -Command process"
  }
  default {
    Write-Host "Usage: .\scripts\gateway\gateway-manager.ps1 -Command [command]" -ForegroundColor Yellow
    Write-Host "Commands: start | stop | restart | status | install | uninstall | process | send | agent | schedule | logs | setup | tools | rpc"
  }
}
