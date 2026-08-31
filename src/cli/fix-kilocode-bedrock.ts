import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { z } from 'zod';

const OptionsSchema = z.object({
  apply: z.boolean(),
  verbose: z.boolean(),
});

const LITELLM_CONFIG = `litellm_settings:
  drop_params: true
  verbose: false
  cache: true

model_list:
  - model_name: "kimi-2-5"
    litellm_params:
      model: "bedrock/moonshotai.kimi-k2.5"
      drop_params: true
      temperature: 0.3
      max_tokens: 4096
  - model_name: "claude-haiku-4-5"
    litellm_params:
      model: "bedrock/anthropic.claude-3-haiku-20240307-v1:0"
      drop_params: true
      temperature: 0.3
      max_tokens: 4096
  - model_name: "claude-sonnet"
    litellm_params:
      model: "bedrock/anthropic.claude-3-sonnet-20240229-v1:0"
      drop_params: true
      temperature: 0.3
      max_tokens: 4096
  - model_name: "claude-opus"
    litellm_params:
      model: "bedrock/anthropic.claude-3-opus-20240229-v1:0"
      drop_params: true
      temperature: 0.3
      max_tokens: 4096

router_settings:
  routing_strategy: "simple-shuffle"
  enable_cooldowns: true
  cooldown_time: 300
  num_retries: 3
  timeout: 60
`;

const KILOCODE_CONFIG = JSON.stringify(
  {
    version: '2.0.0',
    provider: 'bedrock',
    model: 'bedrock/moonshotai.kimi-k2.5',
    litellm_config_path: '~/.config/litellm/config.yaml',
    litellm_settings: { drop_params: true, verbose: false, cache: true },
    model_settings: Object.fromEntries(
      ['kimi-2-5', 'claude-haiku-4-5', 'claude-sonnet', 'claude-opus'].map((model) => [
        model,
        { temperature: 0.3, max_tokens: 4096, drop_params: true },
      ]),
    ),
    dropped_params: [
      'reasoning_effort',
      'logprobs',
      'logit_bias',
      'user',
      'response_format',
      'seed',
      'tools',
      'tool_choice',
    ],
  },
  null,
  2,
);

function parseOptions(args: string[]): z.infer<typeof OptionsSchema> {
  return OptionsSchema.parse({
    apply: args.includes('--apply'),
    verbose: args.includes('--verbose'),
  });
}

function confirm(): Promise<boolean> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    input.question('Apply these changes to your user configuration? [y/N] ', (answer) => {
      input.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

function backup(path: string): void {
  if (!existsSync(path)) return;
  const backupPath = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(path, backupPath);
  console.log(`Backed up ${path} to ${backupPath}`);
}

function writeConfig(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  backup(path);
  writeFileSync(path, content, 'utf8');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const litellmPath = join(home, '.config', 'litellm', 'config.yaml');
  const kiloCodePath = join(
    appData,
    'Code',
    'User',
    'globalStorage',
    'kilocode.kilo-code',
    'config.json',
  );

  console.log('KiloCode Bedrock configuration (dry-run by default)');
  console.log(`Would write: ${litellmPath}`);
  console.log(`Would write: ${kiloCodePath}`);
  console.log(
    'Would set user environment variables: LITELLM_DROP_PARAMS=true and LITELLM_CONFIG_PATH',
  );

  if (!options.apply) {
    console.log('No changes made. Re-run with --apply and confirm to apply.');
    return;
  }
  if (!(await confirm())) {
    console.log('Cancelled. No changes made.');
    return;
  }

  writeConfig(litellmPath, LITELLM_CONFIG);
  writeConfig(kiloCodePath, KILOCODE_CONFIG);
  process.env.LITELLM_DROP_PARAMS = 'true';
  process.env.LITELLM_CONFIG_PATH = litellmPath;
  if (process.platform === 'win32') {
    execFileSync('setx', ['LITELLM_DROP_PARAMS', 'true'], { windowsHide: true, stdio: 'ignore' });
    execFileSync('setx', ['LITELLM_CONFIG_PATH', litellmPath], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  if (options.verbose)
    console.log(
      `Applied configuration using ${readFileSync(litellmPath, 'utf8').length} YAML characters.`,
    );
  console.log('Configuration applied. Restart VS Code before testing KiloCode.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { main, parseOptions };
