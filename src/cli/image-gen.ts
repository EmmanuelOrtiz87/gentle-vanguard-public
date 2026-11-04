#!/usr/bin/env node
/**
 * Image Generation CLI — native AI image generation via the connected image app
 * (mcode-tools connector), DALL-E, Stable Diffusion or FLUX.
 * Falls back to SVG template engine when no image backend is available.
 *
 * Provider order for `--provider auto`: connected app -> API keys -> SVG.
 *
 * Usage:
 *   node --import tsx src/cli/image-gen.ts "prompt" --provider auto --output img.png
 *   node --import tsx src/cli/image-gen.ts --config config/image-batch.json
 *   node --import tsx src/cli/image-gen.ts "banner" --provider svg --banner hero
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, extname, join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

interface GenArgs {
  prompt: string;
  provider: 'dall-e' | 'stability' | 'flux' | 'svc' | 'connector' | 'auto';
  output: string;
  format: string;
  config?: string;
  banner?: string;
  batchFile?: string;
  brandConfig?: string;
  aspect: string;
  resolution: string;
  json: boolean;
}

interface BatchItem {
  prompt: string;
  output: string;
  provider?: string;
  style?: string;
}

function parseArgs(): GenArgs {
  const raw = process.argv.slice(2);
  const promptParts: string[] = [];
  let provider: GenArgs['provider'] = 'auto';
  let output = '';
  let format = '';
  let config = '';
  let banner = '';
  let brandConfig = '';
  let aspect = '16:9';
  let resolution = '2K';
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--provider':
        provider = (raw[++i] || 'auto') as GenArgs['provider'];
        break;
      case '--output':
        output = raw[++i] || '';
        break;
      case '--format':
        format = raw[++i] || '';
        break;
      case '--config':
        config = raw[++i] || '';
        break;
      case '--banner':
        banner = raw[++i] || '';
        break;
      case '--brand':
        brandConfig = raw[++i] || '';
        break;
      case '--aspect':
        aspect = raw[++i] || '16:9';
        break;
      case '--resolution':
        resolution = raw[++i] || '2K';
        break;
      case '--json':
        json = true;
        break;
      default:
        if (!raw[i].startsWith('--')) promptParts.push(raw[i]);
    }
  }

  return {
    prompt: promptParts.join(' '),
    provider,
    output,
    format,
    config,
    banner,
    brandConfig,
    aspect,
    resolution,
    json,
  };
}

function generateSvg(args: GenArgs): string {
  // Read brand config for colors
  let brand: Record<string, any> = {
    colors: { primary: '#3B82F6', secondary: '#8B5CF6', accent: '#10B981' },
  };
  const brandPath = resolve(process.cwd(), args.brandConfig || 'config/brand.json');
  if (existsSync(brandPath)) {
    try {
      brand = JSON.parse(readFileSync(brandPath, 'utf8'));
    } catch {
      /* use defaults */
    }
  }

  const colors = brand.colors || {};
  const primary = colors.primary || '#3B82F6';
  const secondary = colors.secondary || '#8B5CF6';
  const accent = colors.accent || '#10B981';
  const bgColor = colors.background || '#0F172A';
  const textColor = colors.text || '#F8FAFC';

  const bannerType = args.banner || 'hero';
  const prompt = args.prompt || 'Gentle-Vanguard';

  switch (bannerType) {
    case 'hero': {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bgColor}"/>
      <stop offset="100%" style="stop-color:${primary}33"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="280" text-anchor="middle" font-family="system-ui, sans-serif" font-size="64" font-weight="bold" fill="${textColor}">${escapeXml(prompt)}</text>
  <circle cx="200" cy="400" r="150" fill="${secondary}15" stroke="${secondary}" stroke-width="1"/>
  <circle cx="1000" cy="200" r="100" fill="${accent}15" stroke="${accent}" stroke-width="1"/>
  <rect x="400" y="480" width="400" height="60" rx="30" fill="${primary}" opacity="0.9"/>
  <text x="600" y="518" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" fill="${textColor}">Built with Gentle-Vanguard</text>
</svg>`;
    }
    case 'github': {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 320" width="1280" height="320">
  <rect width="1280" height="320" fill="${bgColor}"/>
  <rect x="40" y="40" width="1200" height="80" rx="8" fill="${primary}15"/>
  <text x="640" y="90" text-anchor="middle" font-family="system-ui, sans-serif" font-size="36" font-weight="bold" fill="${textColor}">${escapeXml(prompt)}</text>
  <text x="640" y="180" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" fill="${textColor}66">AI-Powered Development Platform</text>
</svg>`;
    }
    case 'logo': {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="${bgColor}" rx="40"/>
  <circle cx="200" cy="200" r="120" fill="none" stroke="${primary}" stroke-width="4"/>
  <circle cx="200" cy="200" r="60" fill="${primary}33" stroke="${secondary}" stroke-width="3"/>
  <text x="200" y="370" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" font-weight="bold" fill="${textColor}">GV</text>
</svg>`;
    }
    case 'icon': {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
  <rect width="80" height="80" fill="${bgColor}" rx="16"/>
  <circle cx="40" cy="40" r="24" fill="none" stroke="${primary}" stroke-width="3"/>
  <circle cx="40" cy="40" r="12" fill="${secondary}66"/>
</svg>`;
    }
    default: {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <rect width="800" height="400" fill="${bgColor}"/>
  <text x="400" y="200" text-anchor="middle" font-family="system-ui" font-size="32" fill="${textColor}">${escapeXml(prompt)}</text>
</svg>`;
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callDalle(prompt: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[IMAGE-GEN] OPENAI_API_KEY not set. Cannot use DALL-E.');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[IMAGE-GEN] DALL-E API error: ${response.status} — ${err}`);
      return null;
    }

    const data = (await response.json()) as { data: { url: string }[] };
    if (data.data?.[0]?.url) {
      const imgResponse = await fetch(data.data[0].url);
      return Buffer.from(await imgResponse.arrayBuffer());
    }
    return null;
  } catch (err) {
    console.error(`[IMAGE-GEN] DALL-E request failed: ${err}`);
    return null;
  }
}

async function callReplicate(prompt: string, model: 'stability' | 'flux'): Promise<Buffer | null> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    console.error(`[IMAGE-GEN] REPLICATE_API_TOKEN not set. Cannot use ${model}.`);
    return null;
  }

  const modelVersion =
    model === 'flux' ? 'black-forest-labs/flux-1.1-pro' : 'stability-ai/stable-diffusion-3';

  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        version: modelVersion,
        input: { prompt },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[IMAGE-GEN] Replicate API error: ${response.status} — ${err}`);
      return null;
    }

    const data = (await response.json()) as { urls?: { get?: string } };
    const getUrl = data.urls?.get;
    if (!getUrl) return null;

    // Poll for completion
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusResponse = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const status = (await statusResponse.json()) as { status?: string; output?: string[] };
      if (status.status === 'succeeded' && status.output?.[0]) {
        const imgResponse = await fetch(status.output[0]);
        return Buffer.from(await imgResponse.arrayBuffer());
      }
      if (status.status === 'failed') {
        console.error('[IMAGE-GEN] Replicate prediction failed');
        return null;
      }
    }
    return null;
  } catch (err) {
    console.error(`[IMAGE-GEN] Replicate request failed: ${err}`);
    return null;
  }
}

/**
 * Connected-app image generation (mcode-tools connector).
 *
 * This is the backend that works on a machine with no API keys: the connected
 * image app does the generation, and the asset comes back as a Matrix Drive
 * node that we resolve to a short-lived URL and download locally.
 */
function mcodeToolsAvailable(): boolean {
  try {
    const probe = spawnSync('mcode-tools --help', {
      encoding: 'utf8',
      shell: true,
      timeout: 20000,
    });
    return probe.status === 0;
  } catch {
    return false;
  }
}

/** Quote a path for a Windows shell command line. */
function shellQuote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

async function callConnector(
  prompt: string,
  aspect: string,
  resolution: string,
): Promise<{ buffer: Buffer; extension: string } | null> {
  if (!mcodeToolsAvailable()) {
    console.error('[IMAGE-GEN] mcode-tools no esta disponible en el PATH.');
    return null;
  }

  const argsFile = join(tmpdir(), `gv-image-${Date.now()}-${process.pid}.json`);
  const payload = {
    requests: [
      {
        prompt,
        aspect_ratio: aspect,
        resolution,
        output_file: `gv-image-${Date.now()}.png`,
      },
    ],
  };
  writeFileSync(argsFile, JSON.stringify(payload), 'utf8');

  try {
    const call = spawnSync(
      `mcode-tools connector call connector__matrix__generate_image --args-file ${shellQuote(argsFile)}`,
      { encoding: 'utf8', shell: true, timeout: 600000 },
    );
    if (call.status !== 0) {
      console.error(`[IMAGE-GEN] connector fallo: ${(call.stderr || call.stdout || '').trim()}`);
      return null;
    }
    let parsed: { success_items?: { node_id: string; file_name?: string }[]; message?: string };
    try {
      parsed = JSON.parse((call.stdout || '').trim());
    } catch {
      console.error('[IMAGE-GEN] respuesta del connector no interpretable');
      return null;
    }
    const item = parsed.success_items?.[0];
    if (!item?.node_id) {
      console.error(`[IMAGE-GEN] el connector no devolvio imagen: ${parsed.message ?? 'sin detalle'}`);
      return null;
    }

    const urlCall = spawnSync(`mcode-tools get_asset_url ${item.node_id}`, {
      encoding: 'utf8',
      shell: true,
      timeout: 120000,
    });
    if (urlCall.status !== 0) {
      console.error('[IMAGE-GEN] no se pudo resolver la URL del asset');
      return null;
    }
    const { download_url: downloadUrl } = JSON.parse((urlCall.stdout || '').trim()) as {
      download_url: string;
    };
    if (!downloadUrl) return null;

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      console.error(`[IMAGE-GEN] descarga fallida: ${res.status}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    // The app decides the container (png or jpg); do not lie about it.
    const fromName = (item.file_name ?? '').toLowerCase().endsWith('.jpg')
      ? '.jpg'
      : (item.file_name ?? '').toLowerCase().endsWith('.webp')
        ? '.webp'
        : '.png';
    const fromMagic = buffer[0] === 0xff && buffer[1] === 0xd8 ? '.jpg' : fromName;
    return { buffer, extension: fromMagic };
  } catch (err) {
    console.error('[IMAGE-GEN] connector error:', err);
    return null;
  } finally {
    try {
      const { unlinkSync } = await import('fs');
      if (existsSync(argsFile)) unlinkSync(argsFile);
    } catch {
      /* best effort */
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Batch mode
  if (args.config) {
    const configPath = resolve(process.cwd(), args.config);
    if (!existsSync(configPath)) {
      console.error(`[IMAGE-GEN] Config not found: ${configPath}`);
      process.exit(1);
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const items: BatchItem[] = config.images || [];
    console.error(`[IMAGE-GEN] Batch: ${items.length} images`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const batchArgs: GenArgs = {
        ...args,
        prompt: item.prompt,
        output: item.output,
        provider: (item.provider as GenArgs['provider']) || args.provider,
      };
      console.error(`[IMAGE-GEN] [${i + 1}/${items.length}] ${item.prompt}`);
      const result = await generateImage(batchArgs);
      if (!result) {
        console.error(`[IMAGE-GEN] [${i + 1}/${items.length}] FAILED`);
      }
    }
    console.error(`[IMAGE-GEN] Batch complete: ${items.length} images`);
    return;
  }

  // Single mode
  if (!args.prompt) {
    console.error(
      '[IMAGE-GEN] Usage: node --import tsx src/cli/image-gen.ts "prompt" [--provider auto|connector|dall-e|stability|flux|svg] [--aspect 16:9] [--resolution 2K] [--output file.png]',
    );
    process.exit(1);
  }

  const result = await generateImage(args);
  if (!result) {
    process.exit(1);
  }
}

async function generateImage(args: GenArgs): Promise<boolean> {
  const prompt = args.prompt;
  let imageBuffer: Buffer | null = null;
  let finalFormat = args.format || 'png';

  switch (args.provider) {
    case 'dall-e': {
      console.error(`[IMAGE-GEN] Calling DALL-E 3: "${prompt.substring(0, 60)}..."`);
      imageBuffer = await callDalle(prompt);
      finalFormat = 'png';
      break;
    }
    case 'stability':
    case 'flux': {
      console.error(`[IMAGE-GEN] Calling ${args.provider}: "${prompt.substring(0, 60)}..."`);
      imageBuffer = await callReplicate(prompt, args.provider);
      finalFormat = 'png';
      break;
    }
    case 'connector': {
      console.error(`[IMAGE-GEN] Calling connected image app: "${prompt.substring(0, 60)}..."`);
      const res = await callConnector(prompt, args.aspect, args.resolution);
      imageBuffer = res?.buffer ?? null;
      finalFormat = res ? res.extension.replace('.', '') : 'png';
      break;
    }
    case 'auto':
    default: {
      // Order: connected app (no keys needed) -> API keys -> SVG.
      if (mcodeToolsAvailable()) {
        console.error(`[IMAGE-GEN] Connected image app: "${prompt.substring(0, 60)}..."`);
        const res = await callConnector(prompt, args.aspect, args.resolution);
        imageBuffer = res?.buffer ?? null;
        finalFormat = res ? res.extension.replace('.', '') : 'png';
      }
      if (!imageBuffer && process.env.OPENAI_API_KEY) {
        console.error('[IMAGE-GEN] Falling back to DALL-E 3');
        imageBuffer = await callDalle(prompt);
        finalFormat = 'png';
      }
      if (!imageBuffer) {
        console.error('[IMAGE-GEN] Generating SVG: "' + prompt.substring(0, 60) + '..."');
        imageBuffer = Buffer.from(generateSvg(args), 'utf8');
        finalFormat = 'svg';
      }
      break;
    }
  }

  if (!imageBuffer) {
    // Fallback to SVG
    console.warn('[IMAGE-GEN] API failed, falling back to SVG template');
    const svgContent = generateSvg(args);
    imageBuffer = Buffer.from(svgContent, 'utf8');
    finalFormat = 'svg';
  }

  // Save output
  const realExt = finalFormat === 'svg' ? '.svg' : finalFormat === 'jpg' ? '.jpg' : '.png';
  let outputPath = args.output;
  if (!outputPath) {
    const timestamp = Date.now();
    outputPath = `assets/generated/image-${timestamp}${realExt}`;
  } else if (!extname(outputPath)) {
    outputPath += realExt;
  } else {
    // The backend decides the container; never write JPEG bytes into a .png.
    const wanted = extname(outputPath).toLowerCase();
    const wantedFormat = wanted === '.svg' ? 'svg' : wanted === '.jpg' || wanted === '.jpeg' ? 'jpg' : 'png';
    if (wantedFormat !== finalFormat) {
      outputPath = outputPath.slice(0, outputPath.length - wanted.length) + realExt;
    }
  }

  const fullPath = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, imageBuffer);

  if (args.json) {
    console.log(
      JSON.stringify({
        success: true,
        path: fullPath,
        format: finalFormat,
        size: imageBuffer.length,
        provider: args.provider,
      }),
    );
  } else {
    console.log(
      `[IMAGE-GEN] ✅ Saved: ${fullPath} (${(imageBuffer.length / 1024).toFixed(1)} KB, ${finalFormat})`,
    );
  }

  return true;
}

// CLI entry
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('image-gen.ts') || process.argv[1].endsWith('image-gen.js'));
if (isMain) {
  main().catch((err) => {
    console.error('[IMAGE-GEN] Fatal error:', err);
    process.exit(1);
  });
}
