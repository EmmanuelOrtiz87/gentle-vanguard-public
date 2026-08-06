# GitHub Runner Setup

This guide defines the portable setup for an optional self-hosted GitHub Actions runner.

## Goal

Use a local runner on trusted machines without hardcoding secrets in the repository, and keep the
setup safe to clone on another machine.

## What This Setup Does

1. Keeps the runner configuration in a tracked example file: `config/github-runner.example.json`.
2. Expects the real machine-specific file in `config/github-runner.local.json`.
3. Installs and configures the runner with `src/deployment/install-github-runner.ts`.
4. Leaves public-repo workflows operable even if no self-hosted runner is installed.

## Security Rule

Do not route `pull_request_target` or any untrusted fork-triggered workflow to a self-hosted runner
on a public repository. Keep those jobs on GitHub-hosted infrastructure.

## Recommended Files

1. Copy `config/github-runner.example.json` to `config/github-runner.local.json`.
2. Fill in only machine-specific values if you want to override the defaults.

## Installation

### Option 1: Explicit install

```TypeScript
.\scripts\utilities\DEPLOYMENT\install-github-runner.ps1 -ConfigPath .\config\github-runner.local.json
```

### Option 2: Install during bootstrap

```TypeScript
.\scripts\gentle-vanguard\bootstrap.ps1 -InstallGitHubRunner -GitHubRunnerConfigPath .\config\github-runner.local.json
```

## Registration Token

You need one of these:

1. A one-time registration token passed with `-RegistrationToken`.
2. `gh` authenticated with repository admin rights so the script can request the token.

## Portability Rules

1. Never commit `config/github-runner.local.json`.
2. Keep the example file generic and secret-free.
3. Use the same script on every machine; only the local config changes.

## gentle-vanguard-public Alignment

The public sync bundle includes:

1. `src/bootstrap.ts`
2. `scripts/gentle-vanguard/bootstrap-machine.ps1`
3. `src/deployment/install-github-runner.ts`
4. `config/workspace.example.json`
5. `config/workspace.portable.example.json`
6. `config/github-runner.example.json`

That keeps the public repository bootstrappable on a new machine without exposing secrets.

## Expected Outcome

With the repository public, GitHub-hosted workflows can keep running without the private-minutes
problem. The self-hosted runner becomes an optional performance and control upgrade, not a blocker.
