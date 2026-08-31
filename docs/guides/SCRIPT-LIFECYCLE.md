# Lifecycle de scripts

Esta guía aplica [`rules/NORMATIVA-SCRIPT-LIFECYCLE.md`](../../rules/NORMATIVA-SCRIPT-LIFECYCLE.md)
al trabajo diario. La normativa es la fuente de obligaciones; esta página resume cómo revisar un
cambio sin asumir un estado que no haya sido verificado.

## Flujo TS-only/CMD-first

```text
inventario -> contrato -> implementación TS -> caller único -> pruebas -> documentación
                                      \\-> wrapper .cmd opcional, sin lógica duplicada
```

La forma normal es `npx tsx path/to/script.ts`. Los daemons y launchers que necesitan que el proceso
hijo sea el proceso real pueden usar `node --import tsx path/to/script.ts`. La regla de procesos
ocultos de Windows está en `AGENTS.md`.

## Checklist

- [ ] Existe un único entry point canónico y un owner.
- [ ] `package.json` o un `.cmd` versionado expone el comando soportado.
- [ ] No se introdujo dependencia de `pwsh` ni se documentó un `.ps1` como ruta activa.
- [ ] Callers, workflows y documentación apuntan al entry point correcto.
- [ ] Se ejecutaron typecheck, lint, prueba focalizada y smoke desde CMD.
- [ ] La ruta anterior tiene decisión explícita: wrapper, deprecated, archived o protected.
- [ ] No quedan dos implementaciones activas sin justificación registrada.
- [ ] El procedimiento funciona en checkout limpio.

## Evidencia actual del repositorio

`package.json` contiene comandos TS para salud, Watchtower, autostart, integración y pruebas; entre
ellos `health:check`, `watchtower:health`, `session:autostart:detached`, `test:phase-integration`,
`test:smoke` y `test:scripts-smoke`. También está rastreado
`scripts/utilities/session/session-autostart.cmd`. El inventario de `.ps1` debe tratarse como
snapshot y verificarse con Git, porque puede incluir cambios locales y material histórico.

## Referencias

- [Normativa](../../rules/NORMATIVA-SCRIPT-LIFECYCLE.md)
- [Política TS-first](../../rules/TYPESCRIPT-FIRST-POLICY.md)
- [Política de scripts históricos](../operations/PS1-LEGACY-POLICY.md)
- [Pruebas](TESTING-GUIDE.md)
