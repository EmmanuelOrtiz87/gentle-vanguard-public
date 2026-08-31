#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MlrRouterArgs {
  query: string;
  topN: number;
  embeddingsPath: string;
  delegationConfigPath: string;
  registryPath: string;
  raw: boolean;
}

interface EmbeddingEntry {
  name: string;
  agent: string;
  triggers: string[];
  vector: Record<string, number>;
  charNgrams: Record<string, boolean>;
}

interface Embeddings {
  metadata: { totalSkills: number; vocabularySize: number };
  vocabulary: Record<string, number>;
  idf: Record<string, number>;
  skills: EmbeddingEntry[];
  sourcePath: string;
}

interface DelegationConfig {
  keywordMappings?: Record<string, string[]>;
  skillToAgentProfile?: Record<string, string>;
  routingBindings?: {
    tiers: {
      tier1_direct: { confidenceMin: number };
      tier2_confirm: { confidenceMin: number };
      tier3_clarify: { confidenceMin: number };
    };
  };
}

interface QueryVectorInfo {
  vector: Record<string, number>;
  tokens: string[];
  tokenTf: Record<string, number>;
  unmatchedTokens: string[];
}

interface CosineResult {
  similarity: number;
  sharedTerms: number;
}

interface MatchResult {
  skill: string;
  agent: string;
  score: number;
  cosineScore: number;
  jaccardScore: number;
  sharedTerms: number;
  matchType: string;
  confidence: string;
  triggers: string[];
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
  return cleaned
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !stopWordsSet.has(t));
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

function parseArgs(): MlrRouterArgs {
  const raw = process.argv.slice(2);
  const query = extractArg(raw, '--query') || '';
  const topN = parseInt(extractArg(raw, '--top-n') || '5', 10);
  const projectRoot = findRepoRoot(__dirname);
  return {
    query,
    topN: isNaN(topN) ? 5 : topN,
    embeddingsPath:
      extractArg(raw, '--embeddings-path') || join(projectRoot, '.atl', 'skill-embeddings.json'),
    delegationConfigPath:
      extractArg(raw, '--delegation-config-path') ||
      join(projectRoot, 'config', 'auto-delegation.json'),
    registryPath:
      extractArg(raw, '--registry-path') || join(projectRoot, '.atl', 'skill-registry.md'),
    raw: raw.includes('--raw'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function ensureEmbeddingsExist(path: string, _scriptDir: string): boolean {
  if (existsSync(path)) return true;
  console.warn(`Embeddings not found at ${path} — run skill-embedder first`);
  return false;
}

function loadEmbeddings(path: string): Embeddings {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const idf: Record<string, number> = {};
  if (json.idf) {
    for (const key of Object.keys(json.idf)) idf[key] = json.idf[key];
  }
  const vocabulary: Record<string, number> = {};
  if (Array.isArray(json.vocabulary)) {
    for (let i = 0; i < json.vocabulary.length; i++) vocabulary[json.vocabulary[i]] = i;
  }
  const skills: EmbeddingEntry[] = (json.skills || []).map((s: Record<string, unknown>) => ({
    name: s.name as string,
    agent: s.agent as string,
    triggers: (s.triggers as string[]) || [],
    vector: (s.vector as Record<string, number>) || {},
    charNgrams: ((s.charNgrams as string[]) || []).reduce(
      (acc: Record<string, boolean>, g: string) => {
        acc[g] = true;
        return acc;
      },
      {},
    ),
  }));

  return {
    metadata: { totalSkills: skills.length, vocabularySize: Object.keys(vocabulary).length },
    vocabulary,
    idf,
    skills,
    sourcePath: path,
  };
}

function loadDelegationConfig(path: string): DelegationConfig | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function computeQueryVector(
  query: string,
  vocabulary: Record<string, number>,
  idf: Record<string, number>,
): QueryVectorInfo {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { vector: {}, tokens: [], tokenTf: {}, unmatchedTokens: [] };

  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  const total = tokens.length;
  const vector: Record<string, number> = {};
  for (const t of Object.keys(tf)) {
    if (vocabulary[t] !== undefined) {
      const tfVal = Math.log10(1 + (tf[t] / total) * 100);
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

  const unmatchedTokens = tokens.filter((t) => vocabulary[t] === undefined);
  return { vector, tokens, tokenTf: tf, unmatchedTokens };
}

function computeQueryCharNgrams(query: string): Record<string, boolean> {
  const raw = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ngrams: Record<string, boolean> = {};
  for (let i = 0; i <= raw.length - 3; i++) ngrams[raw.substring(i, i + 3)] = true;
  return ngrams;
}

function computeCosineSimilarity(
  queryVector: Record<string, number>,
  skillVector: Record<string, number>,
): CosineResult {
  let dot = 0;
  let shared = 0;
  for (const [term, qVal] of Object.entries(queryVector)) {
    if (skillVector[term] !== undefined) {
      dot += qVal * skillVector[term];
      shared++;
    }
  }
  return { similarity: dot, sharedTerms: shared };
}

function computeJaccardSimilarity(
  queryNgrams: Record<string, boolean>,
  skillNgrams: Record<string, boolean>,
): number {
  if (Object.keys(queryNgrams).length === 0) return 0;
  let intersection = 0;
  for (const g of Object.keys(queryNgrams)) {
    if (skillNgrams[g]) intersection++;
  }
  return intersection / Object.keys(queryNgrams).length;
}

function getMatchType(score: number, config: DelegationConfig | null): string {
  const confPct = Math.round(score * 100);
  if (config?.routingBindings?.tiers) {
    const tiers = config.routingBindings.tiers;
    if (confPct >= tiers.tier1_direct.confidenceMin) return 'tier1_direct';
    if (confPct >= tiers.tier2_confirm.confidenceMin) return 'tier2_confirm';
    return 'tier3_clarify';
  }
  if (confPct >= 80) return 'tier1_direct';
  if (confPct >= 60) return 'tier2_confirm';
  return 'tier3_clarify';
}

function getConfidenceLevel(score: number): string {
  const pct = Math.round(score * 100);
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'medium';
  return 'low';
}

function resolveAgentCode(skillName: string, config: DelegationConfig | null): string | null {
  if (!config?.skillToAgentProfile) return null;
  return config.skillToAgentProfile[skillName] || null;
}

function invokeSkillMatching(
  queryText: string,
  embeddings: Embeddings,
  delegationConfig: DelegationConfig | null,
): MatchResult[] {
  const queryVectorInfo = computeQueryVector(queryText, embeddings.vocabulary, embeddings.idf);
  const queryNgrams = computeQueryCharNgrams(queryText);

  const results: MatchResult[] = [];

  for (const skill of embeddings.skills) {
    const cosResult = computeCosineSimilarity(queryVectorInfo.vector, skill.vector);
    const jaccard = computeJaccardSimilarity(queryNgrams, skill.charNgrams);

    let cosScore = cosResult.similarity;
    if (cosScore < 0) cosScore = 0;
    if (cosScore > 1) cosScore = 1;

    const combinedScore = 0.7 * cosScore + 0.3 * jaccard;

    if (combinedScore > 0.01) {
      const agentFromConfig = resolveAgentCode(skill.name, delegationConfig);
      const finalAgent = agentFromConfig || skill.agent;

      results.push({
        skill: skill.name,
        agent: finalAgent,
        score: Math.round(combinedScore * 10000) / 10000,
        cosineScore: Math.round(cosScore * 10000) / 10000,
        jaccardScore: Math.round(jaccard * 10000) / 10000,
        sharedTerms: cosResult.sharedTerms,
        matchType: getMatchType(combinedScore, delegationConfig),
        confidence: getConfidenceLevel(combinedScore),
        triggers: skill.triggers,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function main(): void {
  const args = parseArgs();

  if (!ensureEmbeddingsExist(args.embeddingsPath, __dirname)) process.exit(1);

  console.log(`Loading embeddings from ${args.embeddingsPath} ...`);
  const embeddings = loadEmbeddings(args.embeddingsPath);
  console.log(
    `Loaded ${embeddings.metadata.totalSkills} skills with ${embeddings.metadata.vocabularySize} vocabulary terms`,
  );

  const delegConfig = loadDelegationConfig(args.delegationConfigPath);

  console.log(`Matching query: '${args.query}'`);
  const rankedResults = invokeSkillMatching(args.query, embeddings, delegConfig);

  const topMatches = rankedResults.slice(0, args.topN);

  if (args.raw) {
    console.log(JSON.stringify(topMatches, null, 2));
    return;
  }

  if (topMatches.length === 0) {
    console.log(`No matches found for query: '${args.query}'`);
    const fallback = [
      {
        skill: 'sdd-lifecycle',
        agent: 'BA',
        score: 0.0,
        matchType: 'tier3_clarify',
        confidence: 'low',
        reason: 'No semantic matches found — BA exploration required',
      },
    ];
    console.log(JSON.stringify(fallback, null, 2));
    return;
  }

  const uniqueAgents = new Set<string>();
  for (const m of rankedResults.slice(0, 100)) uniqueAgents.add(m.agent);

  console.log(`\nTop ${topMatches.length} skill matches for: '${args.query}'`);
  console.log('='.repeat(70));
  console.log(
    `${'Rank'.padEnd(5)} ${'Skill'.padEnd(30)} ${'Agent'.padEnd(8)} ${'Score'.padEnd(8)} ${'MatchType'.padEnd(18)}`,
  );
  console.log('-'.repeat(70));

  let rank = 1;
  for (const m of topMatches) {
    const scorePct = Math.round(m.score * 100);
    console.log(
      `${String(rank).padEnd(5)} ${m.skill.padEnd(30)} ${m.agent.padEnd(8)} ${String(scorePct).padEnd(3)}%  ${m.matchType.padEnd(18)}`,
    );
    rank++;
  }

  console.log('');
  console.log(`Agents referenced: ${uniqueAgents.size}`);
  console.log(`Total candidates scored: ${rankedResults.length}`);
}

main();
