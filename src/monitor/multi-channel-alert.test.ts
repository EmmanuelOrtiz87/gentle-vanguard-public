/**
 * CONTRATO del Multi-Channel Alert System (MCAS) — canales externos.
 *
 * Reproduce el fallo real (2026-11-06): los tres canales externos
 * (webhook / discord / slack) eran CODIGO MUERTO:
 *
 *   1) `enabled` estaba FIJO en `false`. Definir `DISCORD_WEBHOOK_URL` no
 *      activaba nada, aunque la documentacion (y el `--status`) dijeran que
 *      los canales se activan solos si existen las env vars.
 *
 *   2) La URL se guardaba en el campo `webhook` de TODOS los canales, pero
 *      los emisores leen `config.discord` / `config.slack`. O sea, aun con
 *      `enabled: true`, `config.discord` era `undefined` y el emisor salia
 *      sin enviar nada (fallo silencioso).
 *
 * Este archivo verifica el contrato en las DOS direcciones:
 *   - la derivacion env var -> `enabled` + URL en el campo que lee el emisor
 *   - el emisor REAL hace POST a la URL configurada (servidor HTTP local)
 *
 * Corre con:
 *   node --import tsx --test src/monitor/multi-channel-alert.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildConfig, buildExternalChannels, sendAlert } from './multi-channel-alert.js';

interface Captured {
  path: string;
  body: string;
}

function startCaptureServer(captured: Captured[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        captured.push({ path: req.url || '', body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/hook` });
    });
  });
}

describe('mcas: derivacion de canales externos', () => {
  it('POSITIVO: sin env vars, los tres canales externos quedan deshabilitados', () => {
    const ch = buildExternalChannels({});
    assert.equal(ch.webhook.enabled, false);
    assert.equal(ch.discord.enabled, false);
    assert.equal(ch.slack.enabled, false);
  });

  it('POSITIVO: con env var, el canal se habilita Y la URL queda en el campo que lee el emisor', () => {
    const ch = buildExternalChannels({
      ALERT_WEBHOOK_URL: 'https://example.test/webhook',
      DISCORD_WEBHOOK_URL: 'https://example.test/discord',
      SLACK_WEBHOOK_URL: 'https://example.test/slack',
    });

    assert.equal(ch.webhook.enabled, true);
    assert.equal(ch.webhook.webhook, 'https://example.test/webhook');

    assert.equal(ch.discord.enabled, true);
    // El emisor lee `config.discord`, NO `config.webhook`.
    assert.equal(ch.discord.discord, 'https://example.test/discord');

    assert.equal(ch.slack.enabled, true);
    assert.equal(ch.slack.slack, 'https://example.test/slack');
  });

  it('NEGATIVO: la URL de discord NO puede aterrizar en el campo `webhook` (el bug original)', () => {
    const ch = buildExternalChannels({ DISCORD_WEBHOOK_URL: 'https://example.test/discord' });
    assert.equal(
      (ch.discord as unknown as Record<string, unknown>).webhook,
      undefined,
      'discord no debe guardar su URL en el campo `webhook`',
    );
    assert.equal((ch.slack as unknown as Record<string, unknown>).webhook, undefined);
  });

  it('NEGATIVO: una env var vacia NO habilita el canal', () => {
    const ch = buildExternalChannels({ DISCORD_WEBHOOK_URL: '', SLACK_WEBHOOK_URL: '' });
    assert.equal(ch.discord.enabled, false);
    assert.equal(ch.slack.enabled, false);
  });

  it('NEGATIVO: cada canal se habilita SOLO con SU env var (no hay habilitacion cruzada)', () => {
    const ch = buildExternalChannels({ SLACK_WEBHOOK_URL: 'https://example.test/slack' });
    assert.equal(ch.slack.enabled, true);
    assert.equal(ch.discord.enabled, false);
    assert.equal(ch.webhook.enabled, false);
  });

  it('buildConfig mantiene los canales internos activos', () => {
    const cfg = buildConfig({});
    assert.equal(cfg.channels.cli, true);
    assert.equal(cfg.channels.file, true);
    assert.equal(cfg.channels.dashboard, true);
  });
});

describe('mcas: el emisor externo entrega de verdad', () => {
  it('POSITIVO: discord hace POST al webhook configurado y reporta `sent`', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      const cfg = buildConfig({ DISCORD_WEBHOOK_URL: url });
      const result = await sendAlert(
        { severity: 'warning', category: 'contract-test', message: 'MCAS contract probe' },
        cfg,
      );

      assert.ok(result.sent.includes('discord'), 'discord deberia reportarse como enviado');
      assert.equal(captured.length, 1, 'deberia haberse recibido exactamente 1 POST');
      const payload = JSON.parse(captured[0].body);
      assert.equal(payload.username, 'Gentle-Vanguard');
      assert.equal(payload.embeds[0].description, 'MCAS contract probe');
    } finally {
      server.close();
    }
  });

  it('POSITIVO: slack hace POST con su payload y webhook usa su propio cuerpo', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      const cfg = buildConfig({ SLACK_WEBHOOK_URL: url, ALERT_WEBHOOK_URL: url });
      const result = await sendAlert(
        { severity: 'critical', category: 'contract-test', message: 'MCAS contract probe 2' },
        cfg,
      );

      assert.ok(result.sent.includes('slack'));
      assert.ok(result.sent.includes('webhook'));
      assert.equal(captured.length, 2);

      const bodies = captured.map((c) => JSON.parse(c.body));
      const slack = bodies.find((b) => Array.isArray(b.attachments));
      const webhook = bodies.find((b) => b.alert === 'critical');
      assert.ok(slack, 'deberia haber un payload con attachments (slack)');
      assert.ok(webhook, 'deberia haber un payload con campo `alert` (webhook generico)');
      assert.equal(webhook.message, 'MCAS contract probe 2');
    } finally {
      server.close();
    }
  });

  it('NEGATIVO: sin env var, ningun canal externo reporta envio (no hay delivery fantasma)', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      // URL presente pero el canal NO habilitado -> el emisor no debe enviar.
      const cfg = buildConfig({});
      cfg.channels.webhook = { enabled: false, webhook: url };
      cfg.channels.discord = { enabled: false, discord: url };
      cfg.channels.slack = { enabled: false, slack: url };

      const result = await sendAlert(
        { severity: 'info', category: 'contract-test', message: 'must not be delivered' },
        cfg,
      );

      assert.equal(captured.length, 0, 'no deberia haberse enviado nada');
      assert.equal(result.sent.includes('discord'), false);
      assert.equal(result.sent.includes('slack'), false);
      assert.equal(result.sent.includes('webhook'), false);
    } finally {
      server.close();
    }
  });
});

describe('mcas: derivacion de los 4 canales nuevos (telegram/whatsapp/sms/email)', () => {
  it('POSITIVO: telegram se habilita SOLO con bot token + chat id', () => {
    const off = buildExternalChannels({});
    assert.equal(off.telegram.enabled, false);
    const half = buildExternalChannels({ TELEGRAM_BOT_TOKEN: 'tok' });
    assert.equal(half.telegram.enabled, false, 'token sin chat id NO habilita');
    const on = buildExternalChannels({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' });
    assert.equal(on.telegram.enabled, true);
    assert.equal(on.telegram.telegramToken, 'tok');
    assert.equal(on.telegram.telegramChatId, '123');
    assert.equal(on.telegram.telegramApiBase, 'https://api.telegram.org');
  });

  it('POSITIVO: whatsapp y sms requieren SUS 4 env vars (sin habilitacion cruzada)', () => {
    const waOnly = buildExternalChannels({
      WHATSAPP_ACCOUNT_SID: 'AC',
      WHATSAPP_AUTH_TOKEN: 'pw',
      WHATSAPP_FROM: 'whatsapp:+14155238886',
      WHATSAPP_TO: 'whatsapp:+5491100000000',
    });
    assert.equal(waOnly.whatsapp.enabled, true);
    assert.equal(waOnly.sms.enabled, false, 'credenciales de WA no habilitan SMS');
    assert.equal(waOnly.telegram.enabled, false);

    const smsOnly = buildExternalChannels({
      SMS_ACCOUNT_SID: 'AC',
      SMS_AUTH_TOKEN: 'pw',
      SMS_FROM: '+14155238886',
      SMS_TO: '+5491100000000',
    });
    assert.equal(smsOnly.sms.enabled, true);
    assert.equal(smsOnly.whatsapp.enabled, false);
    // apiBase default de Twilio, override posible para tests
    assert.equal(smsOnly.sms.twilioApiBase, 'https://api.twilio.com');
  });

  it('POSITIVO: email se habilita con SMTP_HOST + ALERT_EMAIL_TO; PORT default 587', () => {
    const off = buildExternalChannels({ SMTP_HOST: 'smtp.test' });
    assert.equal(off.email.enabled, false, 'host sin destinatario NO habilita');
    const on = buildExternalChannels({ SMTP_HOST: 'smtp.test', ALERT_EMAIL_TO: 'a@b.c' });
    assert.equal(on.email.enabled, true);
    assert.equal(on.email.smtpPort, 587);
  });

  it('NEGATIVO: env var vacia no habilita ninguno de los nuevos', () => {
    const ch = buildExternalChannels({
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      WHATSAPP_ACCOUNT_SID: '',
      SMS_ACCOUNT_SID: '',
      SMTP_HOST: '',
    });
    assert.equal(ch.telegram.enabled, false);
    assert.equal(ch.whatsapp.enabled, false);
    assert.equal(ch.sms.enabled, false);
    assert.equal(ch.email.enabled, false);
  });
});

describe('mcas: emision real por telegram/whatsapp/sms (servidor HTTP local)', () => {
  it('POSITIVO: telegram hace POST a /bot{token}/sendMessage con chat_id y texto', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      const base = url.replace('/hook', '');
      const cfg = buildConfig({
        TELEGRAM_BOT_TOKEN: 'ABC123',
        TELEGRAM_CHAT_ID: '42',
        TELEGRAM_API_BASE: base,
      });
      const result = await sendAlert(
        { severity: 'critical', category: 'probe', message: 'telegram probe' },
        cfg,
      );
      assert.ok(result.sent.includes('telegram'));
      assert.equal(captured.length, 1);
      assert.ok(captured[0].path.includes('/botABC123/sendMessage'), `path real: ${captured[0].path}`);
      const payload = JSON.parse(captured[0].body);
      assert.equal(payload.chat_id, '42');
      assert.ok(payload.text.includes('telegram probe'));
      assert.ok(payload.text.includes('CRITICAL'));
    } finally {
      server.close();
    }
  });

  it('POSITIVO: whatsapp hace POST a Messages.json con Basic auth y form-encoded', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      const base = url.replace('/hook', '');
      const cfg = buildConfig({
        WHATSAPP_ACCOUNT_SID: 'ACxx',
        WHATSAPP_AUTH_TOKEN: 'secret',
        WHATSAPP_FROM: 'whatsapp:+14155238886',
        WHATSAPP_TO: 'whatsapp:+5491100000000',
        WHATSAPP_API_BASE: base,
      });
      const result = await sendAlert(
        { severity: 'emergency', category: 'probe', message: 'wa probe' },
        cfg,
      );
      assert.ok(result.sent.includes('whatsapp'));
      assert.equal(captured.length, 1);
      assert.ok(
        captured[0].path.includes('/2010-04-01/Accounts/ACxx/Messages.json'),
        `path real: ${captured[0].path}`,
      );
      const params = new URLSearchParams(captured[0].body);
      assert.equal(params.get('From'), 'whatsapp:+14155238886');
      assert.equal(params.get('To'), 'whatsapp:+5491100000000');
      assert.ok((params.get('Body') ?? '').includes('wa probe'));
    } finally {
      server.close();
    }
  });

  it('POSITIVO: sms usa el mismo REST con sus propios FROM/TO', async () => {
    const captured: Captured[] = [];
    const { server, url } = await startCaptureServer(captured);
    try {
      const base = url.replace('/hook', '');
      const cfg = buildConfig({
        SMS_ACCOUNT_SID: 'ACsms',
        SMS_AUTH_TOKEN: 'secret2',
        SMS_FROM: '+14155238886',
        SMS_TO: '+5491100000001',
        SMS_API_BASE: base,
      });
      const result = await sendAlert(
        { severity: 'warning', category: 'probe', message: 'sms probe' },
        cfg,
      );
      assert.ok(result.sent.includes('sms'));
      const params = new URLSearchParams(captured[0].body);
      assert.equal(params.get('To'), '+5491100000001');
      assert.ok((params.get('Body') ?? '').includes('sms probe'));
    } finally {
      server.close();
    }
  });

  it('POSITIVO: email entrega via transporte inyectado (sin SMTP real)', async () => {
    const sent: Record<string, unknown>[] = [];
    const cfg = buildConfig({ SMTP_HOST: 'smtp.test', ALERT_EMAIL_TO: 'owner@gv.dev' });
    cfg.channels.email.transport = {
      sendMail: async (opts) => {
        sent.push(opts);
        return {};
      },
    };
    const result = await sendAlert(
      { severity: 'critical', category: 'probe', message: 'mail probe', recommendation: 'mirar' },
      cfg,
    );
    assert.ok(result.sent.includes('email'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@gv.dev');
    assert.ok(String(sent[0].subject).includes('[GV CRITICAL]'));
    assert.ok(String(sent[0].text).includes('mail probe'));
  });

  it('NEGATIVO: canales nuevos sin env vars no envian ni reportan `sent`', async () => {
    const captured: Captured[] = [];
    const { server } = await startCaptureServer(captured);
    try {
      const result = await sendAlert(
        { severity: 'info', category: 'contract-test', message: 'silence' },
        buildConfig({}),
      );
      assert.equal(captured.length, 0);
      for (const c of ['telegram', 'whatsapp', 'sms', 'email']) {
        assert.equal(result.sent.includes(c), false, `${c} no deberia reportarse enviado`);
      }
    } finally {
      server.close();
    }
  });
});
