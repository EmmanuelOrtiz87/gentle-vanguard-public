#!/usr/bin/env node

/**
 * svg-generator.ts — Programmatic SVG generation from brand configuration
 *
 * Generates branded SVG assets (logos, banners, icons) from config/brand.json.
 * Can produce banners for GitHub, LinkedIn, Twitter/X, Open Graph, and docs.
 *
 * Usage:
 *   npx tsx src/cli/svg-generator.ts --type banner-github     # Generate GitHub banner
 *   npx tsx src/cli/svg-generator.ts --type banner-linkedin    # Generate LinkedIn banner
 *   npx tsx src/cli/svg-generator.ts --type banner-twitter     # Generate Twitter/X banner
 *   npx tsx src/cli/svg-generator.ts --type banner-og          # Generate Open Graph banner
 *   npx tsx src/cli/svg-generator.ts --type logo-primary       # Generate primary logo
 *   npx tsx src/cli/svg-generator.ts --type logo-icon          # Generate icon only
 *   npx tsx src/cli/svg-generator.ts --type all                # Generate all assets
 *   npx tsx src/cli/svg-generator.ts --type all --output-dir docs/brand/assets/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());

// ─── Brand Config ──────────────────────────────────────────────────────────────

interface BrandConfig {
  name: string;
  tagline: string;
  version: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    success: string;
    warning: string;
    error: string;
    gradients: {
      primary: string[];
      secondary: string[];
      dark: string[];
    };
  };
  typography: {
    fontFamily: string;
    fontFamilyMonospace: string;
    headings: { fontWeight: string; letterSpacing: string; lineHeight: string };
    body: { fontWeight: string; letterSpacing: string; lineHeight: string };
  };
  dimensions: {
    logo: { width: number; height: number };
    icon: { width: number; height: number };
    favicon: { width: number; height: number };
    banners: Record<string, { width: number; height: number; label: string }>;
  };
}

function loadBrandConfig(): BrandConfig {
  const configPath = join(ROOT, 'config', 'brand.json');
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  // Default brand config if file not found
  return {
    name: 'Gentle-Vanguard',
    tagline: 'AI-Powered Development Orchestrator',
    version: '3.3.3',
    colors: {
      primary: '#6366f1',
      secondary: '#8b5cf6',
      accent: '#06b6d4',
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f8fafc',
      textSecondary: '#94a3b8',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      gradients: {
        primary: ['#6366f1', '#8b5cf6'],
        secondary: ['#8b5cf6', '#06b6d4'],
        dark: ['#0f172a', '#1e293b'],
      },
    },
    typography: {
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontFamilyMonospace: "'Fira Code', 'Cascadia Code', monospace",
      headings: { fontWeight: '700', letterSpacing: '-0.02em', lineHeight: '1.2' },
      body: { fontWeight: '400', letterSpacing: '0', lineHeight: '1.6' },
    },
    dimensions: {
      logo: { width: 400, height: 100 },
      icon: { width: 64, height: 64 },
      favicon: { width: 32, height: 32 },
      banners: {
        'banner-github': { width: 1280, height: 320, label: 'GitHub Header' },
        'banner-linkedin': { width: 1584, height: 396, label: 'LinkedIn Banner' },
        'banner-twitter': { width: 1500, height: 500, label: 'Twitter/X Header' },
        'banner-og': { width: 1200, height: 630, label: 'Open Graph' },
        'banner-docs': { width: 900, height: 120, label: 'Docs Banner' },
      },
    },
  };
}

const args = process.argv.slice(2);

interface Options {
  type: string;
  outputDir: string;
  text: string;
  subtitle: string;
}

const options: Options = {
  type: args.includes('--type') ? args[args.indexOf('--type') + 1] || 'all' : 'all',
  outputDir: args.includes('--output-dir') ? args[args.indexOf('--output-dir') + 1] || '' : '',
  text: args.includes('--text') ? args[args.indexOf('--text') + 1] || '' : '',
  subtitle: args.includes('--subtitle') ? args[args.indexOf('--subtitle') + 1] || '' : '',
};

function ok(msg: string): void {
  console.log(`[OK] ${msg}`);
}
function err(msg: string): void {
  console.error(`[ERROR] ${msg}`);
}

const brand = loadBrandConfig();
const C = brand.colors;
const T = brand.typography;
const DIM = brand.dimensions;

// ─── SVG Builders ──────────────────────────────────────────────────────────────

function shieldSVG(_w: number, _h: number, cx: number, cy: number, scale: number = 1): string {
  const s = scale;
  const pts = [
    `${cx},${cy - 28 * s}`,
    `${cx + 24 * s},${cy - 12 * s}`,
    `${cx + 24 * s},${cy + 8 * s}`,
    `${cx},${cy + 28 * s}`,
    `${cx - 24 * s},${cy + 8 * s}`,
    `${cx - 24 * s},${cy - 12 * s}`,
  ].join(' ');
  return `<polygon points="${pts}" fill="url(#primaryGrad)" opacity="0.9"/>
    <polygon points="${pts}" fill="none" stroke="${C.accent}" stroke-width="${1.5 * s}" opacity="0.4"/>
    <text x="${cx}" y="${cy + 1 * s}" text-anchor="middle" fill="${C.text}" font-size="${14 * s}" font-weight="bold" font-family="${T.fontFamilyMonospace}">GV</text>`;
}

function bannerBackground(w: number, h: number): string {
  return `<defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.gradients.dark[0]}"/>
      <stop offset="50%" stop-color="${C.gradients.dark[1]}"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.gradients.primary[0]}"/>
      <stop offset="100%" stop-color="${C.gradients.primary[1]}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bgGrad)"/>
  <rect width="${w}" height="${h}" fill="url(#accentGrad)" opacity="0.15"/>`;
}

function gridPattern(w: number, h: number): string {
  return `<defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${C.textSecondary}" stroke-width="0.5" opacity="0.08"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>`;
}

function generateBanner(type: string): string {
  const dims = DIM.banners[type];
  if (!dims) {
    err(`Unknown banner type: ${type}`);
    return '';
  }

  const { width: w, height: h } = dims;
  const title = options.text || brand.name;
  const subtitle = options.subtitle || brand.tagline;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  ${bannerBackground(w, h)}
  ${gridPattern(w, h)}

  <!-- Decorative circles -->
  <circle cx="${w * 0.85}" cy="${h * 0.2}" r="${Math.min(w, h) * 0.12}" fill="none" stroke="${C.secondary}" stroke-width="1" opacity="0.15"/>
  <circle cx="${w * 0.9}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.08}" fill="none" stroke="${C.accent}" stroke-width="0.8" opacity="0.1"/>

  <!-- Shield icon -->
  ${shieldSVG(w, h, w * 0.12, h * 0.5, Math.min(w, h) / 300)}

  <!-- Title -->
  <text x="${w * 0.22}" y="${h * 0.44}" font-family="${T.fontFamily}" font-size="${Math.round(Math.min(w, h) * 0.065)}" font-weight="${T.headings.fontWeight}" fill="${C.text}" letter-spacing="${T.headings.letterSpacing}">
    ${title}
  </text>

  <!-- Subtitle -->
  <text x="${w * 0.22}" y="${h * 0.62}" font-family="${T.fontFamily}" font-size="${Math.round(Math.min(w, h) * 0.035)}" fill="${C.textSecondary}" letter-spacing="0.05em">
    ${subtitle}
  </text>

  <!-- Version badge -->
  <rect x="${w * 0.22}" y="${h * 0.68}" width="${Math.round(w * 0.1)}" height="${Math.round(h * 0.055)}" rx="${Math.round(h * 0.027)}" fill="${C.primary}" opacity="0.3"/>
  <text x="${w * 0.27}" y="${h * 0.72}" text-anchor="middle" font-family="${T.fontFamilyMonospace}" font-size="${Math.round(Math.min(w, h) * 0.022)}" fill="${C.accent}">v${brand.version}</text>
</svg>`;

  return svg;
}

function generateLogo(): string {
  const { width: w, height: h } = DIM.logo;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.gradients.primary[0]}"/>
      <stop offset="100%" stop-color="${C.gradients.primary[1]}"/>
    </linearGradient>
  </defs>

  <!-- Shield -->
  ${shieldSVG(w, h, 50, h / 2, 1.2)}

  <!-- Text -->
  <text x="90" y="${h * 0.48}" font-family="${T.fontFamily}" font-size="28" font-weight="${T.headings.fontWeight}" fill="${C.text}" letter-spacing="${T.headings.letterSpacing}">
    Gentle<tspan fill="${C.primary}">-</tspan>Vanguard
  </text>
  <text x="90" y="${h * 0.72}" font-family="${T.fontFamilyMonospace}" font-size="11" fill="${C.textSecondary}" letter-spacing="0.15em">
    AI-POWERED DEVELOPMENT ORCHESTRATOR
  </text>
</svg>`;
}

function generateIcon(): string {
  const { width: w, height: h } = DIM.icon;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.gradients.primary[0]}"/>
      <stop offset="100%" stop-color="${C.gradients.primary[1]}"/>
    </linearGradient>
  </defs>

  <rect width="${w}" height="${h}" rx="12" fill="#1e293b" stroke="${C.primary}" stroke-width="1.5" opacity="0.8"/>
  ${shieldSVG(w, h, w / 2, h / 2, 0.7)}
</svg>`;
}

function generateFavicon(): string {
  const { width: w, height: h } = DIM.favicon;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.gradients.primary[0]}"/>
      <stop offset="100%" stop-color="${C.gradients.primary[1]}"/>
    </linearGradient>
  </defs>
  ${shieldSVG(w, h, w / 2, h / 2, 0.35)}
</svg>`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('');
  console.log('========================================');
  console.log('  SVG Asset Generator');
  console.log('========================================');
  console.log('');
  console.log(`  Brand: ${brand.name} v${brand.version}`);
  console.log(`  Output: ${options.outputDir || 'docs/brand/assets/'}`);
  console.log('');

  const outputDir = options.outputDir || join(ROOT, 'docs', 'brand', 'assets');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const types =
    options.type === 'all'
      ? [...Object.keys(DIM.banners), 'logo-primary', 'logo-icon', 'favicon']
      : [options.type];

  let count = 0;
  for (const type of types) {
    let svg = '';
    let filename = '';

    if (type.startsWith('banner-')) {
      svg = generateBanner(type);
      filename = `${type}.svg`;
    } else if (type === 'logo-primary') {
      svg = generateLogo();
      filename = 'logo-primary.svg';
    } else if (type === 'logo-icon') {
      svg = generateIcon();
      filename = 'logo-icon.svg';
    } else if (type === 'favicon') {
      svg = generateFavicon();
      filename = 'favicon.svg';
    }

    if (svg) {
      const outputPath = join(outputDir, filename);
      writeFileSync(outputPath, svg, 'utf-8');
      ok(`Generated: ${filename}`);
      count++;
    }
  }

  console.log('');
  ok(`Generated ${count} SVG assets in ${outputDir}`);
}

main();
