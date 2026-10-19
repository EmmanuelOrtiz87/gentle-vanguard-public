import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

interface SignOutcome {
  status: 'signed' | 'skipped' | 'failed';
  detail: string;
}

/** Sign first: Authenticode changes the bytes described by the release checksum. */
export function finalizeInstaller(file: string, sign: () => SignOutcome): {
  signing: SignOutcome; checksum: string;
} {
  const signing = sign();
  if (signing.status === 'failed') throw new Error(`Signing failed: ${signing.detail}`);
  const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${checksum}  ${basename(file)}\n`, 'utf8');
  return { signing, checksum };
}
