// i18n audit — verifica que cada clave data-i18n usada en el HTML de una app exista en su
// diccionario (HTML inline o JS). Detecta el bug sistémico "applyI18n sobreescribe literal
// con el nombre de la clave" (v. gv-english-lab v1.2). Uso: npm run i18n:audit [-- app]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const only = process.argv[2];
const appsDir = join(root, 'apps');
if (!existsSync(appsDir)) {
  console.error('i18n-audit: correr desde la raíz del repo (no encontré apps/)');
  process.exit(2);
}

let failed = false;
for (const app of readdirSync(appsDir).sort()) {
  const dir = join(appsDir, app, 'public');
  const htmlPath = join(dir, 'index.html');
  if (!existsSync(htmlPath)) continue;
  if (only && app !== only) continue;
  const html = readFileSync(htmlPath, 'utf8');
  const keys = [...new Set([...html.matchAll(/data-i18n(?:-ph|-title)?="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]))];
  if (!keys.length) continue;
  const htmlNoAttr = html.replace(/data-i18n(?:-ph|-title)?="[^"]*"/g, '');
  let src = htmlNoAttr;
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) src += readFileSync(join(dir, f), 'utf8');
  const missing = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(src));
  if (missing.length) failed = true;
  console.log(`${app}: ${keys.length} claves → faltantes: ${missing.length ? missing.join(', ') : '(ninguna)'}`);
}
process.exit(failed ? 1 : 0);
