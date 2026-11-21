/**
 * Guard de adjuntos (incidente medido 2026-11-20: 4 de 9 fichas publicadas con
 * imágenes rotas).
 *
 * En Confluence, `ri:filename` resuelve contra los adjuntos de la página PROPIA:
 * si el markup de imagen viaja a una página nueva sin copiar el archivo, la
 * imagen se ve rota. Este módulo es puro (sin red) y describe qué adjuntos
 * referencia un cuerpo, cuáles se pueden copiar desde la página origen y cuáles
 * quedan como pendiente declarado. La ruta editorial lo usa antes de publicar:
 * si el markup de imagen no tiene un adjunto que viaje con la página, la
 * publicación queda bloqueada o la referencia se deja como texto plano.
 */

/** Nombres de archivo referenciados por el markup de imagen de un cuerpo. */
export interface AttachmentPlan {
  /** Referencias que existen en la página origen: se pueden copiar. */
  copy: string[];
  /** Referencias que no existen en ningún lado: quedan pendientes. */
  missing: string[];
}

/** Veredicto del guard, listo para el recibo de la ruta editorial. */
export interface AttachmentVerdict {
  status: 'ok' | 'partial' | 'blocked';
  referenced: string[];
  copy: string[];
  missing: string[];
  /** Texto del pendiente; presente solo si hay adjuntos sin resolver. */
  notice?: string;
}

/** Entrada tolerada por `assertAttachmentsResolvable`. */
export interface AttachmentResolution {
  referenced?: string[];
  copy?: string[];
  missing?: string[];
}

const RI_FILENAME = /ri:filename\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;

/** Quita acentos y baja a minúsculas: los nombres de archivo se comparan sin distinguir mayúsculas. */
function normalizeName(name: string): string {
  return name.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Última parte de una ruta: `downloads/referencia-att1.png` → `referencia-att1.png`. */
function basename(value: string): string {
  const clean = value.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  return decodeURIComponent(clean);
}

/**
 * Lista los archivos referenciados por el markup de imagen del cuerpo:
 * `ri:filename="..."` (storage de Confluence) y `src="..."` de `<img>` en
 * markup plano. Devuelve nombres únicos en el orden en que aparecen.
 */
export function extractAttachmentRefs(body: string): string[] {
  if (!body) return [];
  const refs: string[] = [];
  for (const match of body.matchAll(RI_FILENAME)) {
    const name = (match[1] ?? match[2] ?? '').trim();
    if (name) refs.push(name);
  }
  for (const match of body.matchAll(IMG_SRC)) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (!raw) continue;
    const name = basename(raw);
    if (name && IMAGE_EXTENSION.test(name)) refs.push(name);
  }
  return [...new Set(refs)];
}

/** Referenciados que no existen todavía en la página destino. */
export function missingAttachments(body: string, available: string[]): string[] {
  const present = new Set(available.map(normalizeName));
  return extractAttachmentRefs(body).filter((name) => !present.has(normalizeName(name)));
}

/**
 * Qué hay que copiar desde la página origen y qué no se puede resolver:
 * `copy` son los referenciados que existen en el origen; `missing`, los que no
 * existen en ningún lado y quedan pendientes.
 */
export function planAttachmentCopy(body: string, sourceAttachments: string[]): AttachmentPlan {
  const present = new Set(sourceAttachments.map(normalizeName));
  const copy: string[] = [];
  const missing: string[] = [];
  for (const name of extractAttachmentRefs(body)) {
    if (present.has(normalizeName(name))) copy.push(name);
    else missing.push(name);
  }
  return { copy, missing };
}

/**
 * Veredicto puro del guard: `ok` si no queda nada pendiente, `blocked` en modo
 * estricto cuando hay adjuntos sin origen y `partial` cuando el pendiente se
 * acepta y se declara.
 */
export function assertAttachmentsResolvable(
  result: AttachmentResolution,
  options: { strict: boolean },
): AttachmentVerdict {
  const copy = [...new Set(result.copy ?? [])];
  const missing = [...new Set(result.missing ?? [])];
  const referenced = [...new Set([...(result.referenced ?? []), ...copy, ...missing])];
  const status: AttachmentVerdict['status'] =
    missing.length === 0 ? 'ok' : options.strict ? 'blocked' : 'partial';
  const verdict: AttachmentVerdict = { status, referenced, copy, missing };
  if (missing.length) verdict.notice = pendingAttachmentNotice(missing);
  return verdict;
}

/** Texto del pendiente, en el tono del protocolo editorial. */
export function pendingAttachmentNotice(missing: string[]): string {
  const files = missing.map((name) => `«${name}»`);
  if (files.length === 1)
    return (
      `Falta el adjunto ${files[0]}: la imagen no se publica hasta que ese archivo ` +
      `se adjunte a la página. Queda declarado como pendiente.`
    );
  return (
    `Faltan los adjuntos ${files.join(', ')}: las imágenes no se publican hasta que ` +
    `esos archivos se adjunten a la página. Quedan declarados como pendientes.`
  );
}

/**
 * Saca del cuerpo el markup de imagen que no se puede publicar (el archivo no
 * existe ni en el destino ni en el origen). Un bloque `<ac:image>` que
 * referencia un adjunto pendiente se elimina completo: media imagen no es
 * menos roto que la imagen entera.
 */
export function stripAttachmentMarkup(body: string, missing: string[]): string {
  if (!body || missing.length === 0) return body;
  const pending = new Set(missing.map(normalizeName));
  const isPending = (block: string): boolean =>
    [...block.matchAll(RI_FILENAME)].some((match) =>
      pending.has(normalizeName((match[1] ?? match[2] ?? '').trim())),
    );
  const withoutAc = body.replace(
    /<ac:image\b[^>]*>[\s\S]*?<\/ac:image>|<ac:image\b[^>]*\/>/gi,
    (block) => (isPending(block) ? '' : block),
  );
  return withoutAc.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const raw = (match?.[1] ?? match?.[2] ?? '').trim();
    if (!raw) return tag;
    return pending.has(normalizeName(basename(raw))) ? '' : tag;
  });
}

/**
 * Atajo: verdict del guard sobre un cuerpo y los adjuntos que ya están en la
 * página destino. `strict` decide si lo pendiente bloquea o queda declarado.
 */
export function assessAttachments(
  body: string,
  available: string[],
  options: { strict: boolean },
): AttachmentVerdict {
  const missing = missingAttachments(body, available);
  return assertAttachmentsResolvable(
    { referenced: extractAttachmentRefs(body), copy: [], missing },
    options,
  );
}
