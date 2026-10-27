import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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
