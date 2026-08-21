#!/usr/bin/env node
/**
 * Image Generation CLI — native AI image generation via DALL-E, Stable Diffusion, FLUX.
 * Falls back to SVG template engine when APIs are unavailable.
 *
 * Usage:
 *   npx tsx src/cli/image-gen.ts "prompt" --provider dall-e --output img.png
 *   npx tsx src/cli/image-gen.ts --config config/image-batch.json
 *   npx tsx src/cli/image-gen.ts "banner" --provider svg --banner hero
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, extname } from 'path';

interface GenArgs {
  prompt: string;
  provider: 'dall-e' | 'stability' | 'flux' | 'svc';
  output: string;
  format: string;
  config?: string;
  banner?: string;
  batchFile?: string;
  brandConfig?: string;
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
  let provider: GenArgs['provider'] = 'svc';
  let output = '';
  let format = '';
  let config = '';
  let banner = '';
  let brandConfig = '';
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--provider':
        provider = (raw[++i] || 'svc') as GenArgs['provider'];
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
      '[IMAGE-GEN] Usage: npx tsx src/cli/image-gen.ts "prompt" [--provider dall-e|stability|flux|svg] [--output file.png]',
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
    case 'svc':
    default: {
      console.error(`[IMAGE-GEN] Generating SVG: "${prompt.substring(0, 60)}..."`);
      const svgContent = generateSvg(args);
      imageBuffer = Buffer.from(svgContent, 'utf8');
      finalFormat = 'svg';
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
  let outputPath = args.output;
  if (!outputPath) {
    const timestamp = Date.now();
    const ext = finalFormat === 'svg' ? '.svg' : '.png';
    outputPath = `assets/generated/image-${timestamp}${ext}`;
  } else if (!extname(outputPath)) {
    outputPath += finalFormat === 'svg' ? '.svg' : '.png';
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
