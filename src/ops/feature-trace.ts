/** ODD recovery: exact full-document mirror plus explicit task/proof/commit links. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runSync } from '../core/run-command.js';

const START = 'GV-FEATURE-MIRROR-V1\n';
const END = '\nGV-FEATURE-MIRROR-END';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function mirrorPayload(locator: string, content: string): string {
  return START + JSON.stringify({ locator, sha256: hash(content), content }) + END;
}
export function verifyMirror(readback: string, locator: string, content: string): string {
  const start = readback.indexOf(START);
  const end = readback.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error('Full mirror markers missing; fetch the complete observation');
  const stored = JSON.parse(readback.slice(start + START.length, end));
  if (stored.locator !== locator || stored.content !== content || stored.sha256 !== hash(content)) {
    throw new Error('Mirror locator/content/hash differs from local document');
  }
  return stored.content;
}

export function traceErrors(doc: string, proofExists: (path: string, commit: string) => boolean): string[] {
  doc = doc.replace(/\r\n/g, '\n'); // Structure is portable; mirror still hashes original bytes.
  const errors: string[] = [];
  for (const section of ['Specs', 'Tasks', 'Evidence', 'Log']) {
    if (!doc.includes(`## ${section}\n`)) errors.push(`Missing ${section}`);
  }
  const specs = new Set([...doc.matchAll(/^S(\d+)\s*[—:-]/gm)].map(match => `S${match[1]}`));
  const tasks = [...doc.matchAll(/^- (T\d+) \[([^\]]+)\]/gm)];
  if (!specs.size || !tasks.length) errors.push('No specs/tasks found');
  const proofs = [...doc.matchAll(/^- (T\d+) \| ([^|\n]+) \| ([a-f0-9]{7,40})\s*$/gm)];
  const taskIds = new Set(tasks.map(task => task[1]));
  const referenced = new Set<string>();
  for (const task of tasks) {
    const refs = task[2].replace(/S(\d+)-S(\d+)/g, (_, a, b) => {
      const from = Number(a), to = Number(b);
      if (to < from || to - from > 1000) return 'invalid-range';
      return Array.from({ length: to - from + 1 }, (_, index) => `S${from + index}`).join(',');
    }).split(',').map(ref => ref.trim());
    for (const ref of refs) { referenced.add(ref); if (!specs.has(ref)) errors.push(`${task[1]} references unknown spec ${ref}`); }
    if (!proofs.some(proof => proof[1] === task[1])) errors.push(`${task[1]} has no proof/commit link`);
  }
  for (const spec of specs) if (!referenced.has(spec)) errors.push(`${spec} has no task`);
  for (const proof of proofs) {
    if (!taskIds.has(proof[1])) errors.push(`Unknown task ${proof[1]} in Evidence`);
    if (!proofExists(proof[2].trim(), proof[3])) errors.push(`${proof[1]} proof/commit missing: ${proof[2]} @ ${proof[3]}`);
  }
  return errors;
}

function main(): void {
  const [action, docPath, readbackPath] = process.argv.slice(2);
  if (!docPath || !['check', 'mirror', 'verify'].includes(action)) throw new Error('Usage: feature-trace.ts check|mirror|verify <feature-doc> [complete-readback.txt]');
  const locator = relative(process.cwd(), resolve(docPath)).replace(/\\/g, '/');
  if (!locator.startsWith('docs/features/') || locator.includes('../')) throw new Error('Expected a workspace docs/features document');
  const content = readFileSync(docPath, 'utf8');
  if (action === 'check') {
    const errors = traceErrors(content, (path, commit) => {
      if (path.startsWith('/') || path.includes('..') || path.includes(':')) return false;
      if (runSync('git', ['cat-file', '-t', commit], { timeout: 5000 }).stdout.trim() !== 'commit') return false;
      return runSync('git', ['cat-file', '-e', `${commit}:${path}`], { timeout: 5000 }).status === 0;
    });
    console.log(JSON.stringify({ valid: !errors.length, errors, scope: 'structural links only; not test execution attestation' }, null, 2));
    if (errors.length) process.exitCode = 1;
  } else if (action === 'mirror') {
    const slug = locator.split('/').pop()!.replace(/^GB-\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    const result = runSync('engram', ['save', `ODD full mirror: ${locator}`, mirrorPayload(locator, content), '--type', 'architecture', '--project', 'gentle-vanguard', '--scope', 'project', '--topic', `odd/${slug}/tasks`], { timeout: 15000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Manual CLI save failed: ${result.stderr}`);
    if (readFileSync(docPath, 'utf8') !== content) throw new Error('Document changed during save; renew mirror before read-back');
    console.log(result.stdout);
    console.log('Saved through independent manual CLI, not agent attribution. Fetch complete observation via read-only mem_get_observation, save its result text, then run verify. Save alone is NOT verified.');
  } else {
    if (!readbackPath) throw new Error('verify requires complete observation text read from Engram');
    verifyMirror(readFileSync(readbackPath, 'utf8'), locator, content);
    // Receipt is separate from the feature document to avoid a self-referential hash.
    writeFileSync(`${readbackPath}.verified.json`, JSON.stringify({ locator, sha256: hash(content), verifiedAt: new Date().toISOString(), readbackPath }, null, 2));
    console.log('Full mirror read-back matches local locator, bytes and SHA256.');
  }
}
if (['feature-trace.ts', 'feature-trace.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '')) {
  try { main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
