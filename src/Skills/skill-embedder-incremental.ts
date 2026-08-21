#!/usr/bin/env node
/**
 * Incremental skill embeddings updater with change detection.
 * TS migration of scripts/utilities/agents/AUTO-DELEGATION/skill-embedder-incremental.ps1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

function findProjectRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (!parent || parent === current) break;
    current = parent;
  }
  return dir;
}

const projectRoot = findProjectRoot(ROOT);
const registryPath = join(projectRoot, '.atl', 'skill-registry.md');
const delegationConfigPath = join(projectRoot, 'config', 'auto-delegation.json');
const outputPath = join(projectRoot, '.atl', 'skill-embeddings.json');
const metaPath = join(projectRoot, '.atl', 'skill-meta.json');
const logFile = join(projectRoot, '.session', 'skill-embeddings-log.jsonl');

function sha16(s: string): string {
  return createHash('sha256').update(Buffer.from(s, 'utf-8')).digest('hex').slice(0, 16);
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const quiet = args.includes('--quiet');

  const log = (m: string, l?: string) => {
    if (!quiet) console.log(l ? `[${l}] ${m}` : `[INFO] ${m}`);
  };

  // Ensure directories
  const outputDir = join(projectRoot, '.atl');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const sessionDir = join(projectRoot, '.session');
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

  // Load existing metadata
  let prevMeta: Record<string, unknown> | null = null;
  if (existsSync(metaPath)) {
    try {
      prevMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch {
      log('Could not parse existing metadata, doing full rebuild', 'WARN');
    }
  }

  // Load existing embeddings
  let prevEmbeddings: Record<string, unknown> | null = null;
  if (existsSync(outputPath)) {
    try {
      prevEmbeddings = JSON.parse(readFileSync(outputPath, 'utf-8'));
    } catch {
      log('Could not parse existing embeddings, doing full rebuild', 'WARN');
    }
  }

  if (!prevMeta || !prevEmbeddings) log('No previous embeddings found, doing full rebuild');

  if (!existsSync(registryPath)) {
    log('Skill registry not found', 'ERROR');
    process.exit(1);
  }

  const registryContent = readFileSync(registryPath, 'utf-8');
  const currentSkills: Record<string, string> = {};
  for (const line of registryContent.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\S+)\s*\|\s*(\w+)\s*\|/);
    if (m) {
      const n = m[1];
      const a = m[2];
      if (n !== '---' && n !== 'Skill') currentSkills[n] = a;
    }
  }

  // Supplement from auto-delegation config
  if (existsSync(delegationConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(delegationConfigPath, 'utf-8'));
      if (config.agents) {
        for (const [agentName, agentData] of Object.entries(config.agents) as [
          string,
          { skills?: Record<string, unknown> },
        ][]) {
          if (agentData.skills) {
            for (const skillName of Object.keys(agentData.skills)) {
              if (!currentSkills[skillName]) currentSkills[skillName] = agentName;
            }
          }
        }
      }
    } catch {
      /* */
    }
  }

  log(`Current skills: ${Object.keys(currentSkills).length}`);

  // Compare with previous
  const prevSkills: Record<string, string> = {};
  if (prevMeta && (prevMeta as Record<string, unknown>).contentHashes) {
    for (const [k, v] of Object.entries(
      (prevMeta as Record<string, unknown>).contentHashes as Record<string, string>,
    )) {
      prevSkills[k] = v;
    }
  }

  const added: string[] = [],
    removed: string[] = [],
    modified: string[] = [],
    unchanged: string[] = [];

  for (const [skill, agent] of Object.entries(currentSkills)) {
    const hash = sha16(`${skill}|${agent}`);
    if (prevSkills[skill]) {
      // eslint-disable-next-line security/detect-possible-timing-attacks -- internal state comparison, not secret
      if (prevSkills[skill] !== hash) modified.push(skill);
      else unchanged.push(skill);
    } else added.push(skill);
  }
  for (const skill of Object.keys(prevSkills)) {
    if (!currentSkills[skill]) removed.push(skill);
  }

  const totalChanged = added.length + removed.length + modified.length;
  const changePercent =
    Object.keys(currentSkills).length > 0
      ? (totalChanged / Object.keys(currentSkills).length) * 100
      : 100;

  log(
    `DIFF: Added: ${added.length} | Removed: ${removed.length} | Modified: ${modified.length} | Unchanged: ${unchanged.length}`,
  );

  if (totalChanged === 0) {
    log('No changes detected, embeddings are up to date', 'OK');
    return;
  }

  if (changePercent > 50 || force) {
    if (dryRun) {
      log(`[DRY-RUN] Would run full rebuild via skill-embedder.ts`);
      return;
    }
    log(
      `${force ? 'Force flag set' : `${Math.round(changePercent)}% skills changed (>50%)`}, doing full rebuild`,
    );
    try {
      runNpxTsxSync('src/skill-embedder.ts', [], { cwd: projectRoot, timeout: 60000 });
    } catch (e: unknown) {
      log(`Full rebuild failed: ${e instanceof Error ? e.message : String(e)}`, 'ERROR');
    }
    return;
  }

  log('Performing incremental update...');

  if (dryRun) {
    log(`[DRY-RUN] Would add: ${added.join(', ')}`);
    log(`[DRY-RUN] Would remove: ${removed.join(', ')}`);
    log(`[DRY-RUN] Would modify: ${modified.join(', ')}`);
    return;
  }

  if (modified.length > 0 || added.length > 0) {
    try {
      runNpxTsxSync('src/skill-embedder.ts', [], { cwd: projectRoot, timeout: 60000 });
    } catch (e: unknown) {
      log(`Rebuild failed: ${e instanceof Error ? e.message : String(e)}`, 'ERROR');
    }
  } else {
    // Only removals
    if (prevEmbeddings && (prevEmbeddings as Record<string, unknown>).skills) {
      const existingSkills = new Map<string, unknown>();
      for (const skill of (prevEmbeddings as Record<string, unknown>).skills as Array<
        Record<string, unknown>
      >) {
        if (!removed.includes(String(skill.name))) existingSkills.set(String(skill.name), skill);
      }
      const embeddings = {
        version: (prevEmbeddings as Record<string, unknown>).version,
        generated: new Date().toISOString(),
        metadata: {
          totalSkills: existingSkills.size,
          vocabularySize:
            ((prevEmbeddings as Record<string, unknown>).metadata as Record<string, number>)
              ?.vocabularySize || 0,
          ngramSize: 3,
        },
        vocabulary: (prevEmbeddings as Record<string, unknown>).vocabulary,
        idf: (prevEmbeddings as Record<string, unknown>).idf,
        skills: Array.from(existingSkills.values()),
      };
      writeFileSync(outputPath, JSON.stringify(embeddings), 'utf-8');
    }
  }

  // Log
  try {
    appendFileSync(
      logFile,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        action: 'incremental',
        added,
        removed,
        modified,
        totalSkills: Object.keys(currentSkills).length,
      }) + '\n',
      'utf-8',
    );
  } catch {
    /* */
  }

  // Update metadata
  const hashes: Record<string, string> = {};
  for (const [skill, agent] of Object.entries(currentSkills))
    hashes[skill] = sha16(`${skill}|${agent}`);

  const meta: Record<string, unknown> = {
    version: '1.0',
    lastBuilt: new Date().toISOString(),
    lastFullRebuild:
      (prevMeta as Record<string, string>)?.lastFullBuild || new Date().toISOString(),
    totalSkills: Object.keys(currentSkills).length,
    vocabularySize: prevEmbeddings
      ? ((prevEmbeddings as Record<string, unknown>).metadata as Record<string, number>)
          ?.vocabularySize || 0
      : 0,
    contentHashes: hashes,
    incrementalUpdates: [
      ...(((prevMeta as Record<string, unknown>)?.incrementalUpdates as Array<unknown>) || []),
      { timestamp: new Date().toISOString(), added, removed, modified },
    ],
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  log(
    `Incremental update complete. Skills: ${Object.keys(currentSkills).length} | Added: ${added.length} | Removed: ${removed.length} | Modified: ${modified.length}`,
    'OK',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
