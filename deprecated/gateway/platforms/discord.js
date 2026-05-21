import { Client, Events, GatewayIntentBits } from 'discord.js';

export async function startDiscordBot(cfg, onMessage, log) {
  if (!cfg.token) {
    log('discord: no token configured, skipping');
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('discord: connection timeout'));
    }, 30000);

    client.once(Events.ClientReady, (c) => {
      started = true;
      clearTimeout(timeout);
      log(`discord: connected as ${c.user.tag}`);
      resolve({
        platform: 'discord',
        send: async (to, text) => {
          const channel = await client.channels.fetch(to);
          if (channel?.isTextBased()) {
            await channel.send(text);
          }
        },
        stop: async () => {
          client.destroy();
        },
      });
    });

    client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot) return;
      const guildId = msg.guild?.id;
      const channelId = msg.channel.id;
      if (cfg.allowedGuildIds?.length && !cfg.allowedGuildIds.includes(guildId)) return;
      if (cfg.allowedChannelIds?.length && !cfg.allowedChannelIds.includes(channelId)) return;
      onMessage({
        from: msg.author.username,
        text: msg.content,
        raw: { guildId, channelId, messageId: msg.id },
      });
    });

    client.on(Events.Error, (err) => {
      log(`discord: error -> ${err.message}`);
    });

    let started = false;
    client.login(cfg.token).catch(reject);
  });
}
