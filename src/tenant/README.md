# src/tenant — Multi-tenant helper (patrón shared-DB con `tenant_id`)

Patrón absorbido del research 2026-09-21 (engram 4106, multi-tenant CRM 2026 default).
Default de la industria hasta ~5000 tenants: **shared DB + `tenant_id` en CADA tabla +
composite indexes con `tenant_id` LEADING** (critical — trailing degrada a full scan).

## Decisiones de diseño

- **Pure module** — sin I/O, sin ORM. Las 4 funciones de DB son opt-in y aisladas.
- **SQL parametrizado** — nunca interpolación de strings para evitar injection.
- **Isolation negativo tests** — la suite verifica que query con tenant_id distinto
  retorna 0 filas (NO leak).
- **Sin ALTO acoplamiento** — el caller elige su ORM/query-builder. El helper provee
  composition de WHERE + index checks + migration helpers.

## Componentes

| Función | Propósito | Categoría |
| --- | --- | --- |
| `whereTenant(tenantId, opts?)` | Genera `{ sql: 'tenant_id = ?', params: [tenantId] }` | Pure |
| `whereEq(column, value)` | Helper para columnas simples | Pure |
| `buildWhere(tenant, ...extras)` | Compone con AND automático | Pure |
| `runWithTenant(db, tenantId, fn)` | Setea contexto global (closure stack) | Sintáctico |
| `getCurrentTenant()` | Lee el tenant activo | Sintáctico |
| `addTenantColumn(ctx)` | Paso 1: `ALTER TABLE ... ADD COLUMN tenant_id` | DB |
| `backfillTenant(ctx)` | Paso 2: `UPDATE ... SET tenant_id = ?` | DB |
| `setTenantNotNull(ctx)` | Paso 3: assert no NULLs + listo para NOT NULL | DB |
| `addTenantIndex(ctx)` | Paso 4: `CREATE INDEX ... (tenant_id, col1, col2)` | DB |
| `checkTenantIndexes(db, table, opts?)` | Lista índices con `leadingIsTenant` boolean | DB |
| `assertTenantLeading(db, table, opts?)` | Throws si hay índices sin tenant LEADING | DB |

## Patrón Expand-Migrate-Contract

```ts
import { addTenantColumn, backfillTenant, setTenantNotNull, addTenantIndex } from '...';

// Paso 1: add nullable (no rompe nada)
addTenantColumn({ db, table: 'contacts' });

// Paso 2: backfill (idempotente — segunda corrida es no-op)
backfillTenant({ db, table: 'contacts', defaultTenantId: 'gentle-vanguard' });

// Paso 3: set NOT NULL (requiere que no haya NULLs)
setTenantNotNull({ db, table: 'contacts' });

// Paso 4: idx compuesto LEADING tenant_id (critical para performance)
addTenantIndex({ db, table: 'contacts', columns: ['created_at'] });
```

Idempotencia: cada paso chequea estado pre-existente — re-correr la migration no rompe nada.

## Uso en queries

```ts
import { whereTenant, whereEq, buildWhere, runWithTenant, getCurrentTenant } from '...';

// Opción 1: composición explícita
const w = buildWhere(whereTenant('t1'), whereEq('status', 'active'));
const rows = db.prepare(`SELECT * FROM users WHERE ${w.sql}`).all(...w.params);

// Opción 2: scope con runWithTenant (más legible para queries múltiples)
runWithTenant(db, 't1', () => {
  const all = db.prepare('SELECT * FROM users').all(getCurrentTenant());
  const active = db.prepare('SELECT * FROM users WHERE status = ?').all('active', getCurrentTenant());
});

// Opción 3 (vigilante): assertTenantLeading en CI
test('all tables have tenant_id LEADING in composite indexes', () => {
  assertTenantLeading(db, 'users');
  assertTenantLeading(db, 'contacts');
  assertTenantLeading(db, 'messages');
});
```

## Negative tests de aislamiento

Suite de tests incluye 2 casos críticos que verifican **no cross-tenant leak**:

```ts
// Alice en t1 quiere sus mensajes
const w = buildWhere(whereTenant('t1'), whereEq('from_user', 'alice'));
const rows = db.prepare(`SELECT * FROM messages WHERE ${w.sql}`).all(...w.params);
// rows.length === 1, rows[0].id === 1 (NO incluye id=3 que es de t2)

// Alice en t2 NO ve los de t1
const w2 = buildWhere(whereTenant('t2'), whereEq('from_user', 'alice'));
const rows2 = db.prepare(`SELECT * FROM messages WHERE ${w2.sql}`).all(...w2.params);
// rows2[0].id === 3 (NO contiene id=1)
```

## Verificación de calidad de índices

`assertTenantLeading` se puede usar en CI como static check:

```ts
import { assertTenantLeading } from '...';

// Antes de hacer un deploy, verifica que TODOS los índices compuestos
// tienen tenant_id LEADING (degradación silenciosa si no).
test('pre-deploy: índices con tenant_id LEADING', () => {
  for (const t of ['users', 'contacts', 'messages', 'orders']) {
    assertTenantLeading(db, t);
  }
});
```

## Limitaciones actuales

- `setTenantNotNull` no ejecuta el `NOT NULL` real — verifica pre-condición y deja al caller
  ejecutar `ALTER TABLE ... RENAME TO _old; CREATE TABLE ... NOT NULL; INSERT ...; DROP _old`
  (SQLite no soporta `ALTER COLUMN ... SET NOT NULL`). El `assert` previo es la red de
  seguridad.
- `runWithTenant` usa un closure stack simple (no AsyncLocalStorage) — funciona solo con
  better-sqlite3 sync. Para drivers async se necesitaría ALS.
- El helper NO detecta cross-schema queries — el caller es responsable de siempre incluir
  `whereTenant()` en queries multi-tenant.

## Estado

- ✅ Core (helper.ts) — 26 tests unit + isolation tests
- ❌ Integración CRM — pendiente (refactor de queries existentes)
- ❌ CRM migration retroactivo — pendiente (cada tabla con `tenant_id` agregado + backfill)