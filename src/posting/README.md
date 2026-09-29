# src/posting — Auto-posting queue (pure core, platform-agnostic)

Implementación del patrón de cola con retry + DLQ + dedupe para auto-publicar contenido en
múltiples plataformas (X, LinkedIn, Instagram, TikTok, YouTube, Bluesky, Telegram, Threads,
Pinterest, Mastodon, etc.).

Patrón absorbido del research 2026-09-21 (engram 4106, Buffer/Metricool/Typefully/Svix):
- **At-least-once delivery** con idempotency TTL via dedupe `(tenant, event_id, platform)`.
- **Bulk upload** con dryRun=true → HTTP 207 mixed results.
- **Retry** con backoff exponencial + jitter (default 1s → 2s → 4s → ... cap 600s).
- **DLQ** (dead-letter queue) tras N intentos (default 9) — manual replay.
- **Pure core** (no I/O, no SDK) — el caller inyecta el clock + el sender + el DB.

## Estructura

| Archivo | Propósito |
| --- | --- |
| `queue.ts` | Core puro: `QueueDb` interface, `enqueue`, `enqueueBulk`, `claimNext`, `markSent`, `markFailed`, `replayDead`, `computeBackoff`. NO throw — devuelve `{ ok, reason? }` para control flow. |
| `tests/unit/posting/queue.test.ts` | 13 unit tests contra `QueueDb` fake (in-memory). |
| `apps/content-cms/server/posting/sqlite-adapter.ts` | Adapter concreto: implementa `QueueDb` con better-sqlite3 + migrations del CMS. |
| `apps/content-cms/server/posting/queue-integration.test.ts` | 9 integration tests con SQLite real. |
| (futuro) `apps/content-cms/server/posting/{x,linkedin,instagram,...}.ts` | Provider strategies (registran `send(post)` específico por plataforma). |

## Schema esperado

```sql
CREATE TABLE post_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL DEFAULT 'gentle-vanguard',
  event_id        TEXT NOT NULL,             -- stable per logical send
  platform        TEXT NOT NULL,             -- 'x' | 'linkedin' | 'instagram' | ...
  payload         TEXT NOT NULL,             -- JSON { text, media, ... }
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK(status IN ('queued','sending','sent','failed','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,             -- ISO timestamp
  last_error      TEXT,
  external_id     TEXT,                      -- provider-assigned id on success
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, event_id, platform)     -- dedupe per (tenant, logical event, target)
);
CREATE INDEX idx_post_queue_claim ON post_queue(status, next_attempt_at);
```

## Uso típico (caller)

```ts
import {
  enqueue, claimNext, markSent, markFailed,
  type QueueDb, type QueueClock, type QueueLogger,
} from './src/posting/queue.js';

const queueDb = createPostQueueDb(sqliteHandle); // or any QueueDb impl
const clock: QueueClock = { nowIso: () => new Date().toISOString() };
const logger: QueueLogger = console;

// 1) Encolar (idempotente por event_id + platform)
const r = enqueue(queueDb, clock, {
  eventId: 'post_2026_09_21_tweet_x',
  platform: 'x',
  payload: { text: 'Hello world', mediaUrls: [] },
});
if (!r.ok) console.error('enqueue failed:', r.reason);

// 2) Bulk con dryRun
const bulk = enqueueBulk(queueDb, clock, [
  { eventId: '...', platform: 'x', payload: { ... } },
  { eventId: '...', platform: 'linkedin', payload: { ... } },
  { eventId: '...', platform: 'instagram', payload: { ... } },
]);

// 3) Worker tick (corre cada N segundos)
const claimed = claimNext(queueDb, clock, 10);
for (const row of claimed) {
  try {
    const result = await sendToPlatform(row); // tu provider strategy
    markSent(queueDb, clock, row.id, result.externalId);
  } catch (err) {
    markFailed(queueDb, clock, logger, row.id, String(err), row.attempts, {
      maxAttempts: 9,
    });
  }
}

// 4) Replay manual desde DLQ
replayDead(queueDb, clock, deadRowId);
```

## Decisiones de diseño

- **`QueueDb` interface, no implementación hardcoded** — el caller decide storage (SQLite,
  Postgres, Redis, memoria para tests). El core es 100% puro y testeable.
- **No throw en validación** — `enqueue()` devuelve `{ ok: false, reason }` para control flow;
  `try/catch` solo en errores de SQL (responsabilidad del caller envolver).
- **Claim atómico en una sola query** — `UPDATE ... WHERE id IN (...) AND status='queued'`
  garantiza que dos workers no pueden reclamar la misma fila (transaccional en SQLite).
- **Idempotency TTL 7d** — el caller implementa via dedup `(tenant, event_id, platform)`;
  la `UNIQUE` constraint rechaza re-intentos y `ON CONFLICT DO NOTHING` lo hace transparente.
- **Backoff con jitter** — `2^attempt * 1000ms + jitter(0..1s)`, cap 600s. El jitter
  evita "thundering herd" cuando N workers fallan al mismo tiempo.
- **DLQ tras maxAttempts (default 9)** — `replayDead(id)` mueve una fila de 'dead' → 'queued'
  con attempts=0; el caller debe decidir si reintenta o marca como "abandonado".

## Estado

- ✅ Core (queue.ts) — 13 unit tests
- ✅ SQLite adapter (sqlite-adapter.ts) — 9 integration tests con DB real
- ✅ Migration (post_queue table) — registrada en apps/content-cms/server/db-migrations.ts
- ⏳ HTTP endpoints en apps/content-cms/server/server.ts — pendiente (requiere cirugía en el
  server 60KB; el caller puede llamar al adapter directamente via `createPostQueueDb(db)`)
- ⏳ Provider strategies por plataforma (X/LinkedIn/etc.) — pendiente. Cada provider es un
  módulo que implementa `send(post) → Promise<{ success, externalId, error? }>`. La cola
  está lista para recibirlos.

## Ver también

- `src/webhooks/README.md` — capacidad nativa de sign/verify (Standard Webhooks 2026).
  Los providers pueden recibir webhooks de la plataforma publicadora (con dedupe por
  `event_id` compartido entre outbound + inbound).
- `knowledge-base/00-inbox/engram-4106-architecture.md` — research completo de las 4 áreas
  con las decisiones de absorción.