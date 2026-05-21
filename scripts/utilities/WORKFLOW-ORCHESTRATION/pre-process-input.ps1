<#
.SYNOPSIS
    Pre-process user input — canonical delegation to real implementation
.DESCRIPTION
    Delegates to scripts/utilities/pre-process-input.ps1 (418-line full implementation).
    This file is a compatibility shim for any code that references the WORKFLOW-ORCHESTRATION/ path.
#>
param(
    [string]$UserInput,
    [string]$WorkspaceRoot = "."
)

$realScript = Join-Path $PSScriptRoot '..' 'pre-process-input.ps1'
$realScript = Resolve-Path $realScript -ErrorAction Stop
& $realScript -UserInput $UserInput -WorkspaceRoot $WorkspaceRoot
exit $LASTEXITCODE
