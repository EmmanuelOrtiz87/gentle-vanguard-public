import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Owner-approved source closure for src/orchestration/editorial-audio.ts. */
export function syncPublicEditorialSources(privateRepo: string, targetDir: string): void {
  const files = [
    'packages/gv-shorts-core/src/providers/whisper-api.ts',
    'packages/gv-shorts-core/src/providers/subtitles.ts',
    'packages/gv-shorts-core/src/types.ts',
    'packages/gv-shorts-core/src/types/whisper-node.d.ts',
  ];
  for (const file of files) {
    if (!existsSync(join(privateRepo, file))) {
      throw new Error(`Public editorial source missing: ${file}`);
    }
  }
  for (const file of files) {
    const target = join(targetDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(privateRepo, file), target);
  }
}

/** Private modules omitted by the public source snapshot and its TypeScript project. */
const PUBLIC_EXCLUDED_SOURCE_PATHS = [
  'src/atlassian-kit',
  'src/content-operations/import-campaign.ts',
  'src/rdd/rdd-core.ts',
  'src/tools/verify-native-design.ts',
] as const;

export function removePrivatePublicSources(targetDir: string): void {
  for (const relativePath of PUBLIC_EXCLUDED_SOURCE_PATHS) {
    const absolutePath = join(targetDir, relativePath);
    if (existsSync(absolutePath)) rmSync(absolutePath, { recursive: true, force: true });
  }
}
