# Getting Started (legacy location)

> **Esta guía se movió.** La ruta canónica de instalación y primer uso es ahora
> [`GETTING-STARTED.md`](../../GETTING-STARTED.md) en la raíz del repo.
>
> Uso diario: [`docs/OPERATIONS.md`](../OPERATIONS.md) ·
> Permisos locales: [`docs/GOVERNANCE-USERS.md`](../GOVERNANCE-USERS.md)

## Documentos históricos de esta carpeta

| Documento | Estado |
| --- | --- |
| `installation.md` | LEGACY — contiene comandos obsoletos (paths de scripts migrados a TS). Usar `GETTING-STARTED.md` |
| `DEVELOPER-SETUP.md` | LEGACY — reemplazado por `npm run setup` |
| `CROSS-PLATFORM-SETUP.md` | LEGACY — ver `GETTING-STARTED.md` |
| `PREREQUISITES.md` | VIGENTE — requisitos y verificación post-instalación |

## Comando único de instalación

```bash
npm run setup
```

Idempotente: detecta prerequisitos, instala dependencias, inicializa Nexus, instala hooks,
construye el grafo y verifica con `install:doctor --strict`.
