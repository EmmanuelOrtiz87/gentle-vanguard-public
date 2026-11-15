/**
 * opencode-session-launch.ts — wrapper interactivo de OpenCode (NORM-OPENCODE-001).
 *
 * Lanza el TUI de OpenCode en scope de sesión:
 *   1. heal-if-needed del canon + crea la copia de sesión (.runtime/opencode/)
 *   2. spawn `opencode` con OPENCODE_CONFIG apuntando a la COPIA — al cerrar,
 *      OpenCode persiste su selección de modelo en la copia, jamás en el canon
 *   3. al salir, reap de procesos huérfanos + verificación final del canon
 *
 * El spawn es interactivo (stdio inherit en la consola del usuario): NO es un
 * proceso oculto de daemon — es el propio TUI que el owner pidió abrir.
 *
 * Uso: node --import tsx src/tools/opencode-session-launch.ts [args de opencode]
 *      npm run opencode:session
 */
import { runSync, run } from '../core/run-command.js';
import { healOpencodeDrift, writeSessionConfig } from './opencode-session-scope.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function main(): void {
  const root = resolve(process.cwd());

  const heal = healOpencodeDrift(root);
  if (heal.detail) console.log(`[opencode-session] pre-launch: ${heal.detail}`);
  if (heal.healed === false && heal.status.kind === 'drift') {
    console.error(
      '[opencode-session] el canon sigue en deriva tras el heal — abortando para no abrir OpenCode sobre una flota rota',
    );
    process.exit(1);
  }

  const sessionConfig = writeSessionConfig(root);
  console.log(`[opencode-session] OPENCODE_CONFIG=${sessionConfig}`);

  // stdio inherit: el TUI corre EN esta consola (interactivo, no daemon).
  const child = run('opencode', process.argv.slice(2), {
    stdio: 'inherit',
    env: { OPENCODE_CONFIG: sessionConfig },
  });

  child.on('exit', (code) => {
    // Al cerrar OpenCode: heal del canon (defensa en profundidad; la copia de
    // sesión ya aísla la escritura) + reap de huérfanos — un solo paso.
    const hygiene = runSync(
      'node',
      [
        '--import',
        'tsx',
        resolve(root, 'src', 'tools', 'opencode-session-scope.ts'),
        '--session-end',
      ],
      { timeout: 120000 },
    );
    if (hygiene.status !== 0) {
      console.log('[opencode-session] cierre terminó con status ' + hygiene.status);
    }
    process.exit(code ?? 0);
  });
}

// entrypoint: detecta cuando el script corre directamente (vs importado por tests).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
