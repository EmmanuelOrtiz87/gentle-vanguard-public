#!/usr/bin/env node
/**
 * Gemini image retry — autonomía del stack para la cola de imágenes AI.
 *
 * Historia (BL tanda 11/12): los 4 modelos de imagen Gemini (free tier) quedan
 * RESOURCE_EXHAUSTED por cuota diaria (resetea medianoche hora Pacific). La
 * cuota no se puede crear localmente (frontera honesta), pero SIN bloquear la
 * tanda, este script poll: al primer success genera los 2 fondos AI aprobados,
 * compone los canvases finales con los textos aprobados por el owner (copy
 * canónica del build-social-card) y se auto-desprograma.
 *
 * Uso:
 *   npx tsx src/content-operations/gemini-image-retry.ts             # corrida única
 *   npx tsx src/content-operations/gemini-image-retry.ts --register  # tarea programada (15 min)
 *   ... --quiet                                                      # modo daemon (schtasks)
 *
 * Exit codes: 0 = generado (o ya estaba), 3 = cuota agotada, 2 = error real.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';
import { createHiddenVbs } from '../infrastructure/bootstrap.js';

const ROOT = resolve(process.cwd());
const KEY_FILE = join(ROOT, 'apps/prompt-studio/.runtime/gemini-key.json');
const OUT_DIR = join(ROOT, '.runtime/content-cms-previews-20261105');
const DONE_MARKER = join(OUT_DIR, '.ai-generated-done.json');
const TASK_NAME = 'GV-SocialImageRetry';
const argv = process.argv.slice(2);

// ─── Briefs aprobados (tanda 12/13: fondo AI que la cuota generativa dé; el
// texto es el copy aprobado y NO se regenera — lo texturiza sharp localmente) ──
const MODELS = [
  'gemini-2.5-flash-image',
  'nano-banana-pro-preview',
  'gemini-3-pro-image-preview',
];
const BRIEF = [
  'Abstract dark tech background, deep navy #0B1020 base, soft purple #8B5CF6 glow from top-left, cyan #06B6D4 glow from bottom-right, faint diagonal violet-to-cyan gradient sweep (#6E4DEB to #06B6D4), subtle fine grid lines, soft bokeh particles, calm and minimal, no text, no logos, no faces, generous dark empty space for typography.',
];

const MONO_SVG = existsSync(join(ROOT, 'assets/brand/gentle-vanguard/v2/svg/icons/gv-cyan.svg'))
  ? readFileSync(join(ROOT, 'assets/brand/gentle-vanguard/v2/svg/icons/gv-cyan.svg'), 'utf-8')
      .replace(/<\?xml[^>]*\?>\s*/, '')
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
  : '';

interface Canvas {
  w: number;
  h: number;
  name: string;
}

const CANVASES: Canvas[] = [
  { w: 1200, h: 627, name: 'social-linkedin-preview.png' },
  { w: 1080, h: 1080, name: 'social-instagram-preview.png' },
];

function overlaySvg({ w, h }: Canvas): string {
  // Composición idéntica al canon del build-social-card (textos aprobados).
  const impact = `Impact, 'Arial Black', sans-serif`;
  const inter = `Inter, Arial, sans-serif`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#0B1020" fill-opacity="0.42"/>
  <defs>
    <linearGradient id="gv" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6E4DEB"/><stop offset="52%" stop-color="#7B63E8"/><stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <g transform="translate(${w * 0.06}, ${h * 0.10})">
    <rect x="0" y="0" rx="16" ry="16" width="${w * 0.52}" height="${h * 0.13}" fill="#151921" fill-opacity="0.88" stroke="#8B5CF6" stroke-width="2" stroke-dasharray="7 5"/>
    <text x="${w * 0.26}" y="${h * 0.117}" text-anchor="middle" fill="#e8eef4" font-family="${impact}" font-size="${Math.round(h * 0.075)}">EL REPO NI <tspan fill="#06B6D4">git status</tspan> PODÍA CORRER</text>
  </g>
  <text x="${w * 0.06}" y="${h * 0.52}" fill="url(#gv)" font-family="${impact}" font-size="${Math.round(h * 0.30)}" letter-spacing="-2">6.4B</text>
  <text x="${w * 0.06}" y="${h * 0.60}" fill="#e8eef4" font-family="${inter}" font-size="${Math.round(h * 0.052)}" font-weight="700">tokens reales medidos. No promesas. Contador.</text>
  <g font-family="${inter}" font-weight="800" font-size="${Math.round(h * 0.062)}">
    <text x="${w * 0.06}" y="${h * 0.74}" fill="#06B6D4">3.417 commits</text>
    <text x="${w * 0.42}" y="${h * 0.74}" fill="#a78bfa">196 PRs</text>
    <text x="${w * 0.68}" y="${h * 0.74}" fill="#06B6D4">28 apps</text>
  </g>
  <g font-family="${inter}" font-size="${Math.round(h * 0.040)}" fill="#d5dce6">
    <text x="${w * 0.06}" y="${h * 0.82}">y el gate de typecheck agarró el bug que metió el propio dev. Nadie lo revisó.</text>
    <text x="${w * 0.06}" y="${h * 0.88}">Llegó a main. El sistema lo cazó igual. Esa es la diferencia.</text>
  </g>
  <g transform="translate(${w * 0.84}, ${h * 0.06}) scale(${(h * 0.16) / 1024})">${MONO_SVG}</g>
  <text x="${w * 0.845}" y="${h * 0.945}" fill="#d5dce6" font-family="${inter}" font-size="${Math.round(h * 0.034)}" font-weight="600">GentleVanguard</text>
</svg>`;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

async function tryModel(model: string, brief: string): Promise<{ bytes: Buffer } | { status: number; note: string }> {
  const cfg = JSON.parse(readFileSync(KEY_FILE, 'utf-8')) as { key?: string; apiKey?: string; token?: string };
  const key = cfg.key || cfg.apiKey || cfg.token;
  if (!key) throw new Error('gemini-key.json sin key/apiKey/token');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: brief }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    return { status: r.status, note: err.error?.status || err.error?.message || String(r.status) };
  }
  const body = (await r.json()) as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) return { status: 200, note: 'respuesta sin inlineData' };
  return { bytes: Buffer.from(part.inlineData.data, 'base64') };
}

async function main(): Promise<number> {
  const quiet = argv.includes('--quiet');
  if (argv.includes('--register')) return registerTask();
  if (existsSync(DONE_MARKER)) {
    if (!quiet) console.log('[image-retry] ya generado, no-op');
    return 0;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(KEY_FILE)) {
    console.error('[image-retry] key Gemini no encontrada:', KEY_FILE);
    return 2;
  }
  for (const model of MODELS) {
    const res = await tryModel(model, BRIEF[0]);
    if ('bytes' in res) {
      const { default: sharp } = await import('sharp');
      const original = join(OUT_DIR, `ai-original-${model}.png`);
      await sharp(res.bytes).png().toFile(original);
      for (const canvas of CANVASES) {
        const bg = await sharp(original).resize(canvas.w, canvas.h, { fit: 'cover', position: 'centre' }).png().toBuffer();
        await sharp(bg).composite([{ input: Buffer.from(overlaySvg(canvas)) }]).png().toFile(join(OUT_DIR, canvas.name));
      }
      writeFileSync(DONE_MARKER, JSON.stringify({ model, at: new Date().toISOString() }, null, 2), 'utf-8');
      console.log(`[image-retry] OK con ${model}: originales + ${CANVASES.length} previews en ${OUT_DIR}`);
      // Autoteardown: la única razón de la tarea era esta corrida.
      if (quiet) runSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { timeout: 8000, stdio: 'ignore' });
      return 0;
    }
    if (res.status === 429) {
      const msg = `[${new Date().toISOString()}] ${model}: cuota agotada`;
      try { appendFileSync(join(OUT_DIR, '.ai-retry.log'), msg + '\n', 'utf-8'); } catch { /* best-effort */ }
      if (!quiet) console.log(`[image-retry] ${model}: cuota aún agotada (${res.note})`);
      continue;
    }
    if (!quiet) console.error(`[image-retry] ${model}: ${res.status} ${res.note}`);
  }
  return 3;
}

function quote(value: string): string {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function registerTask(): number {
  const vbsPath = join(ROOT, '.runtime', 'gv-social-image-retry.vbs');
  // Generador sancionado del stack (bootstrap.ts) — el VBS artesanal fallaba
  // silenciosamente por over-quoting (lección de esta tanda).
  const taskScript = join(ROOT, 'src/content-operations/gemini-image-retry.cli.ts');
  writeFileSync(vbsPath, createHiddenVbs(TASK_NAME, taskScript, ROOT), 'utf-8');
  const created = runSync('schtasks', [
    '/Create',
    '/TN', TASK_NAME,
    '/TR', `${quote('wscript.exe')} ${quote(vbsPath)}`,
    '/SC', 'MINUTE', '/MO', '15',
    '/F',
  ], { timeout: 15000 });
  if (created.status !== 0) {
    console.error('[image-retry] registro de tarea falló:', created.stderr);
    return 2;
  }
  console.log(`[image-retry] tarea ${TASK_NAME} activa (cada 15 min, se auto-elimina al generar)`);
  return 0;
}

// CLI puro: siempre corre main (los flags determinan el modo).
process.exitCode = await main();
