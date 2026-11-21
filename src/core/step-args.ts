/**
 * Tokenizer for `pipeline.steps[].args` — no shell is involved, so we only
 * split on whitespace while keeping quoted segments together. Supports single
 * quotes, double quotes and `\"` escapes inside double quotes: the autostart
 * config passes inline JSON as `--json-string '{"test":"ok"}'`, which must
 * reach the validator intact.
 *
 * Pure and linear-time (no nested quantifiers → no ReDoS).
 */
export function parseStepArgs(args?: string): string[] {
  if (!args?.trim()) return [];
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(["\\])/g, '$1'));
    else out.push(m[2] ?? m[3] ?? '');
  }
  return out;
}
