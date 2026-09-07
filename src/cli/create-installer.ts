#!/usr/bin/env node

/**
 * create-installer.ts — Builds the Gentle-Vanguard Windows installer (NSIS).
 *
 * Design (aligned with config/installer-manifest.json installerPolicy):
 *   - mode: bootstrapper — the installer ships the executable distribution and
 *     delegates dependency installation + verification to install:bootstrap.
 *   - neverBundlesSecrets: no keys, no encrypted payloads, no master.key.
 *   - Version is read from package.json (single source of truth).
 *
 * Usage:
 *   npx tsx src/cli/create-installer.ts              # Full build
 *   npx tsx src/cli/create-installer.ts --dry-run    # Stage + generate NSI only
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';
import { stagePayload } from '../installer/payload.js';

const ROOT = resolve(process.cwd());
const BUILD_DIR = join(ROOT, 'build');
const STAGE_DIR = join(BUILD_DIR, 'installer-payload');
const DIST_DIR = join(ROOT, 'dist');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-DryRun');
if (args.includes('--skip-encrypt') || args.includes('-SkipEncrypt')) {
  console.log('[WARN] --skip-encrypt is deprecated: the bootstrapper installer never encrypts.');
}

interface PkgJson {
  version: string;
  name: string;
}

function step(msg: string): void {
  console.log(`[BUILD] ${msg}`);
}
function ok(msg: string): void {
  console.log(`  [OK] ${msg}`);
}

function findMakensis(): string | null {
  const candidates = [
    'makensis.exe',
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
  ];
  for (const candidate of candidates) {
    try {
      const probe = runSync(candidate, ['/VERSION'], { timeout: 10000 });
      if (probe.status === 0) return candidate;
    } catch {
      // keep probing
    }
  }
  return null;
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

interface SignOutcome {
  status: 'signed' | 'skipped' | 'failed';
  detail: string;
}

/**
 * Optional Authenticode signing. Runs only when explicitly configured:
 *   GV_SIGNTOOL_PATH      — full path to signtool.exe (or on PATH)
 *   GV_SIGNING_CERT       — path to .pfx certificate
 *   GV_SIGNING_CERT_PASSWORD — certificate password (optional if prompt-free pfx)
 * Unsigned installers trigger SmartScreen; the skip is reported honestly.
 */
function trySignInstaller(installerPath: string): SignOutcome {
  const cert = process.env.GV_SIGNING_CERT;
  const certPassword = process.env.GV_SIGNING_CERT_PASSWORD;
  const signtool =
    process.env.GV_SIGNTOOL_PATH ??
    ['signtool.exe', 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe'].find(
      (p) => {
        try {
          return runSync(p, ['/?'], { timeout: 10000 }).status === 0;
        } catch {
          return false;
        }
      },
    );

  if (!cert || !signtool) {
    return {
      status: 'skipped',
      detail:
        'no signing configured (set GV_SIGNTOOL_PATH + GV_SIGNING_CERT to sign). Installer will show SmartScreen warning.',
    };
  }

  const signArgs = [
    'sign',
    '/f',
    cert,
    ...(certPassword ? ['/p', certPassword] : []),
    '/tr',
    process.env.GV_TIMESTAMP_URL ?? 'http://timestamp.digicert.com',
    '/td',
    'sha256',
    '/fd',
    'sha256',
    installerPath,
  ];
  try {
    const result = runSync(signtool, signArgs, { timeout: 120000 });
    if (result.status === 0) return { status: 'signed', detail: `signed with ${cert}` };
    return { status: 'failed', detail: `signtool exit code ${result.status}` };
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** cmd shim that repairs an existing installation (re-run bootstrap + doctor). */
function repairCmd(): string {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'echo ==============================================',
    'echo  Gentle-Vanguard Repair',
    'echo ==============================================',
    'echo [1/2] Re-verifying environment (doctor)...',
    'call npm run install:doctor || (echo [!] Doctor reported issues - continuing with bootstrap)',
    'echo [2/2] Re-running bootstrap (repairs dependencies and runtime state)...',
    'call npm run install:bootstrap -- --full',
    'echo.',
    'echo Repair finished. You can close this window.',
    'pause',
  ].join('\r\n');
}

/** cmd shim executed from the Finish page on a clean machine. */
function bootstrapCmd(): string {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'echo ==============================================',
    'echo  Gentle-Vanguard Bootstrap',
    'echo ==============================================',
    'where node >nul 2>nul || (echo [X] Node.js not found. Install Node 20+ from https://nodejs.org & pause & exit /b 1)',
    'where pnpm >nul 2>nul || (echo [!] pnpm not found - installing... & call npm install -g pnpm@11 || (echo [X] Failed to install pnpm & pause & exit /b 1))',
    'echo [1/2] Installing dependencies (pnpm install --frozen-lockfile)...',
    'call pnpm install --frozen-lockfile || (echo [X] Dependency installation failed & pause & exit /b 1)',
    'echo [2/2] Verifying environment and initializing runtime...',
    'call npm run install:bootstrap -- --full',
    'echo.',
    'echo Bootstrap finished. You can close this window.',
    'pause',
  ].join('\r\n');
}

interface NsiOptions {
  version: string;
  stageDir: string;
  nsiPath: string;
}

function generateNsi({ version, stageDir, nsiPath }: NsiOptions): void {
  const product = 'Gentle-Vanguard';
  const nsi = `; ${product} Installer v${version} - bootstrapper edition
; AUTO-GENERATED by src/cli/create-installer.ts - do not edit manually.
; Policy: config/installer-manifest.json (neverBundlesSecrets, requiresConsentForExternalDownloads)

!define PRODUCT_NAME "${product}"
!define PRODUCT_VERSION "${version}"
!define PRODUCT_PUBLISHER "${product}"
!define UNINST_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}"

SetCompressor lzma
RequestExecutionLevel user
Unicode true

Name "\${PRODUCT_NAME} \${PRODUCT_VERSION}"
OutFile "${join(DIST_DIR, `${product}-Setup-${version}.exe`)}"
InstallDir "$LOCALAPPDATA\\Programs\\\${PRODUCT_NAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
; nsExec plugin is called directly (no header shipped with NSIS 3)

!define MUI_FINISHPAGE_RUN "$INSTDIR\\bootstrap.cmd"
!define MUI_FINISHPAGE_RUN_TEXT "Run bootstrap now (installs dependencies and verifies the environment)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE CheckPrerequisites
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function CheckPrerequisites
  nsExec::ExecToStack 'cmd /c node --version'
  Pop $0
  \${If} $0 != 0
    MessageBox MB_YESNO|MB_ICONQUESTION "Node.js was not detected on this machine.$\\n$\\nGentle-Vanguard needs Node.js 20+ and pnpm 11+.$\\nOpen https://nodejs.org to download Node.js now?" IDYES openNode IDNO continueInstall
    openNode:
      ExecShell "open" "https://nodejs.org"
      MessageBox MB_OK|MB_ICONINFORMATION "After installing Node.js, run:$\\n  npm install -g pnpm@11$\\nand then launch $INSTDIR\\bootstrap.cmd"
      Abort
    continueInstall:
      DetailPrint "Continuing without Node.js - bootstrap will guide the user."
  \${EndIf}
FunctionEnd

Section "Core" SecCore
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${stageDir}\\*.*"

  ; Add/Remove Programs entry
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayName" "\${PRODUCT_NAME} \${PRODUCT_VERSION}"
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayVersion" "\${PRODUCT_VERSION}"
  WriteRegStr HKCU "\${UNINST_KEY}" "Publisher" "\${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "\${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "\${UNINST_KEY}" "UninstallString" "$INSTDIR\\uninstall.exe"
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\\\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\\\${PRODUCT_NAME}\\\${PRODUCT_NAME}.lnk" "$INSTDIR\\bootstrap.cmd"
  CreateShortcut "$SMPROGRAMS\\\${PRODUCT_NAME}\\Repair Gentle-Vanguard.lnk" "$INSTDIR\\repair.cmd"
  CreateShortcut "$SMPROGRAMS\\\${PRODUCT_NAME}\\Uninstall.lnk" "$INSTDIR\\uninstall.exe"
  WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\\${PRODUCT_NAME}\\*.*"
  RMDir "$SMPROGRAMS\\\${PRODUCT_NAME}"
  DeleteRegKey HKCU "\${UNINST_KEY}"
SectionEnd
`;
  writeFileSync(nsiPath, nsi, 'utf8');
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PkgJson;
  const version = pkg.version;

  console.log('');
  console.log('========================================');
  console.log(`  Gentle-Vanguard Installer Builder v${version}`);
  console.log('========================================');
  console.log('');

  // Phase 1: Stage payload
  step('Phase 1: Staging payload (public distribution, no secrets)');
  const staged = stagePayload(ROOT, STAGE_DIR);
  ok(`${staged.copiedEntries.length} entries staged -> ${STAGE_DIR}`);
  if (staged.skippedSecretPaths.length > 0)
    ok(`Refused secret paths: ${staged.skippedSecretPaths.join(', ')}`);

  // Phase 2: bootstrap.cmd + repair.cmd shims
  step('Phase 2: Writing bootstrap.cmd and repair.cmd');
  writeFileSync(join(STAGE_DIR, 'bootstrap.cmd'), bootstrapCmd(), 'utf8');
  writeFileSync(join(STAGE_DIR, 'repair.cmd'), repairCmd(), 'utf8');
  ok('bootstrap.cmd + repair.cmd written');

  // Phase 3: Generate NSI
  step('Phase 3: Generating NSIS script');
  const nsiPath = join(BUILD_DIR, 'gentle-vanguard-installer.nsi');
  generateNsi({ version, stageDir: STAGE_DIR, nsiPath });
  ok(`NSI generated: ${nsiPath}`);

  if (dryRun) {
    step('DRY RUN: skipping makensis');
    return;
  }

  // Phase 4: Compile
  step('Phase 4: Compiling installer');
  const makensis = findMakensis();
  if (!makensis) {
    console.error(
      '  [ERROR] makensis not found. Install NSIS 3+ from https://nsis.sourceforge.io/',
    );
    process.exit(1);
  }
  const build = runSync(makensis, [nsiPath], { timeout: 300000 });
  if (build.status !== 0) {
    console.error('  [ERROR] NSIS build failed');
    process.exit(1);
  }

  // Phase 5: Verify + checksum
  const installerPath = join(DIST_DIR, `Gentle-Vanguard-Setup-${version}.exe`);
  if (!existsSync(installerPath)) {
    console.error(`  [ERROR] Expected installer not found: ${installerPath}`);
    process.exit(1);
  }
  const checksum = sha256(installerPath);
  writeFileSync(
    `${installerPath}.sha256`,
    `${checksum}  ${`Gentle-Vanguard-Setup-${version}.exe`}\n`,
    'utf8',
  );
  ok(`Installer: ${installerPath}`);
  ok(`SHA256: ${checksum}`);

  // Phase 6: Optional Authenticode signing (honest skip when unconfigured)
  step('Phase 6: Code signing');
  const sign = trySignInstaller(installerPath);
  if (sign.status === 'signed') ok(`Signed: ${sign.detail}`);
  else if (sign.status === 'skipped') console.log(`  [SKIP] ${sign.detail}`);
  else {
    console.error(`  [ERROR] Signing failed: ${sign.detail}`);
    process.exit(1);
  }

  step('Build complete');
}

main();
