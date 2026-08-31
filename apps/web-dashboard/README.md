# Gentle-Vanguard Web Dashboard

Interfaz web local-first para observar el stack y operar sesiones de agentes mediante HTTP y
WebSocket. Es la superficie operativa, no el motor de ejecución de cada agente.

## Propósito y usuarios

| Aspecto           | Definición                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Propósito         | Centralizar métricas, trazas, salud, eventos, tareas y conversaciones operativas.         |
| Usuarios          | DEV, QA, BA, GOV, OPS, DOC y responsables de operación/observabilidad.                    |
| Clientes objetivo | Equipos que necesitan visibilidad y controles HITL sobre una instalación Gentle-Vanguard. |
| Operación         | Loopback/local-first; despliegue externo es opcional y requiere controles adicionales.    |

## Capacidades actuales

- Métricas de tokens, sesiones, Git y salud; trazas OpenTelemetry y feed en vivo.
- Chat con agentes, menciones, streaming, historial persistente y tarjetas `ui_hints`.
- HITL para confirmación, selección, formulario y revisión.
- Control y seguimiento de tareas, timeline de eventos y estado compartido.
- Alertas, auditoría, panel de procesos, skills/marketplace y documentación interactiva.
- Multi-tenant de deployment, autenticación configurable, RBAC v1 y fallback HTTP cuando cae
  WebSocket.
- API HTTP para métricas, salud, sesiones, herramientas, eventos y tareas.

## Arquitectura

`server/websocket-server.ts` aloja HTTP/WS; `server/mcp-bridge.ts` conecta herramientas MCP;
`server/shared-state-bridge.ts` enlaza el event bus; `server/database/manager.ts` administra Nexus
SQLite WAL. React vive en `src/`, con componentes, hooks, tipos y rutas de la aplicación.

La arquitectura vigente integra Obsidian como vault de conocimiento, Engram como memoria
persistente, Nexus como datos operativos, CodeGraph como índice incremental de tooling y Graphify
como grafo de análisis/consulta. El Dashboard visualiza o consume los datos disponibles; no
convierte por sí solo filesystem, vault o grafos en una fuente tenant sin la
clasificación/proveniencia correspondiente.

## Instalación y comandos

```bash
cd apps/web-dashboard
pnpm install
pnpm dev:server   # WS + HTTP
pnpm dev:client   # Vite
pnpm dev          # ambos
pnpm build        # genera tokens y compila TypeScript/Vite
pnpm typecheck
pnpm preview
pnpm test
pnpm lint
pnpm i18n:check
```

El cliente usa Vite (por defecto `5173`) y conecta al servidor WS configurado. Variables relevantes:
`WS_PORT`, `VITE_API_URL`, `GV_DASHBOARD_TOKEN` y `GV_DASHBOARD_CORS_ORIGINS`.

## Operación independiente

Se puede levantar sin Academy, CMS o Analytics. Para una operación completa necesita los procesos y
fuentes del stack que alimentan métricas, eventos, sesiones y MCP; una instalación vacía mostrará
los estados disponibles, no datos simulados. El servidor de base de datos crea/usa
`.runtime/gentle-vanguard.db`.

## API, WebSocket e import/export

El protocolo WS incluye creación/envío/listado de sesiones, ejecución de skills, suscripciones,
respuestas HITL y eventos. La API expone, entre otras, `/api/metrics`, `/api/health`,
`/api/agent/tools`, `/api/agent/sessions`, `/api/state/events` y `/api/state/tasks`.

No hay una exportación/importación general de dashboards o tenants documentada como capacidad del
producto. Los eventos, trazas y métricas se almacenan en Nexus y sus backups/operaciones de DB deben
realizarse con las herramientas del stack.

## Seguridad y límites

- En local, el acceso loopback puede operar sin token; en producción debe configurarse
  autenticación.
- Las rutas protegidas aplican autenticación, RBAC v1 y validación de tenant; las mutaciones cookie
  usan verificación CSRF según la implementación.
- Restringir CORS y no exponer WS/HTTP sin proxy, TLS, identidad y secretos gestionados.
- El Dashboard no sustituye un SIEM, IAM empresarial, sistema de tickets ni control de cambios.
- No se promete alta disponibilidad, retención regulatoria, soporte 24/7 ni aislamiento cloud por
  defecto.

## Soporte y criterios de comercialización

Para soporte, adjuntar ruta, endpoint, estado de salud y logs sin secretos; ejecutar `pnpm test` y
`pnpm build` antes de reportar. La operación del stack incluye `npm run db:health` y
`npm run watchtower:health` desde la raíz. No hay SLA comercial definido.

**Apto para operación local, observabilidad interna y demos controladas.** Para comercialización
enterprise faltan, según el entorno, packaging/deployment soportado, IAM federado, HA/backup
probado, retención y auditoría contractual, aislamiento multi-tenant validado, hardening perimetral
y soporte/SLA.
