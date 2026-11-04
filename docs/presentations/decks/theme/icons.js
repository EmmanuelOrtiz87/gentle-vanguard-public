/**
 * Icon pipeline for the deck canon.
 *
 * Icons come from react-icons (Font Awesome 6 / Bootstrap / Material families),
 * are rendered to SVG and rasterized to PNG with sharp, then cached on disk.
 * PNG (not SVG) because SVG embedding in PPTX only works reliably on
 * PowerPoint 2016+/Microsoft 365; PNG renders everywhere.
 *
 * Icon names used by the deck content are the short keys of ICONS below.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import * as Fa from 'react-icons/fa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ICON_DIR = path.resolve(__dirname, '..', 'assets', 'icons');

/** Canonical icon set. Keys are the names used in deck content files. */
export const ICONS = {
  layers: Fa.FaLayerGroup,
  agent: Fa.FaRobot,
  shield: Fa.FaShieldAlt,
  bolt: Fa.FaBolt,
  database: Fa.FaDatabase,
  cloud: Fa.FaCloud,
  gears: Fa.FaCogs,
  diagram: Fa.FaProjectDiagram,
  branch: Fa.FaCodeBranch,
  check: Fa.FaCheckCircle,
  cross: Fa.FaTimesCircle,
  chart: Fa.FaChartLine,
  users: Fa.FaUsers,
  clock: Fa.FaClock,
  lock: Fa.FaLock,
  eye: Fa.FaEye,
  network: Fa.FaNetworkWired,
  server: Fa.FaServer,
  mobile: Fa.FaMobileAlt,
  brain: Fa.FaBrain,
  rocket: Fa.FaRocket,
  academy: Fa.FaGraduationCap,
  building: Fa.FaBuilding,
  handshake: Fa.FaHandshake,
  route: Fa.FaMapSigns,
  file: Fa.FaFileAlt,
  tools: Fa.FaTools,
  idea: Fa.FaLightbulb,
  search: Fa.FaSearch,
  sync: Fa.FaSyncAlt,
  git: Fa.FaGitAlt,
  terminal: Fa.FaTerminal,
  boxes: Fa.FaBoxes,
  puzzle: Fa.FaPuzzlePiece,
  sitemap: Fa.FaSitemap,
  book: Fa.FaBook,
  compass: Fa.FaCompass,
  plug: Fa.FaPlug,
  pie: Fa.FaChartPie,
  calendar: Fa.FaCalendarCheck,
  scale: Fa.FaBalanceScale,
  money: Fa.FaMoneyBillWave,
  stream: Fa.FaStream,
  flask: Fa.FaFlask,
  ship: Fa.FaShip,
  growth: Fa.FaChartLine,
  industry: Fa.FaIndustry,
  laptop: Fa.FaLaptopCode,
  key: Fa.FaKey,
  map: Fa.FaRoute,
  bulb: Fa.FaRegLightbulb,
  up: Fa.FaArrowUp,
  down: Fa.FaArrowDown,
  link: Fa.FaLink,
  chain: Fa.FaLink,
};

/** Fail loudly if a mapped icon does not exist in the installed icon set. */
const MISSING = Object.entries(ICONS)
  .filter(([, comp]) => !comp)
  .map(([k]) => k);
if (MISSING.length) {
  throw new Error(`react-icons/fa is missing: ${MISSING.join(', ')}`);
}

function svgFor(name, color, size = 256) {
  const Comp = ICONS[name];
  if (!Comp) throw new Error(`Unknown icon "${name}". Available: ${Object.keys(ICONS).join(', ')}`);
  return renderToStaticMarkup(React.createElement(Comp, { color, size: String(size) }));
}

/**
 * Rasterize an icon to PNG and return the absolute path.
 * Cached by (name, color) so repeat builds are instant.
 */
export async function iconPng(name, color = '#06B6D4') {
  await mkdir(ICON_DIR, { recursive: true });
  const safeColor = color.replace('#', '').toLowerCase();
  const out = path.join(ICON_DIR, `${name}-${safeColor}.png`);
  if (existsSync(out)) return out;
  const svg = svgFor(name, color, 256);
  await sharp(Buffer.from(svg), { density: 512 })
    .resize({ width: 256, height: 256, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

/**
 * Every accent the layouts can ask for. Icons are cached per (name, color),
 * so this list is the full render matrix.
 */
export const ICON_COLORS = [
  '#06b6d4', // accent cyan (dark)
  '#0891b2', // cyan deep
  '#67e8f9', // cyan soft
  '#8b5cf6', // purple (dark)
  '#7c3aed', // purple deep
  '#c4b5fd', // purple soft
  '#fbbf24', // gold
  '#e8eef4', // text
  '#c4cdd8', // muted
  '#8b95a8', // faint
  '#ee6d75', // error
  '#f4bb4f', // warning
  '#22d3ee', // info
  '#4ade80', // success
  '#155e75', // accent text (light)
  '#6d28d9', // accent alt text (light)
  '#a16207', // gold on light
  '#0e7490', // cyan on light
];

/** Pre-rasterize every icon in every requested color. */
export async function buildIcons(colors = ICON_COLORS) {
  await mkdir(ICON_DIR, { recursive: true });
  let n = 0;
  for (const name of Object.keys(ICONS)) {
    for (const color of colors) {
      await iconPng(name, color);
      n++;
    }
  }
  return n;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = await buildIcons();
  console.log(`rasterized ${n} icon files into ${ICON_DIR}`);
}
