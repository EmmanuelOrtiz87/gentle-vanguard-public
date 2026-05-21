import wweb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import fs from 'node:fs';
import { generateReply } from '../ai-responder.js';
import { generateStackReply } from '../stack-responder.js';

const { Client, LocalAuth } = wweb;

export async function startWhatsAppBot(cfg, onMessage, log) {
  if (!cfg.sessionDir) {
    log('whatsapp: no sessionDir configured, skipping');
    return null;
  }

  const sessionDir = path.resolve(cfg.sessionDir);
  fs.mkdirSync(sessionDir, { recursive: true });

  const userDataDir = path.join(sessionDir, 'chrome-profile');

  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--disable-blink-features=AutomationControlled',
  ];

  const puppeteerOpts = { headless: false, args: browserArgs, defaultViewport: null };

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: puppeteerOpts,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
  });

   let qrDisplayed = false;
   let readyResolved = false;
   let resolveReady;

   const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

    client.on('qr', (qr) => {
      if (!qrDisplayed) {
        qrDisplayed = true;
        log('\nwhatsapp: === SCAN QR CODE WITH WHATSAPP ===');
        qrcode.generate(qr, { small: false });
      }
    });

  client.on('ready', () => {
    log(`whatsapp: connected as ${client.info?.pushname || client.info?.wid?.user || 'unknown'}`);
    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }
  });

   client.on('message', async (msg) => {
     if (!msg.body) return;
     const isGroup = msg.from.includes('@g.us');
     if (isGroup) return;

     const normalize = (n) => n.replace(/\D/g, '');
     const senderRaw = msg.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
     const senderDigits = normalize(senderRaw);
     const widUser = client.info?.wid?.user || '';
     const widDigits = normalize(widUser);
     const isSelfMsg = msg.fromMe || (widDigits && senderDigits.endsWith(widDigits.slice(-10)));
     
     // IMPORTANTE: Si no hay números permitidos configurados, aceptar todos los mensajes
     const allowedStr = (cfg.allowedNumbers || []).map(String);
     const isAllowed = allowedStr.length === 0 || allowedStr.some(a => senderDigits.endsWith(normalize(a).slice(-10)));

     log(`whatsapp: msg from ${senderRaw} (digits=${senderDigits}, self=${isSelfMsg}, allowed=${isAllowed}, allowedList=[${allowedStr.join(',')}]) -> ${msg.body.slice(0, 60)}`);
     
     if (!isAllowed && !isSelfMsg) {
       log(`whatsapp: FILTERED - sender ${senderDigits} not in allowed list [${allowedStr.map(a => normalize(a)).join(',')}]`);
       return;
     }

    onMessage({
      from: msg._data?.notifyName || senderRaw || 'unknown',
      text: msg.body,
      raw: { from: msg.from, chatId: msg.from, isGroup: false, messageId: msg.id._serialized, timestamp: msg.timestamp },
    });

    let reply;
    if (isSelfMsg && cfg.ai?.enabled && cfg.ai?.apiKey) {
      reply = `🤖 Procesando...\n\n"${msg.body.slice(0, 200)}"`;
      await client.sendMessage(msg.from, reply);
      const aiReply = await generateReply(cfg, msg.body, log);
      if (aiReply) {
        await client.sendMessage(msg.from, aiReply);
      } else {
        await client.sendMessage(msg.from, '❌ No pude procesar la respuesta.');
      }
    } else {
      reply = generateStackReply(msg.body);
      await client.sendMessage(msg.from, reply);
    }
  });

  client.on('disconnected', (reason) => {
    log(`whatsapp: disconnected (reason=${reason}, ready=${readyResolved})`);
    if (reason === 'LOGOUT') {
      log('whatsapp: LOGOUT — session invalid. Clearing local session data...');
      try {
        fs.rmSync(path.join(sessionDir, 'LocalAuth'), { recursive: true, force: true });
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
      log('whatsapp: session cleared. Restart gateway to scan QR again.');
    } else if (reason === 'NAVIGATION') {
      log('whatsapp: NAVIGATION — the page was navigated/refreshed. This is normal on first load if WA web redirects. Restart gateway to retry.');
    } else {
      log(`whatsapp: unexpected disconnect (${reason}). Restart gateway to retry.`);
    }
  });

  client.on('auth_failure', (msg) => {
    log(`whatsapp: auth failure -> ${msg}`);
  });

  client.initialize();

  await readyPromise;

  const adapter = {
    platform: 'whatsapp',
    send: async (to, text) => {
      await client.sendMessage(to, text);
    },
    stop: async () => {
      await client.destroy();
    },
  };

  return adapter;
}
