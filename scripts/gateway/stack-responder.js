import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 8000 }).trim();
  } catch { return null; }
}

const COMMANDS = {
  status: () => {
    const branch = run('git rev-parse --abbrev-ref HEAD') || 'unknown';
    const dirty = run('git status --porcelain') || '';
    const files = dirty ? dirty.split('\n').length : 0;
    return `📊 *Gentle-Vanguard — Status*\n\n🔀 Branch: \`${branch}\`\n📝 Files changed: ${files}\n🏁 Gateway: active (Telegram + WhatsApp)\n💡 Commands: \`help\`, \`commits\`, \`status\`, \`branch\`, \`last\``;
  },
  commits: () => {
    const log = run(`git log --oneline -10`) || 'no commits';
    return `📜 *Recent commits:*\n\n${log}`;
  },
  branch: () => {
    const branch = run('git rev-parse --abbrev-ref HEAD') || 'unknown';
    return `🔀 Current branch: \`${branch}\``;
  },
  last: () => {
    const last = run('git log -1 --format="%h %s (%ar)"') || 'no commits';
    return `📌 *Last commit:*\n${last}`;
  },
  help: () => {
    return `🤖 *Gentle-Vanguard — Comandos*\n\n• \`status\` — estado del stack y gateway\n• \`commits\` — últimos 10 commits\n• \`branch\` — rama actual\n• \`last\` — último commit\n• \`help\` — esta ayuda\n\n💡 Sin API key — respuestas basadas en el stack. Para respuestas IA, configurá \`ai.apiKey\` en \`gateway.json\``;
  },
};

export function generateStackReply(text) {
  const input = text.toLowerCase().trim();
  for (const [cmd, fn] of Object.entries(COMMANDS)) {
    if (input === cmd || input.startsWith(cmd + ' ') || input.startsWith('/' + cmd)) {
      return fn();
    }
  }

  const branch = run('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const last = run('git log -1 --format="%h %s"') || 'none';
  return `🤖 *Gentle-Vanguard* en \`${branch}\`\n📌 Último commit: \`${last}\`\n\nUsá \`help\` para comandos disponibles.\nPara respuestas con IA, configurá \`ai.apiKey\` en \`gateway.json\``;
}
