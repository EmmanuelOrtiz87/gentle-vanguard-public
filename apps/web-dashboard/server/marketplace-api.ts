import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const SKILLS_DIR = join(__dirname, '..', '..', '..', 'skills');
const DATA_PATH = join(__dirname, '..', 'data', 'marketplace.json');
const INSTALLED_PATH = join(__dirname, '..', '..', '..', '.runtime', 'marketplace', 'installed.json');
const VERSIONS_DIR = join(__dirname, '..', '..', '..', '.runtime', 'marketplace', 'versions');
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '.runtime', 'marketplace', 'migrations');

export interface SkillListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  reviews: Review[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  triggers?: string[];
  agentType?: string;
  skillPath?: string;
  installedAt?: string;
  reviewStatus?: 'legacy' | 'pending' | 'approved' | 'rejected';
  validation?: { valid: boolean; errors: string[] };
}

export interface Review {
  id: string;
  user: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface CreateSkillPayload {
  name: string;
  description: string;
  author: string;
  version?: string;
  tags?: string[];
  triggers?: string[];
  agentType?: string;
  skillContent: string;
}

export interface MarketplaceVersion {
  version: string;
  createdAt: string;
  content: string;
}

function loadMarketplace(): SkillListing[] {
  if (!existsSync(DATA_PATH)) {
    return [];
  }
  try {
    const data = readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveMarketplace(listings: SkillListing[]) {
  const dir = join(DATA_PATH, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DATA_PATH, JSON.stringify(listings, null, 2));
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split('\n');
  // YAML block-scalar indicators introduce an indented literal/folded block;
  // alone they are NOT a value.
  const BLOCK_SCALAR_RE = /^[>|][+-]?\d*$/;
  for (let i = 0; i < lines.length; i++) {
    const kvMatch = lines[i].match(/^\s*(\w[\w-]*):\s*(.*)$/);
    if (!kvMatch) continue;
    let value: unknown = kvMatch[2].trim();
    if (value === '' || BLOCK_SCALAR_RE.test(value as string)) {
      // Multi-line folded/literal scalar: consecutive more-indented lines
      // until the next `key:` line belong to this value.
      const parts: string[] = [];
      let j = i + 1;
      // Frontmatter keys are top-level (no leading whitespace); block-scalar
      // content is always indented, so only non-indented `key:` lines end the
      // block — content like "Skill: Live Traceability" must NOT.
      while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^\w[\w-]*:\s/.test(lines[j])) {
        parts.push(lines[j].trim());
        j++;
      }
      if (parts.length > 0) {
        value = parts.join(' ');
        i = j - 1;
      } else if (value !== '') {
        // Indicator with no block content — treat as empty.
        value = '';
      }
    }
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
    else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
    frontmatter[kvMatch[1]] = value;
  }
  return frontmatter;
}

// Canonical section vocabulary actually used across the stack catalog.
// Headings are matched case-insensitively at line start (linear patterns —
// no nested quantifiers).
const USAGE_HEADING_RE =
  /^##\s+(usage|when to use|uso|cuando usar|how to use|workflow|execution steps|activation contract|instructions|steps)\b/im;
const EXAMPLES_HEADING_RE =
  /^##\s+(examples?|ejemplos?|sample|samples|api reference|worked example)\b/im;

export function validateSkillStructure(skillContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!skillContent || skillContent.trim().length === 0) {
    return { valid: false, errors: ['SKILL.md content is empty'] };
  }

  if (!/^---/.test(skillContent)) {
    errors.push('Missing YAML frontmatter (must start with ---)');
  }

  const frontmatter = parseFrontmatter(skillContent);
  if (!frontmatter.name) {
    errors.push("Frontmatter must include 'name' field");
  }
  if (!frontmatter.description || !String(frontmatter.description).trim()) {
    errors.push("Frontmatter must include 'description' field");
  }

  if (!USAGE_HEADING_RE.test(skillContent)) {
    errors.push("Missing '## Usage' or '## When to Use' section");
  }

  if (!EXAMPLES_HEADING_RE.test(skillContent)) {
    errors.push("Missing '## Examples' section");
  }

  return { valid: errors.length === 0, errors };
}

function scanSkillsDirectory(): SkillListing[] {
  if (!existsSync(SKILLS_DIR)) {
    return [];
  }

  const listings: SkillListing[] = [];
  const entries = readdirSync(SKILLS_DIR);

  for (const entry of entries) {
    const skillPath = join(SKILLS_DIR, entry);
    if (!statSync(skillPath).isDirectory()) continue;

    const skillMdPath = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      listings.push({
        id: `skill-${entry}`,
        name: (frontmatter.name as string) || entry,
        description: (frontmatter.description as string) || '',
        author:
          ((frontmatter.metadata as Record<string, unknown>)?.author as string) || 'community',
        version: ((frontmatter.metadata as Record<string, unknown>)?.version as string) || '1.0.0',
        downloads: 0,
        rating: 0,
        reviews: [],
        tags: [],
        createdAt: (frontmatter.created as string) || new Date().toISOString(),
        updatedAt: (frontmatter.updated as string) || new Date().toISOString(),
        triggers: [],
        agentType: (frontmatter.agent as string) || 'any',
        skillPath: skillPath,
        reviewStatus: 'legacy',
        validation: validateSkillStructure(content),
      });
    } catch {
      continue;
    }
  }

  return listings;
}

export function getListings(): SkillListing[] {
  const dbListings = loadMarketplace();
  const fsListings = scanSkillsDirectory();

  const merged = new Map<string, SkillListing>();

  for (const l of fsListings) {
    merged.set(l.id, l);
  }

  for (const l of dbListings) {
    if (merged.has(l.id)) {
      const existing = merged.get(l.id);
      if (!existing) continue;
      existing.downloads = l.downloads;
      existing.rating = l.rating;
      existing.reviews = l.reviews;
      existing.tags = l.tags;
      existing.triggers = l.triggers;
      existing.agentType = l.agentType || existing.agentType;
      existing.reviewStatus = l.reviewStatus || existing.reviewStatus;
    } else {
      merged.set(l.id, l);
    }
  }

  return Array.from(merged.values());
}

export function getListing(id: string): SkillListing | undefined {
  return getListings().find((l) => l.id === id);
}

export function createListing(payload: CreateSkillPayload): SkillListing {
  const valid = validateSkillStructure(payload.skillContent);
  if (!valid.valid) {
    throw new Error(`Validation failed: ${valid.errors.join('; ')}`);
  }

  const existing = getListings().find((l) => l.name === payload.name);
  if (existing) {
    throw new Error(`Skill named '${payload.name}' already exists`);
  }

  const skillDir = join(SKILLS_DIR, payload.name);
  if (existsSync(skillDir)) {
    throw new Error(`Directory 'skills/${payload.name}' already exists`);
  }

  mkdirSync(skillDir, { recursive: true });

  const skillMdPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillMdPath, payload.skillContent, 'utf-8');

  const now = new Date().toISOString();
  const newListing: SkillListing = {
    id: `skill-${payload.name}`,
    name: payload.name,
    description: payload.description,
    author: payload.author,
    version: payload.version || '1.0.0',
    downloads: 0,
    rating: 0,
    reviews: [],
    tags: payload.tags || [],
    createdAt: now,
    updatedAt: now,
    triggers: payload.triggers || [],
    agentType: payload.agentType || 'any',
    skillPath: skillDir,
    reviewStatus: 'pending',
    validation: valid,
  };

  const allListings = loadMarketplace();
  allListings.push(newListing);
  saveMarketplace(allListings);

  return newListing;
}

export function addReview(listingId: string, review: Omit<Review, 'id' | 'createdAt'>): Review {
  const listings = loadMarketplace();
  let listing = listings.find((l) => l.id === listingId);
  if (!listing) {
    const fsListings = scanSkillsDirectory();
    const fsListing = fsListings.find((l) => l.id === listingId);
    if (!fsListing) {
      throw new Error('Listing not found');
    }
    listing = { ...fsListing };
    listings.push(listing);
  }

  const newReview: Review = {
    ...review,
    id: `review-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  listing.reviews.push(newReview);
  listing.rating = listing.reviews.reduce((acc, r) => acc + r.rating, 0) / listing.reviews.length;
  listing.updatedAt = new Date().toISOString();

  saveMarketplace(listings);
  return newReview;
}

export function incrementDownloads(listingId: string): number {
  const listings = loadMarketplace();
  let listing = listings.find((l) => l.id === listingId);
  if (!listing) {
    const fsListings = scanSkillsDirectory();
    const fsListing = fsListings.find((l) => l.id === listingId);
    if (!fsListing) {
      return 0;
    }
    listing = { ...fsListing, downloads: 0 };
    listings.push(listing);
  }

  listing.downloads++;
  listing.updatedAt = new Date().toISOString();
  saveMarketplace(listings);
  return listing.downloads;
}

export function installListing(listingId: string): { id: string; name: string; installedAt: string; path: string } | null {
  const listing = getListing(listingId);
  if (!listing || listing.reviewStatus === 'rejected' || !listing.skillPath || !existsSync(listing.skillPath)) return null;
  const installed = existsSync(INSTALLED_PATH)
    ? JSON.parse(readFileSync(INSTALLED_PATH, 'utf-8')) as Record<string, { name: string; installedAt: string; path: string }>
    : {};
  const record = {
    name: listing.name,
    installedAt: new Date().toISOString(),
    path: listing.skillPath,
  };
  installed[listing.id] = record;
  mkdirSync(join(INSTALLED_PATH, '..'), { recursive: true });
  writeFileSync(INSTALLED_PATH, JSON.stringify(installed, null, 2), 'utf-8');
  incrementDownloads(listingId);
  return { id: listing.id, ...record };
}

export function getCatalogValidationReport() {
  const entries = scanSkillsDirectory().map((listing) => ({
    id: listing.id,
    name: listing.name,
    status: listing.reviewStatus,
    validation: listing.validation,
  }));
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    valid: entries.filter((entry) => entry.validation?.valid).length,
    invalid: entries.filter((entry) => !entry.validation?.valid).length,
    entries,
  };
}

export function updateListingReviewStatus(
  listingId: string,
  status: 'approved' | 'rejected',
): SkillListing | null {
  const listing = getListing(listingId);
  if (!listing || (status === 'approved' && !listing.validation?.valid)) return null;
  const listings = loadMarketplace();
  let stored = listings.find((item) => item.id === listingId);
  if (!stored) {
    stored = { ...listing };
    listings.push(stored);
  }
  stored.reviewStatus = status;
  stored.updatedAt = new Date().toISOString();
  saveMarketplace(listings);
  return { ...listing, reviewStatus: status, updatedAt: stored.updatedAt };
}

export function createMigrationDraft(listingId: string): { id: string; path: string; errors: string[] } | null {
  const listing = getListing(listingId);
  if (!listing?.skillPath) return null;
  const content = getSkillContent(listing.skillPath);
  if (!content) return null;
  const validation = validateSkillStructure(content);
  const path = join(MIGRATIONS_DIR, listingId);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'ORIGINAL-SKILL.md'), content, 'utf8');
  const { content: draft } = migrateSkillContent(content);
  writeFileSync(join(path, 'DRAFT-SKILL.md'), draft, 'utf8');
  writeFileSync(join(path, 'MIGRATION.json'), JSON.stringify({
    id: listingId,
    name: listing.name,
    generatedAt: new Date().toISOString(),
    source: listing.skillPath,
    errors: validation.errors,
    status: 'DRAFT',
  }, null, 2), 'utf8');
  return { id: listingId, path, errors: validation.errors };
}

export function createAllMigrationDrafts(limit = 250) {
  const invalid = getCatalogValidationReport().entries.filter((entry) => !entry.validation?.valid).slice(0, Math.max(1, Math.min(250, limit)));
  const drafts = invalid.map((entry) => createMigrationDraft(entry.id)).filter(Boolean);
  return { total: invalid.length, created: drafts.length, drafts };
}

// ── Native migration engine ───────────────────────────────────────────────
// Rewrites legacy SKILL.md files into the canonical structure using ONLY
// content derived from each skill itself (frontmatter, body headings, real
// code blocks). Originals are backed up under .runtime/marketplace/migrations/
// with a MIGRATION.json record for rollback.

/** First plain prose line of the body (skips headings, fences, tables). */
function deriveDescriptionFromBody(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') || t === '---') continue;
    const clean = sanitizeDerived(t);
    if (clean.length >= 12) return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
  }
  return '';
}

/**
 * Strip YAML/markdown artifacts (block-scalar indicators, wrapping quotes,
 * bullets) from fragments derived from frontmatter or prose.
 */
function sanitizeDerived(text: string): string {
  return text
    .replace(/^[>|][+-]?\d*\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the first fenced code block (real example material). */
function firstCodeBlock(body: string): string | null {
  const m = body.match(/```[a-zA-Z0-9]*\n[\s\S]*?\n```/);
  return m ? m[0] : null;
}

function firstH1(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function firstSentence(text: string): string {
  const t = sanitizeDerived(text);
  const m = t.match(/^(.+?[.:])\s/);
  const out = (m ? m[1] : t).slice(0, 200).trim();
  // Reject junk fragments (bare indicators, single symbols).
  return out.replace(/[>|"'`]/g, '').length >= 8 ? out : '';
}

/**
 * Transform legacy SKILL.md content into the canonical structure.
 * Pure function — returns the migrated content plus a human-readable change log.
 */
export function migrateSkillContent(content: string): { content: string; changes: string[] } {
  const changes: string[] = [];
  let next = content;

  const fmMatch = next.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm = parseFrontmatter(next);
  const bodyStart = fmMatch ? fmMatch[0].length : 0;
  const body = next.slice(bodyStart);

  // 1. Frontmatter description empty → derive from body prose.
  if ((!fm.description || !String(fm.description).trim()) && fmMatch) {
    const derived = deriveDescriptionFromBody(body);
    if (derived) {
      const fmBody = fmMatch[1];
      const emptyDescRe = /^([ \t]*)description:[ \t]*$/m;
      let newFm: string;
      if (emptyDescRe.test(fmBody)) {
        newFm = fmBody.replace(emptyDescRe, (_m, indent: string) => `${indent}description: ${derived}`);
      } else if (!/^[ \t]*description:/m.test(fmBody)) {
        newFm = `${fmBody}\ndescription: ${derived}`;
      } else {
        newFm = fmBody;
      }
      if (newFm !== fmBody) {
        next = next.replace(fmMatch[0], `---${newFm}\n---`);
        changes.push(`frontmatter: description filled from body ("${derived.slice(0, 60)}…")`);
      }
    }
  }

  // 2. Missing usage-like section → canonical ## Usage from real metadata.
  if (!USAGE_HEADING_RE.test(next)) {
    const name = String(fm.name || firstH1(body, 'this skill'));
    const triggers = sanitizeDerived(String(fm.triggers || ''));
    const purpose = firstSentence(String(fm.description || '')) || deriveDescriptionFromBody(body);
    const triggerList = triggers || name;
    const purposeLine = purpose ? `\n\nPurpose: ${purpose}` : '';
    next = `${next.trimEnd()}\n\n## Usage\n\nUse **${name}** when a task matches its triggers (${triggerList}).${purposeLine}\n`;
    changes.push('added canonical ## Usage (derived from frontmatter)');
  }

  // 3. Missing examples-like section → prefer a real code block from the body.
  if (!EXAMPLES_HEADING_RE.test(next)) {
    const code = firstCodeBlock(body);
    const name = String(fm.name || firstH1(body, 'this skill'));
    if (code) {
      next = `${next.trimEnd()}\n\n## Examples\n\nConcrete usage drawn from this skill's own documentation:\n\n${code}\n`;
      changes.push('added ## Examples from existing code block');
    } else {
      const purpose = firstSentence(String(fm.description || '')) || deriveDescriptionFromBody(body);
      const resultLine = purpose || 'the outcome this skill documents.';
      next = `${next.trimEnd()}\n\n## Examples\n\n**Input:** a task matching \`${name}\` triggers.\n**Action:** apply the workflow described above.\n**Expected result:** ${resultLine}\n`;
      changes.push('added ## Examples template (no code block found in source)');
    }
  }

  return { content: next, changes };
}

/**
 * Apply the native migration to a single listing: backs up the original,
 * rewrites SKILL.md and records an APPLIED MIGRATION.json for rollback.
 */
export function applyMigration(listingId: string): { id: string; applied: boolean; changes: string[] } | null {
  const listing = getListing(listingId);
  if (!listing?.skillPath) return null;
  const content = getSkillContent(listing.skillPath);
  if (!content) return null;
  const validation = validateSkillStructure(content);
  if (validation.valid) {
    return { id: listingId, applied: false, changes: ['already valid — nothing to do'] };
  }

  const dir = join(MIGRATIONS_DIR, listingId);
  mkdirSync(dir, { recursive: true });
  const backupPath = join(dir, 'ORIGINAL-SKILL.md');
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, content, 'utf8');
  }

  const { content: migrated, changes } = migrateSkillContent(content);
  writeFileSync(join(listing.skillPath, 'SKILL.md'), migrated, 'utf8');
  writeFileSync(
    join(dir, 'MIGRATION.json'),
    JSON.stringify(
      {
        id: listingId,
        name: listing.name,
        appliedAt: new Date().toISOString(),
        source: listing.skillPath,
        errorsBefore: validation.errors,
        changes,
        status: 'APPLIED',
        backup: backupPath,
      },
      null,
      2,
    ),
    'utf8',
  );
  return { id: listingId, applied: true, changes };
}

/**
 * Retry a filesystem-touching action with linear backoff. Node on Windows can
 * hit transient sharing violations (AV/indexer) even when the file is writable.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => T, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await sleep(250 * (i + 1));
    }
  }
  throw lastError;
}

/** Bulk-apply native migrations to every invalid catalog entry (up to limit). */
export async function applyAllMigrations(limit = 250) {
  const invalid = getCatalogValidationReport().entries
    .filter((entry) => !entry.validation?.valid)
    .slice(0, Math.max(1, Math.min(250, limit)));
  const results: NonNullable<ReturnType<typeof applyMigration>>[] = [];
  for (const entry of invalid) {
    try {
      const r = await withRetry(() => applyMigration(entry.id));
      if (r) results.push(r);
    } catch {
      // Skip entries that keep failing after retries.
    }
  }
  return { total: invalid.length, applied: results.filter((r) => r.applied).length, results };
}

export function uninstallListing(listingId: string): boolean {
  if (!existsSync(INSTALLED_PATH)) return false;
  try {
    const installed = JSON.parse(readFileSync(INSTALLED_PATH, 'utf-8')) as Record<string, unknown>;
    if (!(listingId in installed)) return false;
    delete installed[listingId];
    writeFileSync(INSTALLED_PATH, JSON.stringify(installed, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function versionPath(listingId: string, version: string): string {
  if (!/^skill-[a-z0-9-]+$/.test(listingId) || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Invalid listing id or semantic version');
  }
  return join(VERSIONS_DIR, listingId, `${version}.json`);
}

export function getListingVersions(listingId: string): MarketplaceVersion[] {
  if (!/^skill-[a-z0-9-]+$/.test(listingId)) return [];
  const dir = join(VERSIONS_DIR, listingId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(dir, file), 'utf8')) as MarketplaceVersion;
      } catch {
        return null;
      }
    })
    .filter((version): version is MarketplaceVersion => Boolean(version))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createListingVersion(listingId: string, version: string, content: string): MarketplaceVersion {
  const listing = getListing(listingId);
  if (!listing || !listing.skillPath) throw new Error('Listing not found');
  if (!validateSkillStructure(content).valid) throw new Error('Version content failed skill validation');
  const path = versionPath(listingId, version);
  if (existsSync(path)) throw new Error(`Version ${version} already exists`);
  const record = { version, createdAt: new Date().toISOString(), content };
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  writeFileSync(join(listing.skillPath, 'SKILL.md'), content, 'utf8');
  const listings = loadMarketplace();
  const stored = listings.find((item) => item.id === listingId);
  if (stored) {
    stored.version = version;
    stored.updatedAt = record.createdAt;
    saveMarketplace(listings);
  }
  return record;
}

export function rollbackListing(listingId: string, version: string): MarketplaceVersion | null {
  const listing = getListing(listingId);
  const path = versionPath(listingId, version);
  if (!listing?.skillPath || !existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, 'utf8')) as MarketplaceVersion;
  writeFileSync(join(listing.skillPath, 'SKILL.md'), record.content, 'utf8');
  const listings = loadMarketplace();
  const stored = listings.find((item) => item.id === listingId);
  if (stored) {
    stored.version = version;
    stored.updatedAt = new Date().toISOString();
    saveMarketplace(listings);
  }
  return record;
}

export function getSkillContent(skillPath: string): string | null {
  const skillMdPath = join(skillPath, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;
  try {
    return readFileSync(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
}
