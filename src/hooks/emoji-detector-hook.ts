#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

function hasEmojiChar(code: number): boolean {
  if (code >= 0xd800 && code <= 0xdfff) return true;
  if (code >= 0x2600 && code <= 0x27bf) return true;
  if (code >= 0x2b05 && code <= 0x2b55) return true;
  if (code >= 0x1f300) return true;
  return false;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 0) return 0;

  let files: string[];
  // Modo DIFF (2026-11-11): se chequean SÓLO las líneas AGREGADAS del diff
  // staged. El modo archivo completo bloquearía el trabajo del owner: 455 de
  // 3779 archivos del repo tienen emoji (medido), así que un gate que exige
  // "cero emoji en el archivo" es un gate que siempre falla. La regla útil es
  // "el código NUEVO no introduce emoji"; la deuda vieja no se toca sola.
  if (args.includes('--diff')) {
    return diffMode();
  }
  if (args.length === 1 && args[0].includes(' ')) {
    files = args[0].split(' ').filter(Boolean);
  } else {
    files = args;
  }

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (let i = 0; i < content.length; i++) {
      const code = content.charCodeAt(i);
      if (hasEmojiChar(code)) {
        console.log('[FAIL] Emojis found in script');
        return 1;
      }
    }
  }

  console.log('[OK] No emojis in script');
  return 0;
}

/**
 * Modo diff: mira sólo las líneas agregadas del índice.
 * Un archivo con emoji heredado no bloquea; una línea nueva con emoji sí.
 */
function diffMode(): number {
  let diff: string;
  try {
    diff = execFileSync('git', ['diff', '--cached', '-U0'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    console.log('[OK] No staged diff to check.');
    return 0;
  }

  let currentFile = '';
  const offenders: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    for (let i = 0; i < added.length; i++) {
      if (hasEmojiChar(added.charCodeAt(i))) {
        offenders.push(currentFile || '(archivo desconocido)');
        break;
      }
    }
  }

  if (offenders.length === 0) {
    console.log('[OK] No new emojis in staged changes');
    return 0;
  }
  console.log('[FAIL] Emojis in NEW lines:');
  for (const file of [...new Set(offenders)]) console.log(`  · ${file}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as emojiDetectorHook };
