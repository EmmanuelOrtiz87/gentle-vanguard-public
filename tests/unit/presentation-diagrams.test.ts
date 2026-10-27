import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const presentations = join(root, 'docs/presentations');
const expectedDiagrams = [
  'architecture-layers',
  'pipeline-flow',
  'data-architecture',
  'governance-tiers',
  'executive-loop',
  'setup-flow',
  'stack-dashboard',
  'nexus-backup-policy',
  'planning-estimates',
  'release-gates',
].map((name) => `${name}.svg`);
expectedDiagrams.sort();
const historicalEvidencePages = [
  'agents-pipeline.html',
  'architecture.html',
  'autonomy.html',
  'case-study-before-after.html',
  'commands.html',
  'dashboard.html',
  'health.html',
  'index.html',
  'knowledge-systems.html',
  'glossary.html',
  'marketing.html',
  'memory-knowledge.html',
  'operations-cloud.html',
  'quickstart.html',
  'resources-index.html',
  'security-governance.html',
  'social-post.html',
  'study-material.html',
  'v4-features.html',
];

test('all presentation pages route diagrams to the central gallery', () => {
  const pages = readdirSync(presentations).filter((name) => name.endsWith('.html'));
  assert.ok(pages.includes('diagrams.html'));

  for (const page of pages) {
    const html = readFileSync(join(presentations, page), 'utf8');
    assert.match(html, /href="diagrams\.html"/, `${page} must link to the gallery`);
    assert.doesNotMatch(html, /index\.html#diagrams/, `${page} must not link to an inline gallery`);
    assert.doesNotMatch(
      html,
      /<(?:section|div)\b[^>]*\bid=["']diagrams["']/i,
      `${page} must not contain a repeated diagrams section`,
    );
  }
});

test('the landing page summarizes dated stack evidence and its limits', () => {
  const index = readFileSync(join(presentations, 'index.html'), 'utf8');
  const hero = index.match(/<header class="hero" id="overview">[\s\S]*?<\/header>/)?.[0];
  const summary = index.match(
    /<section\b[^>]*\bid="stack-update-summary"[^>]*>[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(hero, 'the landing page must contain its hero');
  assert.match(hero, /<div class="stat-n">LOCAL<\/div>/);
  assert.match(hero, /data-i18n="presence_nexus"/);
  assert.doesNotMatch(hero, /Tablas Nexus|>43</);
  assert.doesNotMatch(
    index,
    /16 repos|16 migrations|16 migraciones|16 migrações|23 tables|23 tablas|23 tabelas|100% autonomous|100% autónom|100% autônom|117 steps|112 enabled|83 lazy|101 steps|21 specialized|21 subagentes|v3\.5\.0/i,
  );
  const translations = readFileSync(join(presentations, 'assets/js/i18n-content.js'), 'utf8');
  const currentIndexTranslations = [
    ...translations.matchAll(
      /^\s*c_index_(?:4|5|6|7|14|15|16|29|45|55|56|58|59|68|69|71|77|82|83|117):([\s\S]*?)(?=^\s*c_index_\d+:|$)/gm,
    ),
  ]
    .map((match) => match[1])
    .join('\n');
  assert.doesNotMatch(
    currentIndexTranslations,
    /16 repos|16 migrations|16 migraciones|16 migrações|23 tables|23 tablas|23 tabelas|100% autonomous|100% autónom|100% autônom|117 steps|112 enabled|83 lazy|101 steps|21 specialized|21 subagentes|3,600\+|10,000\+|20,000\+|95 checks|96 checks|154 checks|25\+ REST endpoints|8 alert rules|8 reglas de alerta|8 regras de alerta|6 jobs \+ 3 security|60 normatives/i,
  );
  assert.ok(summary, 'the landing page must contain the current stack summary');
  assert.match(summary, /20-10-2026/);
  assert.match(summary, /165 PASS/);
  assert.match(summary, /offsite/);
  assert.match(summary, /uncalibrated/);
  assert.match(summary, /CI hospedado/);
  assert.match(summary, /stack-assessment-2026-10\.md/);
});

test('pages with legacy quantified claims label them as non-current in all supported languages', () => {
  const translations = readFileSync(join(presentations, 'assets/js/i18n-extra.js'), 'utf8');
  assert.equal(
    [...translations.matchAll(/presentation_evidence_note:/g)].length,
    3,
    'the historical evidence note must be translated for EN, ES and PT-BR',
  );

  for (const page of historicalEvidencePages) {
    const html = readFileSync(join(presentations, page), 'utf8');
    assert.match(
      html,
      /class="gv-evidence-note"[^>]*data-i18n="presentation_evidence_note"/,
      `${page} must visibly qualify its quantified and capability claims`,
    );
  }
});

test('the gallery displays every current accessible SVG asset', () => {
  const galleryPath = join(presentations, 'diagrams.html');
  assert.ok(existsSync(galleryPath));
  const gallery = readFileSync(galleryPath, 'utf8');
  const listed = [...gallery.matchAll(/<img\b[^>]*\bsrc="diagrams\/([^"]+\.svg)"/g)]
    .map((match) => match[1])
    .sort();
  const available = readdirSync(join(presentations, 'diagrams'))
    .filter((name) => name.endsWith('.svg'))
    .sort();

  assert.deepEqual(listed, expectedDiagrams, 'every SVG asset must appear once in the gallery');

  assert.deepEqual(available, expectedDiagrams, 'the current asset directory must be curated');
  const ids = new Set<string>();

  for (const filename of expectedDiagrams) {
    const svg = readFileSync(join(presentations, 'diagrams', filename), 'utf8');
    const openingTag = svg.match(/<svg\b([^>]*)>/)?.[1] ?? '';
    const accessibleStart = svg.match(
      /<svg\b[^>]*>\s*<title id="([^"]+)">[^<]+<\/title>\s*<desc id="([^"]+)">[^<]+<\/desc>/,
    );
    assert.ok(accessibleStart, `${filename} must put its title and description first`);
    const [, titleId, descId] = accessibleStart;
    assert.ok(!ids.has(titleId), `${filename}: ${titleId} must be unique`);
    assert.ok(!ids.has(descId), `${filename}: ${descId} must be unique`);
    ids.add(titleId);
    ids.add(descId);
    assert.match(openingTag, /role="img"/);
    assert.match(openingTag, new RegExp(`aria-labelledby="${titleId} ${descId}"`));
    assert.doesNotMatch(
      svg,
      /v3\.5\.0|117 steps|21 specialized agents|100% autonomous|96\/96|15 DAOs|16 DAOs/i,
      `${filename} must not retain retired stack claims`,
    );
  }
});
