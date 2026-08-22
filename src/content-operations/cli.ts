#!/usr/bin/env node
/**
 * Content Operations CLI — offline-first content job management.
 *
 * Commands:
 *   list       List jobs (filter: --date, --platform, --id, --status)
 *   validate   Validate jobs against the manifest + platform registry
 *   prepare    Package validated jobs into .runtime/content-operations
 *   status     Show job status summary
 *   report     Generate a markdown report of the content pipeline
 *   transition Move a job to a new state (validates the transition graph)
 *   export     Export the offline kit ZIP (Windows)
 *
 * Usage:
 *   npx tsx src/content-operations/cli.ts list --date=2026-08-18
 *   npx tsx src/content-operations/cli.ts validate --id=GV-2026-08-18-LINKEDIN
 *   npx tsx src/content-operations/cli.ts prepare --date=2026-08-18 --platform=linkedin
 *   npx tsx src/content-operations/cli.ts transition --id=... --to=VALIDATED
 */
import {
  loadManifest,
  loadPlatformRegistry,
  packageJob,
  saveManifest,
  transition,
  validate,
  type Job,
  type Status,
} from './engine.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const VALID_STATUSES: Status[] = [
  'DRAFT',
  'VALIDATED',
  'PACKAGED',
  'REVIEW',
  'APPROVED',
  'PUBLISHED',
  'MEASURED',
  'FAILED',
];

function selectJobs(jobs: Job[]): Job[] {
  return jobs.filter(
    (j) =>
      (!get('date') || j.date === get('date')) &&
      (!get('platform') || j.platform === get('platform')) &&
      (!get('id') || j.id === get('id')) &&
      (!get('status') || j.status === get('status')),
  );
}

function printJobs(jobs: Job[]): void {
  if (jobs.length === 0) {
    console.log('No jobs match the filter.');
    return;
  }
  const rows = jobs.map(({ id, date, platform, status, campaign, theme }) => ({
    id,
    date,
    platform,
    status,
    campaign,
    theme,
  }));
  console.table(rows);
}

switch (command) {
  case 'list': {
    printJobs(selectJobs(loadManifest(root)));
    break;
  }
  case 'validate': {
    const registry = loadPlatformRegistry(root);
    const jobs = selectJobs(loadManifest(root));
    let failed = 0;
    for (const job of jobs) {
      const errors = validate(job, registry);
      if (errors.length) {
        failed++;
        console.error(`✗ ${job.id}: ${errors.join('; ')}`);
      } else {
        console.log(`✓ ${job.id}: valid`);
      }
    }
    console.log(`\n${jobs.length - failed}/${jobs.length} jobs valid.`);
    process.exitCode = failed > 0 ? 1 : 0;
    break;
  }
  case 'prepare': {
    const registry = loadPlatformRegistry(root);
    const jobs = selectJobs(loadManifest(root));
    let prepared = 0;
    for (const job of jobs) {
      const errors = validate(job, registry);
      if (errors.length) {
        console.error(`✗ ${job.id}: ${errors.join('; ')}`);
        continue;
      }
      const out = packageJob(root, job);
      console.log(`✓ ${job.id}: ${out}`);
      prepared++;
    }
    console.log(`\n${prepared}/${jobs.length} jobs prepared.`);
    process.exitCode = prepared === jobs.length ? 0 : 1;
    break;
  }
  case 'status': {
    const jobs = loadManifest(root);
    const byStatus = new Map<Status, number>();
    for (const s of VALID_STATUSES) byStatus.set(s, 0);
    for (const j of jobs) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);
    console.log(`Content pipeline status (${jobs.length} jobs):`);
    for (const [status, count] of byStatus) {
      if (count > 0) console.log(`  ${status.padEnd(10)} ${count}`);
    }
    break;
  }
  case 'report': {
    const jobs = loadManifest(root);
    const lines = [
      '# Content Operations Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total jobs: ${jobs.length}`,
      '',
      '| ID | Date | Platform | Status | Campaign |',
      '| --- | --- | --- | --- | --- |',
      ...jobs.map((j) => `| ${j.id} | ${j.date} | ${j.platform} | ${j.status} | ${j.campaign} |`),
      '',
    ];
    const report = lines.join('\n');
    console.log(report);
    break;
  }
  case 'transition': {
    const id = get('id');
    const to = get('to') as Status | undefined;
    if (!id || !to) {
      console.error('Usage: transition --id=JOB-ID --to=VALIDATED');
      process.exitCode = 1;
      break;
    }
    if (!VALID_STATUSES.includes(to)) {
      console.error(`Invalid target status: ${to}`);
      process.exitCode = 1;
      break;
    }
    const jobs = loadManifest(root);
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) {
      console.error(`Job not found: ${id}`);
      process.exitCode = 1;
      break;
    }
    try {
      const from = jobs[idx].status;
      const updated = transition(jobs[idx], to);
      jobs[idx] = updated;
      saveManifest(root, jobs);
      console.log(`✓ ${id}: ${from} -> ${to}`);
    } catch (err) {
      console.error(`✗ ${id}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
    break;
  }
  case 'export': {
    const { spawnSync } = await import('node:child_process');
    const script = resolve(root, 'scripts/content-operations/export-kit.ps1');
    if (!existsSync(script)) {
      console.error('Export script not found:', script);
      process.exitCode = 1;
      break;
    }
    const res = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    process.exitCode = res.status ?? 1;
    break;
  }
  default:
    console.log(`Gentle-Vanguard Content Operations

Commands:
  list       List jobs (--date, --platform, --id, --status)
  validate   Validate jobs against manifest + platform registry
  prepare    Package validated jobs offline
  status     Show status summary
  report     Generate markdown report
  transition Transition a job state (--id, --to)
  export     Export offline kit ZIP

Examples:
  npx tsx src/content-operations/cli.ts list --date=2026-08-18
  npx tsx src/content-operations/cli.ts validate
  npx tsx src/content-operations/cli.ts prepare --date=2026-08-18 --platform=linkedin
  npx tsx src/content-operations/cli.ts transition --id=GV-2026-08-18-LINKEDIN --to=VALIDATED
`);
}
