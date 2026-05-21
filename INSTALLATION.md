# Gentle-Vanguard Installation Guide

## Requirements

| Requirement | Version | Required | Notes |
|-------------|---------|----------|-------|
| PowerShell | 7+ | Yes | Core runtime |
| Git | 2.30+ | Yes | Version control |
| Windows | 10/11 | Optional | Full support |
| macOS | 13+ | Optional | Full support |
| Linux | Ubuntu 22.04+ | Optional | Full support |
| RAM | 4 GB | Recommended | 8 GB recommended |

## Windows — One-Click Installer

1. Download [Gentle-Vanguard.exe](Gentle-Vanguard.exe)
2. Run as Administrator
3. Verify: `gv health`

## Any Platform — Git Clone

```powershell
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git
cd gentle-vanguard-public
pwsh -File scripts/gentle-vanguard/bootstrap.ps1
```

## Post-Installation

```powershell
# Verify installation
gv health

# Start a session
.\scripts\utilities\session-autostart.cmd
```

## Getting Started

See [docs/getting-started/](docs/getting-started/) for tutorials and walkthroughs.
