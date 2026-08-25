#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SkillEmbedderArgs {
  registryPath: string;
  delegationConfigPath: string;
  outputPath: string;
}

interface SkillEntry {
  agent: string;
  triggers: string[];
}

interface SkillTextInfo {
  agent: string;
  text: string;
  baseText: string;
  triggers: string[];
}

interface VectorEntry {
  agent: string;
  vector: Record<string, number>;
  triggers: string[];
}

interface CharNgramEntry {
  agent: string;
  ngrams: Record<string, boolean>;
}

interface VocabResult {
  vocabulary: Record<string, number>;
  idf: Record<string, number>;
  allTokens: Array<Record<string, string[]>>;
  vocabSize: number;
}

interface VectorResult {
  vectors: Record<string, VectorEntry>;
  charNgrams: Record<string, CharNgramEntry>;
}

const stopWords = [
  'a',
  'an',
  'the',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'and',
  'or',
  'is',
  'it',
  'as',
  'be',
  'by',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'not',
  'no',
  'but',
  'if',
  'so',
  'up',
  'out',
  'about',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'also',
  'very',
  'just',
  'each',
  'any',
  'all',
  'both',
  'more',
  'most',
  'some',
  'such',
  'only',
  'own',
  'same',
  'than',
  'too',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'en',
  'un',
  'una',
  'que',
  'es',
  'se',
  'por',
  'para',
  'con',
  'una',
  'lo',
  'como',
  'mas',
  'pero',
  'sus',
  'le',
  'ya',
  'este',
  'entre',
  'porque',
  'todo',
  'esta',
  'sin',
  'son',
];

const stopWordsSet = new Set(stopWords);

function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  const parts = cleaned.split(/[\s-]+/).filter((t) => t.length >= 2 && t.length <= 40);
  return parts.filter((t) => !stopWordsSet.has(t));
}

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (!parent || parent === current) break;
    current = parent;
  }
  return dir;
}

function parseArgs(): SkillEmbedderArgs {
  const raw = process.argv.slice(2);
  const projectRoot = findRepoRoot(__dirname);
  return {
    registryPath:
      extractArg(raw, '--registry-path') || join(projectRoot, '.atl', 'skill-registry.md'),
    delegationConfigPath:
      extractArg(raw, '--delegation-config-path') ||
      join(projectRoot, 'config', 'auto-delegation.json'),
    outputPath:
      extractArg(raw, '--output-path') || join(projectRoot, '.atl', 'skill-embeddings.json'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function parseSkillRegistry(path: string): Record<string, SkillEntry> {
  if (!existsSync(path)) {
    console.error(`Skill registry not found: ${path}`);
    return {};
  }

  const content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);
  const skills: Record<string, SkillEntry> = {};
  let inMappingTable = false;

  for (const line of lines) {
    if (/^## Compact Rules/.test(line)) break;
    if (/^## Skill-Agent Mapping/.test(line)) {
      inMappingTable = true;
      continue;
    }
    if (!inMappingTable) continue;

    const trimmed = line.trimStart();
    if (!trimmed.startsWith('|')) continue;

    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.length < 4) continue;

    const agentPart = parts[1];
    const skillPart = parts[2];
    const triggerPart = parts[3];

    if (/Agent|^-+/.test(agentPart)) continue;
    if (/Skill|^-+/.test(skillPart) || !skillPart || /^\d+$/.test(skillPart)) continue;
    if (/^-+/.test(triggerPart)) continue;

    const agentCode = agentPart.split(/[\s-]/)[0];
    if (!agentCode) continue;

    let triggers: string[] = [];
    if (triggerPart) {
      triggers = triggerPart
        .split(',')
        .map((t) =>
          t
            .trim()
            .replace(/^["']|["']$/g, '')
            .trim(),
        )
        .filter((t) => t && t !== '...' && t !== '…' && !/^…\.?$/.test(t));
    }

    skills[skillPart] = { agent: agentCode, triggers };
  }

  return skills;
}

function getAgentKeywords(path: string): Record<string, string[]> {
  if (!existsSync(path)) {
    console.warn(`Delegation config not found: ${path}`);
    return {};
  }

  const config = JSON.parse(readFileSync(path, 'utf8'));
  const keywords: Record<string, string[]> = {};
  const km = config.keywordMappings;
  if (!km) return keywords;

  for (const agentCode of Object.keys(km)) {
    const items: string[] = [];
    for (const val of km[agentCode]) {
      const clean = String(val).replace(/^["']|["']$/g, '');
      if (
        clean &&
        !/^(when|for|or|and|after|in|user mentions|if the|when creating|when writing|when working|when using|when building|when a|when you|when orchestrator|when managing|when planning|when adding)/.test(
          clean,
        )
      ) {
        items.push(clean);
      }
    }
    if (items.length > 0) keywords[agentCode] = items;
  }

  return keywords;
}

function addSkillsFromConfig(
  skills: Record<string, SkillEntry>,
  delegationConfigPath: string,
): Record<string, SkillEntry> {
  if (!existsSync(delegationConfigPath)) {
    console.warn(`Config not found: ${delegationConfigPath}`);
    return { ...skills };
  }

  const config = JSON.parse(readFileSync(delegationConfigPath, 'utf8'));
  const result: Record<string, SkillEntry> = { ...skills };

  if (config.skillToAgentProfile) {
    let added = 0;
    for (const skillName of Object.keys(config.skillToAgentProfile)) {
      const agentName = String(config.skillToAgentProfile[skillName]);
      if (!result[skillName]) {
        result[skillName] = { agent: agentName, triggers: [] };
        added++;
      }
    }
    console.log(`  Added ${added} skills from skillToAgentProfile`);
  }

  return result;
}

function buildSkillText(
  skills: Record<string, SkillEntry>,
  agentKeywords: Record<string, string[]>,
): Record<string, SkillTextInfo> {
  const result: Record<string, SkillTextInfo> = {};

  for (const [skillName, skill] of Object.entries(skills)) {
    const nameTokens = skillName.replace(/[-_]/g, ' ');
    const baseParts: string[] = [nameTokens];
    const fullParts: string[] = [nameTokens];

    for (const t of skill.triggers) {
      if (t) {
        baseParts.push(t);
        fullParts.push(t);
      }
    }

    if (agentKeywords[skill.agent]) {
      for (const kw of agentKeywords[skill.agent]) fullParts.push(kw);
    }

    result[skillName] = {
      agent: skill.agent,
      text: fullParts.join(' '),
      baseText: baseParts.join(' '),
      triggers: skill.triggers,
    };
  }

  return result;
}

function buildVocabulary(skillTexts: Record<string, SkillTextInfo>): VocabResult {
  const vocabulary: Record<string, number> = {};
  const docFreq: Record<string, number> = {};
  const allTokens: Array<Record<string, string[]>> = [];

  for (const [skillName, info] of Object.entries(skillTexts)) {
    const tokens = tokenize(info.text);
    allTokens.push({ [skillName]: tokens });
    const seen = new Set<string>();

    for (const t of tokens) {
      if (vocabulary[t] === undefined) vocabulary[t] = Object.keys(vocabulary).length;
      seen.add(t);
    }
    for (const t of seen) docFreq[t] = (docFreq[t] || 0) + 1;
  }

  const N = Object.keys(skillTexts).length;
  const idf: Record<string, number> = {};

  for (const word of Object.keys(vocabulary)) {
    const df = docFreq[word] || 1;
    idf[word] = Math.log((N + 1) / df) + 1.0;
  }

  return { vocabulary, idf, allTokens, vocabSize: Object.keys(vocabulary).length };
}

function buildSkillVectors(
  skillTexts: Record<string, SkillTextInfo>,
  vocabulary: Record<string, number>,
  idf: Record<string, number>,
): VectorResult {
  const vectors: Record<string, VectorEntry> = {};
  const charNgrams: Record<string, CharNgramEntry> = {};

  for (const [skillName, info] of Object.entries(skillTexts)) {
    const tokens = tokenize(info.text);
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

    const totalTerms = tokens.length || 1;
    const vector: Record<string, number> = {};

    for (const t of Object.keys(tf)) {
      if (vocabulary[t] !== undefined) {
        const tfVal = Math.log10(1 + (tf[t] / totalTerms) * 100);
        const idfVal = idf[t] !== undefined ? idf[t] : 1.0;
        vector[t] = tfVal * idfVal;
      }
    }

    let norm = 0;
    for (const v of Object.values(vector)) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (const t of Object.keys(vector)) vector[t] /= norm;
    }

    vectors[skillName] = { agent: info.agent, vector, triggers: info.triggers };

    const ngramSrc = info.baseText || info.text;
    const rawText = ngramSrc.replace(/[^a-zA-Z0-9]/g, '');
    const ngrams: Record<string, boolean> = {};
    for (let i = 0; i <= rawText.length - 3; i++) ngrams[rawText.substring(i, i + 3)] = true;
    charNgrams[skillName] = { agent: info.agent, ngrams };
  }

  return { vectors, charNgrams };
}

function saveEmbeddings(
  vectors: Record<string, VectorEntry>,
  charNgrams: Record<string, CharNgramEntry>,
  vocabulary: Record<string, number>,
  idf: Record<string, number>,
  outputPath: string,
): void {
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  const vocabList = Object.keys(vocabulary);
  const idfList: Record<string, number> = {};
  for (const w of Object.keys(idf)) idfList[w] = Math.round(idf[w] * 10000) / 10000;

  const skillsOut = [];
  for (const [skillName, v] of Object.entries(vectors)) {
    const vecObj: Record<string, number> = {};
    for (const [k, val] of Object.entries(v.vector))
      vecObj[k] = Math.round(val * 1000000) / 1000000;
    const charN = charNgrams[skillName];
    const ngramArr = Object.keys(charN.ngrams);

    skillsOut.push({
      name: skillName,
      agent: v.agent,
      triggers: [...v.triggers],
      vector: vecObj,
      charNgrams: ngramArr,
    });
  }

  const embeddings = {
    version: '1.0',
    generated: new Date().toISOString(),
    metadata: { totalSkills: skillsOut.length, vocabularySize: vocabList.length, ngramSize: 3 },
    vocabulary: vocabList,
    idf: idfList,
    skills: skillsOut,
  };

  writeFileSync(outputPath, JSON.stringify(embeddings, null, 2), 'utf8');

  // Per-skill embedding cache in .atl/ml-embeddings/ — one file per skill so
  // lookups can load a single vector without parsing the full index. The
  // watchtower ml-embeddings component checks this directory is present.
  const perSkillDir = join(dirname(outputPath), 'ml-embeddings');
  mkdirSync(perSkillDir, { recursive: true });
  for (const skill of skillsOut) {
    const slug = skill.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
    writeFileSync(
      join(perSkillDir, `${slug}.json`),
      JSON.stringify(
        {
          version: '1.0',
          generated: embeddings.generated,
          name: skill.name,
          agent: skill.agent,
          triggers: skill.triggers,
          vector: skill.vector,
          charNgrams: skill.charNgrams,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  console.log(
    `Embeddings saved to ${outputPath} (${skillsOut.length} skills, ${vocabList.length} vocabulary terms)`,
  );
  console.log(`Per-skill cache written to ${perSkillDir} (${skillsOut.length} files)`);
}

function main(): void {
  const args = parseArgs();

  console.log('=== Skill Embedding Generator ===');

  if (!existsSync(args.registryPath)) {
    console.error(`Registry not found: ${args.registryPath}`);
    process.exit(1);
  }

  console.log(`Parsing skill registry: ${args.registryPath}`);
  const skills = parseSkillRegistry(args.registryPath);
  console.log(`Found ${Object.keys(skills).length} skills from registry`);

  console.log('Supplementing missing skills from auto-delegation config...');
  const supplemented = addSkillsFromConfig(skills, args.delegationConfigPath);
  console.log(`Total skills after supplement: ${Object.keys(supplemented).length}`);

  console.log(`Loading agent keywords from: ${args.delegationConfigPath}`);
  const agentKeywords = getAgentKeywords(args.delegationConfigPath);
  console.log(`Loaded keywords for ${Object.keys(agentKeywords).length} agents`);

  console.log('Building text corpus...');
  const skillTexts = buildSkillText(supplemented, agentKeywords);

  console.log('Building vocabulary...');
  const vocabResult = buildVocabulary(skillTexts);
  console.log(`Vocabulary: ${vocabResult.vocabSize} terms`);

  console.log('Building vectors...');
  const vectorResult = buildSkillVectors(skillTexts, vocabResult.vocabulary, vocabResult.idf);

  console.log('Saving embeddings...');
  saveEmbeddings(
    vectorResult.vectors,
    vectorResult.charNgrams,
    vocabResult.vocabulary,
    vocabResult.idf,
    args.outputPath,
  );

  console.log('Done');
}

main();
