import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const CredentialType = z.enum([
  'api-key',
  'access-token',
  'password',
  'private-key',
  'webhook-secret',
  'service-identity',
  'credential-reference',
]);
const Rotation = z.enum(['manual', 'automatic']);
const Severity = z.enum(['critical', 'high', 'medium']);

export const CredentialMetadataSchema = z.object({
  name: z.string(),
  type: CredentialType,
  consumer: z.string(),
  location: z.string(),
  provider: z.string(),
  rotation: Rotation,
  expiration: z.enum(['known', 'unknown']),
  severity: Severity,
  source: z.enum(['environment', 'config-reference']),
});
export const CredentialInventorySchema = z.object({
  readOnly: z.literal(true),
  valuesInspected: z.literal(false),
  credentials: z.array(CredentialMetadataSchema),
});

export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>;
export type CredentialInventory = z.infer<typeof CredentialInventorySchema>;

const DEFAULT_EXCLUSIONS = [
  '.git',
  'node_modules',
  '.runtime',
  '.session',
  '.telemetry',
  '.engram',
  '.backups',
  '.archive',
  '.env',
  '.pem',
  '.key',
  '.enc',
  'owner-auth',
  'dev-credentials',
];
const CONFIG_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ts',
  '.js',
  '.mjs',
  '.md',
]);
const NAME_PATTERN = '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+';
const CREDENTIAL_PATTERN =
  /(?:^|_)(?:API[_-]?KEY|APIKEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|WEBHOOK[_-]?SECRET|BOT[_-]?TOKEN|PAT|SECRET|TOKEN|CREDENTIAL|SIGNING[_-]?KEY)(?:_|$)/i;
const IGNORED_NAMES = new Set([
  'NODE_ENV',
  'PATH',
  'HOME',
  'PWD',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'TERM',
  'CI',
]);

export interface InventoryOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  exclusions?: string[];
}

function abstractLocation(file: string, root: string): string {
  const path = relative(root, file).split(sep).join('/');
  const parts = path.split('/').map((part) => {
    if (/^(?:\.env|.*(?:owner-auth|credentials|secret|token|key|pem|enc).*)$/i.test(part))
      return '[REDACTED]';
    return part;
  });
  return `repo:/${parts.join('/')}`;
}

function providerFor(name: string, file = ''): string {
  const value = `${name} ${file}`.toLowerCase();
  if (value.includes('github') || value.includes('gh_')) return 'GitHub';
  if (value.includes('telegram') || value.includes('bot_')) return 'Telegram';
  if (value.includes('aws')) return 'AWS';
  if (value.includes('azure')) return 'Azure';
  if (value.includes('openai')) return 'OpenAI';
  if (value.includes('anthropic')) return 'Anthropic';
  if (value.includes('discord')) return 'Discord';
  if (value.includes('slack')) return 'Slack';
  if (value.includes('database') || value.includes('db_')) return 'Database';
  return 'Unspecified provider';
}

function metadataFor(
  name: string,
  location: string,
  source: CredentialMetadata['source'],
  file = '',
): CredentialMetadata {
  const normalized = name.toUpperCase();
  const type: CredentialMetadata['type'] =
    normalized.includes('PRIVATE') || normalized.includes('SIGNING')
      ? 'private-key'
      : normalized.includes('PASSWORD') || normalized.includes('PASSWD')
        ? 'password'
        : normalized.includes('WEBHOOK')
          ? 'webhook-secret'
          : normalized.includes('TOKEN') || normalized === 'PAT'
            ? 'access-token'
            : normalized.includes('CREDENTIAL')
              ? 'credential-reference'
              : 'api-key';
  const automatic = /(?:OIDC|WORKLOAD|ROLE|DYNAMIC|TTL|EXPIR|GITHUB_TOKEN|ACTIONS_ID_TOKEN)/i.test(
    normalized,
  );
  const severity: CredentialMetadata['severity'] =
    type === 'private-key' || type === 'password'
      ? 'critical'
      : type === 'access-token'
        ? 'high'
        : 'medium';
  return CredentialMetadataSchema.parse({
    name: normalized,
    type,
    consumer: file ? basename(file).replace(/\.[^.]+$/, '') : 'current process',
    location,
    provider: providerFor(normalized, file),
    rotation: automatic ? 'automatic' : 'manual',
    expiration: /(?:EXPIR|EXPIRES|TTL|TIMEOUT)/i.test(normalized) ? 'known' : 'unknown',
    severity,
    source,
  });
}

function isExcluded(file: string, root: string, exclusions: string[]): boolean {
  const candidate = relative(root, file).split(sep).join('/').toLowerCase();
  return exclusions.some((entry) => candidate.includes(entry.toLowerCase().replaceAll('\\', '/')));
}

function collectFiles(
  directory: string,
  root: string,
  exclusions: string[],
  files: string[],
): void {
  if (isExcluded(directory, root, exclusions)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (isExcluded(file, root, exclusions)) continue;
    if (entry.isDirectory()) collectFiles(file, root, exclusions, files);
    else if (
      entry.isFile() &&
      CONFIG_EXTENSIONS.has(file.slice(file.lastIndexOf('.')).toLowerCase())
    )
      files.push(file);
  }
}

function namesFromConfig(content: string): string[] {
  const names = new Set<string>();
  const patterns = [
    new RegExp(`process\\.env\\.(${NAME_PATTERN})`, 'g'),
    new RegExp(`\\$\\{(${NAME_PATTERN})\\}`, 'g'),
    new RegExp(
      `(?:env|secret|credential)(?:Name|Key|Ref)?\\s*[:=]\\s*["']?(${NAME_PATTERN})`,
      'gi',
    ),
    new RegExp(`["'](${NAME_PATTERN})["']\\s*[:=]`, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1]?.toUpperCase();
      if (name && CREDENTIAL_PATTERN.test(name) && !IGNORED_NAMES.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

export function inventoryCredentials(options: InventoryOptions = {}): CredentialInventory {
  const root = resolve(options.root ?? process.cwd());
  const exclusions = [...DEFAULT_EXCLUSIONS, 'coverage', 'dist', ...(options.exclusions ?? [])];
  const credentials: CredentialMetadata[] = [];
  for (const name of Object.keys(options.env ?? process.env)) {
    if (CREDENTIAL_PATTERN.test(name) && !IGNORED_NAMES.has(name.toUpperCase())) {
      credentials.push(metadataFor(name, 'process environment', 'environment'));
    }
  }
  const files: string[] = [];
  if (existsSync(root) && statSync(root).isDirectory()) collectFiles(root, root, exclusions, files);
  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const names = namesFromConfig(content);
    for (const name of names)
      credentials.push(metadataFor(name, abstractLocation(file, root), 'config-reference', file));
  }
  const unique = [
    ...new Map(
      credentials.map((credential) => [
        `${credential.source}:${credential.name}:${credential.location}`,
        credential,
      ]),
    ).values(),
  ];
  return CredentialInventorySchema.parse({
    readOnly: true,
    valuesInspected: false,
    credentials: unique,
  });
}

function cli(): void {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const exclusions = args.flatMap((arg, index) =>
    arg === '--exclude' && args[index + 1] ? [args[index + 1]] : [],
  );
  const result = inventoryCredentials({ root, exclusions });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else
    for (const credential of result.credentials)
      console.log(
        `${credential.name} | ${credential.type} | ${credential.consumer} | ${credential.location} | ${credential.provider} | ${credential.rotation} | expiration:${credential.expiration} | ${credential.severity}`,
      );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) cli();
