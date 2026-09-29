/**
 * docs-consistency.ts — Verificador de consistencia de documentación de clientes.
 *
 * Valida que los documentos comerciales de un proyecto cliente sean consistentes
 * entre sí: versiones, hitos (suma 100%), montos (USD cuadran con el total),
 * opción de propiedad intelectual (+40%) y ausencia de referencias a "open source"
 * en el contrato (modelo de paquete cerrado GV).
 *
 * Uso:
 *   npx tsx src/ops/docs-consistency.ts <cliente-slug>     # un cliente
 *   npx tsx src/ops/docs-consistency.ts --all              # todos los clientes
 *
 * Exit code: 0 = consistente, 1 = inconsistencias encontradas.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CLIENTS_DIR = join(ROOT, "docs/clientes");

interface Milestone {
  percent?: number;
  usd?: number;
  name?: string;
}

interface CheckResult {
  ok: boolean;
  messages: string[];
}

function check(ok: boolean, msg: string, res: CheckResult): void {
  res.messages.push(`${ok ? "OK  " : "FAIL"} ${msg}`);
  if (!ok) res.ok = false;
}

function readJson(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readMd(p: string): string | null {
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

function checkClient(slug: string): CheckResult {
  const res: CheckResult = { ok: true, messages: [] };
  const dir = join(CLIENTS_DIR, slug);
  res.messages.push(`\n=== ${slug} ===`);

  // ── 1. Contrato ────────────────────────────────────────────────────────────
  const contrato = readMd(join(dir, "06-anexos/contrato-servicios.md"));
  if (contrato) {
    check(/cláusula 8\.3|clausula 8\.3/.test(contrato), "contrato: cláusula 8.3 (opción de compra PI) presente", res);
    check(/cláusula 8\.2|clausula 8\.2/.test(contrato), "contrato: cláusula 8.2 (licencia de uso) presente", res);
    check(/40 %|40%/.test(contrato), "contrato: adicional 40% mencionado", res);
    check(!/open source|Open Source|open-source/i.test(contrato), "contrato: NO menciona 'open source'", res);
    check(/Anexo VI|Anexo V/.test(contrato), "contrato: anexo de entregables presente", res);
    check(/paquete cerrado/.test(contrato), "contrato: 'paquete cerrado' presente", res);
    check(/100 % adelantad|100% adelantad/.test(contrato), "contrato: pagos 100% adelantados presentes", res);
    check(/no comenzará las actividades|no comenzara las actividades/.test(contrato), "contrato: no inicia etapa sin pago acreditado", res);
    check(/retenciones aplicadas por el Cliente se consideran parte del pago/.test(contrato), "contrato: retenciones cuentan como pago del hito", res);
    check(!/Plazo de pago: hasta 5 dias|5 dias habiles desde la aceptacion/.test(contrato), "contrato: sin plazo de pago post-aceptación (modelo viejo)", res);
    const v = contrato.match(/Versión:\s*([\d.]+)/);
    if (v) res.messages.push(`INFO contrato versión: ${v[1]}`);
  } else {
    check(false, "contrato: 06-anexos/contrato-servicios.md no encontrado", res);
  }

  // ── 2. Propuesta ───────────────────────────────────────────────────────────
  const propuesta = readMd(join(dir, "01-propuesta/propuesta-proyecto.md"));
  if (propuesta) {
    check(/14\.5/.test(propuesta), "propuesta: sección 14.5 (PI y entregables) presente", res);
    check(/40 %|40%/.test(propuesta), "propuesta: adicional 40% mencionado", res);
    check(/código fuente no forma parte|codigo fuente no forma parte/.test(propuesta), "propuesta: código fuente excluido del paquete estándar", res);
  } else {
    check(false, "propuesta: 01-propuesta/propuesta-proyecto.md no encontrado", res);
  }

  // ── 3. Plan de trabajo ─────────────────────────────────────────────────────
  const plan = readMd(join(dir, "02-plan-de-trabajo/plan-de-trabajo.md"));
  if (plan) {
    check(/compra de propiedad intelectual|opción de compra|opcion de compra/.test(plan), "plan: opción de PI mencionada en F6", res);
    check(!/Pago inicial \(30|apertura del repositorio|GitHub del cliente/.test(plan), "plan: sin restos del modelo viejo (30% / apertura repo / GitHub cliente)", res);
  }

  // ── 4. Pitch (JSON) ────────────────────────────────────────────────────────
  const pitch = readJson(join(dir, "07-pitch/pitch-cliente-data.json"));
  if (pitch) {
    const ms = (pitch.milestones as Milestone[]) || [];
    const pctSum = ms.reduce((a, m) => a + (m.percent || 0), 0);
    const usdSum = ms.reduce((a, m) => a + (m.usd || 0), 0);
    const fixed = (pitch.cost_summary as { fixed_price_usd?: number })?.fixed_price_usd;
    const pi = (pitch.cost_summary as { pi_option_usd?: number })?.pi_option_usd;
    const totalPi = (pitch.cost_summary as { total_with_pi_usd?: number })?.total_with_pi_usd;
    check(pctSum === 100, `pitch: hitos suman ${pctSum}% (debe ser 100)`, res);
    if (fixed) check(usdSum === fixed, `pitch: hitos USD ${usdSum} === fixed ${fixed}`, res);
    if (fixed && pi !== null && pi !== undefined) check(pi === Math.round(fixed * 0.4), `pitch: pi_option_usd ${pi} === 40% de ${fixed}`, res);
    if (fixed && pi !== null && pi !== undefined && totalPi !== null && totalPi !== undefined) check(totalPi === fixed + pi, `pitch: total_with_pi ${totalPi} === ${fixed}+${pi}`, res);
  } else {
    check(false, "pitch: 07-pitch/pitch-cliente-data.json no encontrado", res);
  }

  // ── 5. Kickoff (JSON) ──────────────────────────────────────────────────────
  const kickoff = readJson(join(dir, "08-kickoff/kickoff-data.json"));
  if (kickoff) {
    const ms = (kickoff.milestones as Milestone[]) || [];
    const pctSum = ms.reduce((a, m) => a + (m.percent || 0), 0);
    const usdSum = ms.reduce((a, m) => a + (m.usd || 0), 0);
    check(pctSum === 100, `kickoff: hitos suman ${pctSum}% (debe ser 100)`, res);
    check(usdSum === 1000, `kickoff: hitos USD ${usdSum} === 1000`, res);
  }

  return res;
}

function main(): void {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const slug = args.find((a) => !a.startsWith("--"));

  let slugs: string[];
  if (all) {
    slugs = readdirSync(CLIENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name);
  } else if (slug) {
    slugs = [slug];
  } else {
    console.error("Uso: npx tsx src/ops/docs-consistency.ts <cliente-slug> | --all");
    process.exit(2);
  }

  let allOk = true;
  for (const s of slugs) {
    const r = checkClient(s);
    for (const m of r.messages) console.log(m);
    if (!r.ok) allOk = false;
  }

  console.log(allOk ? "\nTODO CONSISTENTE" : "\nHAY INCONSISTENCIAS");
  process.exit(allOk ? 0 : 1);
}

main();