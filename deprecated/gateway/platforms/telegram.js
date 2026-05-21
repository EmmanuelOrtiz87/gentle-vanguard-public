import TelegramBot from 'node-telegram-bot-api';
import { generateReply } from '../ai-responder.js';
import { generateStackReply } from '../stack-responder.js';

export async function startTelegramBot(cfg, onMessage, log) {
  if (!cfg.token) {
    log('telegram: no token configured, skipping');
    return null;
  }

  const bot = new TelegramBot(cfg.token, { polling: true });
  let started = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('telegram: connection timeout'));
    }, 15000);

    bot.on('polling_error', (err) => {
      log(`telegram: polling error -> ${err.message}`);
    });

    bot.on('message', (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      if (cfg.allowedChatIds?.length && !cfg.allowedChatIds.includes(chatId)) {
        return;
      }
      onMessage({
        from: msg.from?.username || msg.from?.first_name || `${chatId}`,
        text: msg.text,
        raw: { chatId, messageId: msg.message_id, date: msg.date },
      });
      if (cfg.ai?.enabled && cfg.ai?.apiKey) {
        bot.sendMessage(chatId, '🤖 Procesando...').then(async () => {
          const aiReply = await generateReply(cfg, msg.text, log);
          bot.sendMessage(chatId, aiReply || '❌ No pude procesar la respuesta.', { parse_mode: 'Markdown' });
        });
      } else {
        const reply = generateStackReply(msg.text);
        bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      }
    });

    bot.getMe().then((me) => {
      cfg.botUsername = me.username;
      started = true;
      clearTimeout(timeout);
      log(`telegram: connected as @${me.username}`);
      resolve({
        platform: 'telegram',
        send: async (to, text) => {
          const chatId = parseInt(to, 10);
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        },
        stop: async () => {
          await bot.stopPolling();
        },
      });
    }).catch(reject);
  });
}
