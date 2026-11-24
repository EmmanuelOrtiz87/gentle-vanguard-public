import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const snapshot = z
  .object({
    generatedAt: z.string().datetime(),
    packageVersion: z.string().min(1),
  })
  .passthrough();

export type StackFactsSnapshot = z.infer<typeof snapshot>;

/** Same output path as src/ops/stack-facts.ts. Never invent replacement facts. */
export function readStackFacts(root: string): StackFactsSnapshot {
  const path = join(root, 'docs', 'generated', 'stack-facts.json');
  try {
    return snapshot.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    throw new Error(
      `Stack facts missing or invalid: ${path}. Run npm run stack:facts from the repository root.`,
    );
  }
}
