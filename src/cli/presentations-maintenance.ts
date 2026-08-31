import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;
type Options = Record<string, string | boolean>;

const root = process.cwd();
const scriptsDir = resolve(root, '.opencode/skills/presentations-maintenance/scripts');
const defaultDocs = resolve(root, 'docs/presentations');
const defaultI18n = join(defaultDocs, 'assets/js/i18n.js');
const languages = ['en', 'es', 'pt-BR'] as const;
const markers = {
  en: "status_unknown: 'Unknown'",
  es: "status_unknown: 'Desconocido'",
  'pt-BR': "status_unknown: 'Desconhecido'",
} as const;

function options(args: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else result[key] = true;
  }
  return result;
}

function value(opts: Options, name: string, fallback: string): string {
  const item = opts[name];
  return typeof item === 'string' ? resolve(root, item) : fallback;
}

function json(path: string): JsonRecord {
  if (!existsSync(path)) throw new Error(`JSON no encontrado: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;
}

function save(path: string, content: string, dryRun: boolean): void {
  if (!dryRun) writeFileSync(path, content, 'utf8');
}

function insertTipsData(
  tips: JsonRecord,
  jsPath: string,
  markerKey: string,
  dryRun: boolean,
): void {
  let content = readFileSync(jsPath, 'utf8');
  let inserted = 0;
  for (const lang of languages) {
    const marker = markers[lang];
    const match = new RegExp(
      `${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)\\r?\\n    \\},`,
    ).exec(content);
    if (!match) continue;
    if (new RegExp(`${markerKey}:`).test(match[1])) continue;
    const lines = Object.entries(tips)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, data]) => {
        const text = String((data as JsonRecord)[lang] ?? '').replaceAll("'", "\\'");
        return `      ${key}: '${text}',`;
      });
    if (lines.length === 0) continue;
    const position = content.indexOf('\n', content.indexOf(marker)) + 1;
    content = content.slice(0, position) + `\n${lines.join('\n')}` + content.slice(position);
    inserted += lines.length;
  }
  save(jsPath, content, dryRun);
  console.log(`${dryRun ? 'DRY-RUN' : 'DONE'}: ${inserted} claves`);
}

function insertZones(opts: Options): void {
  const zonesPath = value(opts, 'zones-json', join(scriptsDir, 'svg-zones.json'));
  const zones = json(zonesPath);
  const flat: JsonRecord = {};
  for (const definitions of Object.values(zones)) {
    for (const [key, definition] of Object.entries(definitions as JsonRecord)) {
      const data = definition as JsonRecord;
      flat[key] = { en: data.en, es: data.es, 'pt-BR': data['pt-BR'] };
    }
  }
  insertTipsData(
    flat,
    value(opts, 'js-path', defaultI18n),
    String(opts.marker ?? 'tip_hs_loop_detection'),
    Boolean(opts['dry-run']),
  );
}

function injectHotspots(opts: Options): void {
  const zones = json(value(opts, 'zones-json', join(scriptsDir, 'svg-zones.json')));
  const directory = value(opts, 'diagrams-dir', join(root, 'docs/presentations/diagrams'));
  let total = 0;
  for (const [file, definitions] of Object.entries(zones)) {
    const path = join(directory, file);
    if (!existsSync(path)) continue;
    let content = readFileSync(path, 'utf8');
    if (content.includes('class="gv-hotspot"')) continue;
    const rects = Object.entries(definitions as JsonRecord)
      .map(([key, raw]) => {
        const data = raw as JsonRecord;
        const rect = data.rect as number[];
        if (!Array.isArray(rect) || rect.length < 4) return '';
        total += 1;
        return `    <rect class="gv-hotspot" x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}" rx="6" data-i18n-title="${key}" role="button" tabindex="0" fill="transparent" aria-label="${data.en ?? ''}"/>`;
      })
      .filter(Boolean)
      .join('\n');
    content = content.replace(/<\/svg>\s*$/, `\n  <!-- HOTSPOTS -->\n${rects}\n</svg>`);
    save(path, content, Boolean(opts['dry-run']));
  }
  console.log(`${Boolean(opts['dry-run']) ? 'DRY-RUN' : 'DONE'}: ${total} hotspots`);
}

function homologateSvg(opts: Options): void {
  const directory = value(opts, 'diagrams-dir', join(root, 'docs/presentations/diagrams'));
  const files =
    typeof opts.file === 'string'
      ? [opts.file]
      : readdirSync(directory).filter((file) => file.endsWith('.svg'));
  let total = 0;
  for (const file of files) {
    const path = join(directory, file);
    if (!existsSync(path)) continue;
    let content = readFileSync(path, 'utf8');
    content = content.replace(/<g class="gv-node"([^>]*)>/g, (tag, attrs: string) => {
      if (attrs.includes('gv-hotspot')) return tag;
      const group = /data-group="([^"]+)"/.exec(attrs)?.[1];
      if (!group) return tag;
      total += 1;
      const rest = attrs.replace(/\s*class="gv-node"|\s*data-group="[^"]*"/g, '').trim();
      return `<g class="gv-node gv-hotspot" data-group="${group}" data-i18n-title="tip_hs_${group}" role="button" tabindex="0"${rest ? ` ${rest}` : ''}>`;
    });
    save(path, content, Boolean(opts['dry-run']));
  }
  console.log(`${Boolean(opts['dry-run']) ? 'DRY-RUN' : 'DONE'}: ${total} hotspots`);
}

function contentDictionary(contentPath: string): Record<string, Record<string, string>> {
  const raw = readFileSync(contentPath, 'utf8');
  const result: Record<string, Record<string, string>> = {};
  for (const lang of languages) {
    const start = raw.indexOf(`__GV_CONTENT.${lang} = {`);
    const end = raw.indexOf('__GV_CONTENT.', start + 1);
    const block = raw.slice(start, end < 0 ? raw.length : end);
    result[lang] = Object.fromEntries(
      [...block.matchAll(/"([c_][\w]+)":\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
  }
  return result;
}

function homologatePages(opts: Options): void {
  const directory = value(opts, 'docs-dir', defaultDocs);
  const dictionary = contentDictionary(
    value(opts, 'content-js', join(directory, 'assets/js/i18n-content.js')),
  ).en;
  const files =
    typeof opts.page === 'string'
      ? [opts.page]
      : readdirSync(directory).filter((file) => file.endsWith('.html'));
  let total = 0;
  for (const file of files) {
    const path = join(directory, file);
    let content = readFileSync(path, 'utf8');
    content = content.replace(
      /<td data-i18n="([c_][\w]+)">([^<]*)<\/td>/g,
      (match, key: string, text: string) => {
        if (text.includes('info-trigger')) return match;
        total += 1;
        const fallback = dictionary[key]?.replaceAll('&', '&amp;').replaceAll('"', '&quot;') ?? '';
        return `<td><span data-i18n="${key}">${text.trim()}</span><span class="info-trigger" data-i18n-title="tip_${key}"${fallback ? ` title="${fallback}"` : ''}>i</span></td>`;
      },
    );
    save(path, content, Boolean(opts['dry-run']));
  }
  console.log(`${Boolean(opts['dry-run']) ? 'DRY-RUN' : 'DONE'}: ${total} filas`);
}

function homologateMatrix(opts: Options): void {
  const path = value(opts, 'html-path', join(defaultDocs, 'index.html'));
  const tipsPath = value(opts, 'tips-json', join(scriptsDir, 'tips-fm.json'));
  const tips = existsSync(tipsPath) ? json(tipsPath) : {};
  let content = readFileSync(path, 'utf8');
  let total = 0;
  content = content.replace(
    /<td data-i18n="(c_index_\d+)">([^<]*)<\/td>/g,
    (match, key: string, text: string) => {
      if (match.includes('info-trigger')) return match;
      total += 1;
      const tip = String((tips[key] as JsonRecord | undefined)?.en ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;');
      return `<td><span data-i18n="${key}">${text}</span><span class="info-trigger" data-i18n-title="tip_fm_${key.slice(8)}"${tip ? ` title="${tip}"` : ''}>i</span></td>`;
    },
  );
  save(path, content, Boolean(opts['dry-run']));
  console.log(`${Boolean(opts['dry-run']) ? 'DRY-RUN' : 'DONE'}: ${total} filas`);
}

function dedupe(opts: Options): void {
  const path = value(opts, 'js-path', defaultI18n);
  const block = String(opts.block ?? 'en');
  const order = ['en', 'es', 'pt-BR'];
  const start = [`${block}: {`, `'${block}': {`]
    .map((item) => readFileSync(path, 'utf8').indexOf(item))
    .filter((item) => item >= 0)
    .sort((a, b) => a - b)[0];
  if (start === undefined) throw new Error(`Bloque '${block}' no encontrado`);
  const raw = readFileSync(path, 'utf8');
  const next =
    order
      .slice(order.indexOf(block) + 1)
      .map((lang) => [raw.indexOf(`${lang}: {`, start), raw.indexOf(`'${lang}': {`, start)])
      .flat()
      .filter((item) => item >= 0)
      .sort((a, b) => a - b)[0] ?? raw.length;
  const seen = new Set<string>();
  const section = raw
    .slice(start, next)
    .split('\n')
    .filter((line) => {
      const key = /^\s+([\w-]+):\s/.exec(line)?.[1];
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
  save(path, raw.slice(0, start) + section + raw.slice(next), Boolean(opts['dry-run']));
  console.log(`${Boolean(opts['dry-run']) ? 'DRY-RUN' : 'DONE'}: ${seen.size} claves`);
}

function insertTips(jsonPath: string, jsPath: string, markerKey: string, dryRun: boolean): void {
  insertTipsData(json(jsonPath), jsPath, markerKey, dryRun);
}

function genTipsC(opts: Options): void {
  const directory = value(opts, 'docs-dir', defaultDocs);
  const contentPath = value(opts, 'content-js', join(directory, 'assets/js/i18n-content.js'));
  const dictionaries = contentDictionary(contentPath);
  const keys = new Set<string>();
  for (const file of readdirSync(directory).filter((item) => item.endsWith('.html'))) {
    const html = readFileSync(join(directory, file), 'utf8');
    for (const match of html.matchAll(/data-i18n-title="(tip_c_[\w]+)"/g)) keys.add(match[1]);
  }
  const entries: JsonRecord = {};
  for (const tipKey of keys) {
    const entry: JsonRecord = {};
    let complete = true;
    for (const lang of languages) {
      const text = dictionaries[lang][tipKey.slice(4)];
      if (text === undefined) complete = false;
      entry[lang] = text ?? '';
    }
    if (complete) entries[tipKey] = entry;
  }
  insertTipsData(entries, value(opts, 'js-path', defaultI18n), 'tip_c_', Boolean(opts['dry-run']));
}

function main(): void {
  const [command = 'help', ...args] = process.argv.slice(2);
  const opts = options(args);
  if (command === 'insert-tips')
    insertTips(
      value(opts, 'json-path', join(scriptsDir, 'tips-new.json')),
      value(opts, 'js-path', defaultI18n),
      String(opts.marker ?? 'tip_auto_loop'),
      Boolean(opts['dry-run']),
    );
  else if (command === 'insert-zones') insertZones(opts);
  else if (command === 'inject-hotspots') injectHotspots(opts);
  else if (command === 'homologate-svg') homologateSvg(opts);
  else if (command === 'homologate-pages') homologatePages(opts);
  else if (command === 'homologate-matrix') homologateMatrix(opts);
  else if (command === 'dedupe-i18n') dedupe(opts);
  else if (command === 'gen-tips-c') genTipsC(opts);
  else
    console.log(
      'Uso: npx tsx src/cli/presentations-maintenance.ts <insert-tips|insert-zones|inject-hotspots|homologate-svg|homologate-pages|homologate-matrix|gen-tips-c|dedupe-i18n>',
    );
}

main();
