/**
 * auditoria-clientes.ts — NORM-CLIENTES-002 y NORM-CLIENTES-011.
 *
 * Detecta las dos regresiones que hicieron que un paquete quedara desincronizado:
 *  1. Artefactos de cliente fuera de `docs/clientes/<slug>/` (propuestas, presupuestos,
 *     planes, business cases, data JSON, presentaciones sueltos en otra carpeta).
 *  2. Entregables binarios (DOCX/XLSX/PPTX) sin fuente versionada en el paquete, que es
 *     la causa raíz del drift: un binario sin fuente no se puede regenerar ni revisar.
 *
 * Uso:
 *   npx tsx src/ops/auditoria-clientes.ts            # todos los paquetes
 *   npx tsx src/ops/auditoria-clientes.ts <slug> ... # solo esos
 *
 * Exit 0 = conforme · Exit 1 = regresiones.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CLIENTS_DIR = join(ROOT, "docs/clientes");

/**
 * Extensiones que son entregables y por lo tanto exigen fuente versionada.
 * `.pdf` esta incluido: los PDF se generan desde el MD por el pipeline, asi que un PDF
 * sin MD es exactamente el caso de deriva que hay que ver (un render viejo, o un archivo
 * generado desde la raiz del paquete en vez de desde su carpeta).
 */
const ENTREGABLES = new Set([".docx", ".xlsx", ".pptx", ".pdf"]);

/**
 * Palabras que delatan que un archivo pertenece a un paquete de cliente. Se busca en el
 * nombre del archivo o en su ruta inmediata para no marcar todo `.docx` del repo.
 */
const MARCADORES_CLIENTE = [
  "propuesta",
  "presupuesto",
  "plan-de-trabajo",
  "business-case",
  "pitch",
  "kickoff",
  "contrato-servicios",
  "addendum",
  "acta-entrega",
];

/**
 * Sufijo de versión o fecha al final del nombre: `-2026`, `-2026-10`, `-v1`, `-v1.1`.
 * Se eliminan de a uno para no anidar cuantificadores (eslint detect-unsafe-regex).
 */
const SUFIJO_AÑO = /-\d{4}$/;
const SUFIJO_AÑO_MES = /-\d{4}-\d{2}$/;
const SUFIJO_VERSION_Mayor = /-v\d+$/;
const SUFIJO_VERSION_Menor = /-v\d+\.\d+$/;

/** Quita el sufijo de fecha o versión del nombre de un entregable. */
function sinSufijo(nombre: string): string {
  return nombre
    .replace(SUFIJO_AÑO_MES, "")
    .replace(SUFIJO_AÑO, "")
    .replace(SUFIJO_VERSION_Menor, "")
    .replace(SUFIJO_VERSION_Mayor, "");
}

/** Raíces donde nunca debe haber artefactos de cliente. */
const ZONAS_PROHIBIDAS = ["docs/generated", "docs", "docs/plantillas", "knowledge-base", "apps"];

/**
 * Carpetas que no son entregables del cliente: copias de plantillas, índices de docs y
 * artefactos de proceso. NORM-CLIENTES-011 exige fuente para entregables, no para copias.
 */
const EXCLUIDAS_POR_RUTA = [/(^|\/)_templates(\/|$)/, /(^|\/)docs\/generated(\/|$)/, /(^|\/)_build(\/|$)/];

/**
 * Archivos temporales de Office: al abrir un .docx/.xlsx/.pptx, Office deja un lock
 * con prefijo `~$`. No son entregables y no deben registrarse como faltantes de fuente.
 */
function esTemporalOffice(nombre: string): boolean {
  return nombre.startsWith("~$") || nombre.startsWith(".~");
}

interface Hallazgo {
  regla: string;
  ruta: string;
  detalle: string;
}

/**
 * Carpetas numeradas del paquete donde vive cada tipo de entregable. Un entregable en
 * la raíz del paquete es deriva: suele ser un render generado con el script ejecutado
 * desde la raíz en vez de desde la carpeta del documento, y envejece sin que nadie lo vea.
 */
const CARPETAS_ENTREGABLE = /^\d{2}-[a-z-]+\//;

/** Ruta relativa al repo con separador '/', independiente de Windows o POSIX. */
function rel(ruta: string): string {
  return ruta.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "").replace(/\\/g, "/");
}

function esDocumento(ROOT_: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((f) => {
      try {
        return statSync(f).isFile() && !esTemporalOffice(f.split(/[\\/]/).pop() ?? "");
      } catch {
        return false;
      }
    });
}

/** ¿La ruta parece pertenecer a un paquete de cliente? */
function pareceDeCliente(rel: string): boolean {
  const bajo = rel.toLowerCase();
  if (EXCLUIDAS_POR_RUTA.some((re) => re.test(bajo))) return false;
  return MARCADORES_CLIENTE.some((m) => bajo.includes(m));
}

/**
 * ¿Existe una fuente versionada (.md o .json) que respalde este entregable?
 * Se busca un .md homónimo y, para .docx, el nombre sin sufijo ni marca de versión.
 */
function tieneFuente(ruta: string): boolean {
  const sinExt = ruta.replace(/\.(docx|xlsx|pptx)$/i, "");
  const candidatos = [
    `${sinExt}.md`,
    `${sinExt}.json`,
    // el propio nombre de origen, con extensión .md
    `${ruta.replace(/\.docx$/i, ".md")}`,
    // sin marca de versión ni fecha: presupuesto-2026-10-v1.1 -> presupuesto
    `${sinSufijo(sinExt)}.md`,
    `${sinSufijo(sinExt)}.json`,
  ];
  return candidatos.some((c) => existsSync(c));
}

function main(): void {
  const args = process.argv.slice(2);
  const slugs =
    args.length > 0
      ? args
      : readdirSync(CLIENTS_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
          .map((d) => d.name);

  const hallazgos: Hallazgo[] = [];

  // ── 1. Artefactos de cliente fuera de docs/clientes/<slug>/ ──────────────────
  for (const zona of ZONAS_PROHIBIDAS) {
    const dir = join(ROOT, zona);
    for (const f of esDocumento(ROOT, dir)) {
      const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
      if (!ENTREGABLES.has(ext)) continue;
      const rutaRel = rel(f);
      if (!pareceDeCliente(rutaRel)) continue;
      hallazgos.push({
        regla: "NORM-CLIENTES-002",
        ruta: rutaRel,
        detalle:
          `artefacto de cliente (${ext}) fuera de docs/clientes/<slug>/ — debe vivir dentro del paquete del cliente`,
      });
    }
  }

  // ── 2. Entregables sin fuente versionada, y entregables fuera de su carpeta ──
  for (const slug of slugs) {
    const dir = join(CLIENTS_DIR, slug);
    const recorrer = (d: string): void => {
      const enRaizPaquete = d === dir;
      for (const f of esDocumento(ROOT, d)) {
        const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
        if (!ENTREGABLES.has(ext)) continue;
        const rutaRel = rel(f);
        if (EXCLUIDAS_POR_RUTA.some((re) => re.test(rutaRel.toLowerCase()))) continue;

        if (enRaizPaquete) {
          hallazgos.push({
            regla: "NORM-CLIENTES-002",
            ruta: rutaRel,
            detalle:
              `entregable ${ext} en la raiz del paquete — debe vivir en su carpeta numerada ` +
              `(01-propuesta/, 02-plan-de-trabajo/, 03-business-case/, 06-anexos/…)`,
          });
          continue;
        }
        if (!CARPETAS_ENTREGABLE.test(rutaRel.slice(rutaRel.indexOf("/") + 1))) {
          continue;
        }
        if (tieneFuente(f)) continue;
        hallazgos.push({
          regla: "NORM-CLIENTES-011",
          ruta: rutaRel,
          detalle: `entregable ${ext} sin fuente .md/.json versionada en el paquete — no se puede regenerar ni revisar`,
        });
      }
      for (const sub of existsSync(d) ? readdirSync(d) : []) {
        const p = join(d, sub);
        try {
          if (statSync(p).isDirectory()) recorrer(p);
        } catch {
          /* ignorar */
        }
      }
    };
    recorrer(dir);
  }

  console.log(`Auditoría de clientes (NORM-CLIENTES-002 / 011) · paquetes: ${slugs.length}`);
  if (hallazgos.length === 0) {
    console.log("OK — sin artefactos de cliente fuera de su paquete ni entregables sin fuente.");
    process.exit(0);
  }
  console.log(`REGRESIONES (${hallazgos.length}):`);
  for (const h of hallazgos) console.log(`  [${h.regla}] ${h.ruta}\n      ${h.detalle}`);
  process.exit(1);
}

main();