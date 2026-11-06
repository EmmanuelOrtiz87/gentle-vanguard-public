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
