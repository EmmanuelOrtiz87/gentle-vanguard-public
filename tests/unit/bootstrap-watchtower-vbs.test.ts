import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHiddenVbs } from '../../src/infrastructure/bootstrap.ts';

// VBScript launchers are Windows-only (WScript.Shell). On non-Windows runners
// process.execPath has no .exe / backslash form, so the Windows-specific
// assertions cannot hold — skip instead of failing the CI matrix.
test(
  'createHiddenVbs emits a valid hidden node launcher',
  { skip: process.platform !== 'win32' },
  () => {
    const vbs = createHiddenVbs(
      'Gentle-Vanguard-Watchtower-AutoHeal',
      'C:\\Workspace local\\gentle-vanguard\\src\\ops\\watchtower-autoheal-autostart.ts',
      'C:\\Workspace local\\gentle-vanguard',
    );

    assert.match(vbs, /^Set shell = CreateObject\("Wscript\.Shell"\)\r?\n/m);
    assert.match(vbs, /shell\.CurrentDirectory = "C:\\Workspace local\\gentle-vanguard"/);
    assert.match(
      vbs,
      /shell\.Run """[^"\r\n]+\\node\.exe"" --import tsx ""C:\\Workspace local\\gentle-vanguard\\src\\ops\\watchtower-autoheal-autostart\.ts""", 0, False$/m,
    );
    assert.doesNotMatch(vbs, /powershell|pwsh/i);
    assert.doesNotMatch(vbs, /CreateObject\("Wscript\.Shell"\)\.Run .* --import/);
  },
);
