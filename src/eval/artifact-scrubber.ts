/**
 * artifact-scrubber.ts — Redacta secretos y rutas de usuario de los artefactos.
 *
 * Regla de `rules/AI-NORMATIVES.md` §6 (Security Rules, OWASP-aligned):
 *
 *   1. "No secrets in output" — API keys, tokens, passwords → `<REDACTED>`
 *   2. "No path disclosure"  — home/user paths → `<HOME>`, `<PATH>`
 *
 * Por que vive aqui y no en el scanner de secretos: el scanner
 * (`src/security/secret-scanner/`) audita el REPO; este redacta la SALIDA de
 * un modelo, que es otra cosa. Los pool files que lee el selector guardan la
 * trayectoria cruda del substrate (stdout/stderr del CLI), y esa trayectoria
 * puede contener el token del proveedor o la ruta home de la maquina que
 * ejecuto la corrida.
 *
 * La politica es REDACTAR, no descartar: perder el artefacto por contener un
 * token perderia evidencia de la corrida. Lo que se pierde es el valor, no el
 * hecho de que estaba.
 */

/** Formas de secreto con valor reconocible. */
const SECRET_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'clave-openai', re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g },
  { label: 'token-github', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { label: 'clave-aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'token-bearer', re: /\bBearer\s+[A-Za-z0-9._~-]{16,}/g },
  {
    label: 'asignacion-de-secreto',
    re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd)\b(\s*[:=]\s*)["']?[^\s"',;]{6,}/gi,
  },
];

/** Formas de ruta que revelan el usuario o el arbol de la maquina. */
const HOME_PATH_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'home-windows', re: /\b[A-Za-z]:[\\/]Users[\\/][^\\\s"'<>|]+/g },
  { label: 'home-unix', re: /\/home\/[^/\s"'<>|]+/g },
  { label: 'home-macos', re: /\/Users\/[^/\s"'<>|]+/g },
];

/** Resultado del redactedado, con el conteo de lo que se ocultó. */
export interface ScrubResult {
  /** Texto redactedado. */
  text: string;
  /** Etiquetas de lo que se redacto, sin duplicados. */
  redacted: string[];
}

/**
 * Redacta secretos y rutas de usuario.
 *
 * Primero los secretos: si una ruta aparece DENTRO de un valor secreto, el
 * orden inverso dejaria el resto del valor expuesto.
 */
export function scrubArtifact(input: string): ScrubResult {
  let text = input;
  const redacted = new Set<string>();

  for (const { label, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      redacted.add(label);
      re.lastIndex = 0;
      text = text.replace(re, (match) => {
        // En una asignacion se conserva el nombre y el separador: el auditor
        // necesita ver QUE se ocultó, no solo que algo se ocultó.
        const separator = match.match(/\s*[:=]\s*/);
        return separator ? `${match.slice(0, match.indexOf(separator[0]))}${separator[0]}<REDACTED>` : '<REDACTED>';
      });
    }
  }

  for (const { label, re } of HOME_PATH_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      redacted.add(label);
      re.lastIndex = 0;
      text = text.replace(re, '<HOME>');
    }
  }

  return { text, redacted: [...redacted] };
}

/** Version de convenience: solo el texto redactedado. */
export function scrubText(input: string): string {
  return scrubArtifact(input).text;
}
