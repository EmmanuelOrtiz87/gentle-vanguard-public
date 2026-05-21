import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTelegramBot } from './platforms/telegram.js';
import { startDiscordBot } from './platforms/discord.js';
import { startWhatsAppBot } from './platforms/whatsapp.js';
import { Agent } from './agent/agent.js';
import { getScheduler } from './agent/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'gateway.json');
const LOG_FILE = path.join(ROOT, '.session', 'gateway', 'gateway.log');

let config = {};
let running = true;
let adapters = [];
let agent = null;
let scheduler = null;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch { }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function saveInbound(platform, msg) {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.TZ-]/g, '').slice(0, 14);
  const id = `${ts}-${platform}-${Date.now()}`;
  const entry = {
    id, platform, ts: now.toISOString(),
    from: msg.from, text: msg.text, raw: msg.raw,
    processed: false,
  };
  const file = path.join(ROOT, config.inboxDir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  log(`INBOX: ${platform} <- ${msg.from}: ${msg.text?.slice(0, 80)}`);
  if (config.notifications?.console) {
    process.stdout.write(`\n\x1b[36m[GATEWAY]\x1b[0m \x1b[33m${platform}\x1b[0m \x1b[32m${msg.from}\x1b[0m: ${msg.text}\n`);
  }
  if (agent && config.agent?.enabled) {
    agent.processMessage(id, platform, msg.from, msg.text, async (replyText) => {
      const adapter = adapters.find(a => a.platform === platform);
      if (adapter) {
        const to = msg.raw?.chatId?.toString() || msg.raw?.jid || msg.from;
        await adapter.send(to, replyText);
        log(`AGENT REPLY: ${platform} -> ${to}: ${replyText.slice(0, 80)}`);
      } else {
        const outFile = path.join(ROOT, config.outboxDir, `agent-${id}.json`);
        fs.writeFileSync(outFile, JSON.stringify({ platform, to: msg.raw?.chatId || msg.raw?.jid || msg.from, text: replyText }, null, 2));
      }
    });
  }
}

function checkOutbound() {
  const outboxDir = path.join(ROOT, config.outboxDir);
  ensureDir(outboxDir);
  const files = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const fullPath = path.join(outboxDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const adapter = adapters.find(a => a.platform === data.platform);
      if (adapter && adapter.send) {
        adapter.send(data.to, data.text).then(() => {
          fs.unlinkSync(fullPath);
          log(`OUTBOX: ${data.platform} -> ${data.to}: ${data.text?.slice(0, 80)}`);
        }).catch(err => {
          log(`OUTBOX FAIL: ${data.platform} -> ${err.message}`);
        });
      }
    } catch (err) {
      log(`OUTBOX PARSE ERR: ${file} -> ${err.message}`);
    }
  }
}

async function main() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    log(`FATAL: cannot read ${CONFIG_PATH} -> ${err.message}`);
    process.exit(1);
  }

  if (!config.enabled) {
    log('Gateway disabled in config. Set "enabled": true to start.');
    process.exit(0);
  }

  [config.inboxDir, config.outboxDir, config.logDir].forEach(d => ensureDir(path.join(ROOT, d)));

  log('Gateway starting...');

  try {
    const { reloadPlugins } = await import('./agent/plugin-loader.js');
    const plugins = await reloadPlugins();
    if (plugins.defs.length > 0) {
      log(`plugins: loaded ${plugins.defs.length} plugin tool(s)`);
    }
  } catch (err) {
    log(`plugins: init error -> ${err.message}`);
  }

  const handlers = {
    telegram: startTelegramBot,
    discord: startDiscordBot,
    whatsapp: startWhatsAppBot,
  };

  for (const [platform, starter] of Object.entries(handlers)) {
    const cfg = config.platforms[platform];
    if (cfg?.enabled) {
      try {
        const adapter = await starter(cfg, (msg) => saveInbound(platform, msg), log);
        if (adapter) {
          adapters.push(adapter);
          log(`${platform}: connected`);
        }
      } catch (err) {
        log(`${platform}: FAILED -> ${err.message}`);
      }
    }
  }

  if (config.agent?.enabled) {
    agent = new Agent(config, log);
    agent.start();
    log('agent: enabled');
  }

  scheduler = getScheduler(config, log);
  scheduler.start();
  log('scheduler: enabled');

  if (config.sessionIntegration?.autoProcessInbox) {
    const interval = config.sessionIntegration.autoProcessIntervalMs || 60000;
    setInterval(() => {
      const inboxDir = path.join(ROOT, config.inboxDir);
      if (!fs.existsSync(inboxDir)) return;
      const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const fp = path.join(inboxDir, f);
          const msg = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          if (msg.processed) continue;
          if (agent && config.agent?.enabled) {
            const platform = msg.platform || 'unknown';
            const from = msg.from || 'unknown';
            agent.processMessage(msg.id, platform, from, msg.text, async (replyText) => {
              const adapter = adapters.find(a => a.platform === platform);
              if (adapter) {
                const to = msg.raw?.chatId?.toString() || msg.raw?.jid || from;
                await adapter.send(to, replyText);
              }
            });
          }
        } catch (e) {
          log(`AUTO-INBOX: error processing ${f} -> ${e.message}`);
        }
      }
    }, interval);
    log(`auto-inbox: enabled (${interval}ms interval)`);
  }

  log(`Gateway ready. ${adapters.length} adapter(s) active.`);

  setInterval(checkOutbound, config.pollIntervalMs || 3000);

  process.on('SIGINT', () => {
    log('Gateway shutting down...');
    running = false;
    if (agent) agent.stop();
    if (scheduler) scheduler.stop();
    Promise.all(adapters.map(a => a.stop?.())).then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    log('Gateway terminating...');
    running = false;
    if (scheduler) scheduler.stop();
    Promise.all(adapters.map(a => a.stop?.())).then(() => process.exit(0));
  });
}

main();
