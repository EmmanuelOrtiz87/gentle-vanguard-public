/** Qualify a native helper's declared result independently of its process exit. */
export interface NativeResultEnvelope {
  success?: boolean;
  phaseComplete?: boolean;
  implementationPerformed?: boolean;
  executionKind?: string;
  llmCalled?: boolean;
}

export interface ParsedNativeResult {
  envelope?: NativeResultEnvelope;
  error?: string;
}

export function parseNativeResult(stdout: string): ParsedNativeResult {
  const marker = [...stdout.matchAll(/^=== JSON OUTPUT ===\r?$/gm)].at(-1);
  if (!marker) return {}; // Legacy helpers without a structured envelope.
  let result: unknown;
  try {
    result = JSON.parse(stdout.slice(marker.index! + marker[0].length).trim());
  } catch {
    return { error: 'Native helper emitted malformed structured output' };
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { error: 'Native helper emitted an invalid result envelope' };
  }
  const envelope = result as NativeResultEnvelope;
  for (const value of [
    envelope.success,
    envelope.phaseComplete,
    envelope.implementationPerformed,
  ]) {
    if (value !== undefined && typeof value !== 'boolean') {
      return { error: 'Native helper emitted an invalid result envelope' };
    }
  }
  return { envelope };
}

export function nativeResultFailure(stdout: string): string | undefined {
  const { envelope, error } = parseNativeResult(stdout);
  if (error) return error;
  if (!envelope) return undefined;
  if (envelope.phaseComplete === false || envelope.implementationPerformed === false) {
    return 'Native helper prepared a template/plan; phase execution requires the active host agent';
  }
  if (envelope.success === false) return 'Native helper reported unsuccessful execution';
  return undefined;
}
