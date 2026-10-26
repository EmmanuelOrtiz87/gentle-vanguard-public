/** Qualify a native helper's declared result independently of its process exit. */
export function nativeResultFailure(stdout: string): string | undefined {
  const marker = [...stdout.matchAll(/^=== JSON OUTPUT ===\r?$/gm)].at(-1);
  if (!marker) return undefined; // Legacy helpers without a structured envelope.
  try {
    const result = JSON.parse(stdout.slice(marker.index! + marker[0].length).trim()) as {
      success?: boolean;
      phaseComplete?: boolean;
      implementationPerformed?: boolean;
    };
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return 'Native helper emitted an invalid result envelope';
    }
    for (const value of [result.success, result.phaseComplete, result.implementationPerformed]) {
      if (value !== undefined && typeof value !== 'boolean')
        return 'Native helper emitted an invalid result envelope';
    }
    if (result.phaseComplete === false || result.implementationPerformed === false) {
      return 'Native helper prepared a template/plan; phase execution requires the active host agent';
    }
    if (result.success === false) return 'Native helper reported unsuccessful execution';
  } catch {
    return 'Native helper emitted malformed structured output';
  }
  return undefined;
}
