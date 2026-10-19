/**
 * demo-recorder — autoría de guiones para el Teatro de Demos (v1.2).
 *
 * Graba una demo humana UNA vez con Playwright (`codegen`) y la convierte en un
 * guion JSON neutral que el runner genérico (`autoplay-generic.js`) puede ejecutar
 * dentro de cualquier app embebida en el teatro.
 *
 * Uso:
 *   npm run demo:record -- --name viandas --url http://127.0.0.1:4010
 *   npx tsx src/tools/demo-recorder.ts --convert <archivo-codegen.js> --name x --url <url>
 *
 * Salida: config/demo-scripts/<name>.json  (+ resumen por consola)
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

export interface DemoStep {
  action: 'goto' | 'click' | 'fill' | 'press' | 'wait' | 'scroll' | 'waitFor';
  url?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  css?: string;
  value?: string;
  key?: string;
  ms?: number;
  selector?: string;
}

export interface DemoScript {
  version: 1;
  name: string;
  url: string;
  recordedAt: string;
  steps: DemoStep[];
}

const require_ = createRequire(import.meta.url);

/** Convierte el JS generado por `playwright codegen` en pasos neutrales. */
export function convertCodegen(code: string, name: string, url: string): DemoScript {
  const steps: DemoStep[] = [];
  const lines = code.split(/\r?\n/);

  const quotedAt = (value: string, start = 0): { value: string; end: number } | null => {
    const quoteIndex = value.slice(start).search(/['"]/);
    if (quoteIndex < 0) return null;
    const quote = value[start + quoteIndex];
    let cursor = start + quoteIndex + 1;
    let result = '';
    while (cursor < value.length) {
      const char = value[cursor];
      if (char === '\\' && cursor + 1 < value.length) {
        result += value[cursor + 1];
        cursor += 2;
        continue;
      }
      if (char === quote) return { value: result, end: cursor + 1 };
      result += char;
      cursor += 1;
    }
    return null;
  };

  const roleOf = (line: string): DemoStep | null => {
    // page.getByRole('button', { name: 'Buscar' })
    const m = /getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*(['"])(.*?)\2/.exec(line);
    return m ? { action: 'click', role: m[1], name: m[3] } : null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('await')) continue;

    const goto = /page\.goto\(\s*(['"])(.*?)\1/.exec(line);
    if (goto) {
      steps.push({ action: 'goto', url: goto[2] });
      continue;
    }
    const wait = /page\.waitForTimeout\(\s*(\d+)/.exec(line);
    if (wait) {
      steps.push({ action: 'wait', ms: Number(wait[1]) });
      continue;
    }
    const press = /page\.keyboard\.press\(\s*(['"])(.*?)\1/.exec(line);
    if (press) {
      steps.push({ action: 'press', key: press[2] });
      continue;
    }
    const locatorStart = line.indexOf('page.locator(');
    if (locatorStart >= 0) {
      const cssArg = quotedAt(line, locatorStart + 'page.locator('.length);
      const chain = cssArg ? line.slice(cssArg.end) : '';
      const verb = ['click', 'fill', 'press'].find((candidate) => chain.includes(`.${candidate}(`));
      if (!cssArg || !verb) continue;
      const valueArg = quotedAt(chain, chain.indexOf(`.${verb}(`) + verb.length + 2);
      const css = cssArg.value;
      const value = valueArg?.value;
      if (verb === 'fill') steps.push({ action: 'fill', css, value: value ?? '' });
      else if (verb === 'press') steps.push({ action: 'press', css, key: value ?? 'Enter' });
      else steps.push({ action: 'click', css });
      continue;
    }
    const role = roleOf(line);
    if (role) {
      if (/\.fill\(/.test(line)) {
        const v = /\.fill\(\s*(['"])(.*?)\1/.exec(line);
        steps.push({ action: 'fill', role: role.role, name: role.name, value: v ? v[2] : '' });
      } else {
        steps.push(role);
      }
      continue;
    }
    const byLabel = /getByLabel\(\s*(['"])(.*?)\1\s*\)/.exec(line);
    if (byLabel) {
      const v = /\.fill\(\s*(['"])(.*?)\1/.exec(line);
      steps.push(v ? { action: 'fill', label: byLabel[2], value: v[2] } : { action: 'click', label: byLabel[2] });
      continue;
    }
    const byPlaceholder = /getByPlaceholder\(\s*(['"])(.*?)\1\s*\)/.exec(line);
    if (byPlaceholder) {
      const v = /\.fill\(\s*(['"])(.*?)\1/.exec(line);
      steps.push(v ? { action: 'fill', placeholder: byPlaceholder[2], value: v[2] } : { action: 'click', placeholder: byPlaceholder[2] });
      continue;
    }
    const byText = /getByText\(\s*(['"])(.*?)\1/.exec(line);
    if (byText) {
      steps.push({ action: 'click', text: byText[2] });
      continue;
    }
  }

  return { version: 1, name, url, recordedAt: new Date().toISOString(), steps };
}

function outPath(name: string): string {
  const dir = resolve('config', 'demo-scripts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, `${name}.json`);
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const name = value('--name');
  const url = value('--url');
  if (!name || !url) {
    console.error('Uso: --name <id> --url <url-demo> [--convert <archivo.js>]');
    process.exit(1);
  }

  let source = value('--convert');
  if (!source) {
    const cli = require_.resolve('playwright/cli.js');
    const target = resolve('.runtime', `codegen-${name}.js`);
    console.log(`[demo-recorder] abriendo Playwright codegen en ${url} (grabá la demo y cerrá la ventana)…`);
    const r = runSync(process.execPath, [cli, 'codegen', '--target', 'javascript', '--output', target, url], { timeout: 900_000 });
    if (r.status !== 0) {
      console.error(`[demo-recorder] codegen salió con ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`);
      process.exit(1);
    }
    source = target;
  }
  if (!existsSync(source)) {
    console.error(`[demo-recorder] no encuentro el archivo a convertir: ${source}`);
    process.exit(1);
  }

  const code = readFileSync(source, 'utf8');
  const script = convertCodegen(code, name, url);
  const file = outPath(name);
  writeFileSync(file, JSON.stringify(script, null, 2) + '\n', 'utf-8');
  console.log(`[demo-recorder] guion guardado: ${file}`);
  console.log(`[demo-recorder] ${script.steps.length} paso(s):`);
  for (const s of script.steps.slice(0, 12)) console.log(`  · ${s.action} ${s.name ?? s.css ?? s.label ?? s.text ?? s.key ?? s.url ?? s.ms ?? ''}`);
  if (script.steps.length > 12) console.log(`  … (+${script.steps.length - 12})`);
  console.log('\nPara usarlo en una app: incluir public/js/autoplay-generic.js y abrir ?demoSteps=' + name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
