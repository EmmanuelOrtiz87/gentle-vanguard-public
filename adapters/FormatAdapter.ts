import Adapter, { AdapterOptions } from './Adapter.js';
import { convertToAntigravity, convertToCodex, convertToWindsurf } from './index.js';

export type AdapterTool = 'antigravity' | 'codex' | 'windsurf';

/**
 * Base class for format adapters.
 *
 * Each concrete adapter converts a Gentle-Vanguard SKILL.md into the native
 * format of its target tool. Subclasses implement `convert(skillPath, output)`
 * using the tool-specific converter from `./index.js` so every adapter is
 * self-contained, testable, and follows the single-responsibility principle.
 */
export class FormatAdapter extends Adapter {
  constructor(name: string) {
    super(name);
  }

  init(_options?: AdapterOptions): void {
    // no-op for format adapters
  }

  shutdown(): void {
    // no-op
  }

  /**
   * Convert a SKILL.md into this adapter's tool format.
   * Must be implemented by concrete adapters.
   */
  convert(_skillPath: string, _output: string): void {
    throw new Error(`convert() must be implemented by the "${this.name}" adapter`);
  }

  /**
   * Dispatch helper — used by the unified CLI in `./index.ts`.
   * Converts using the converter matching `tool`.
   */
  convertFor(tool: AdapterTool, skillPath: string, output: string): void {
    switch (tool) {
      case 'antigravity':
        convertToAntigravity(skillPath, output);
        break;
      case 'codex':
        convertToCodex(skillPath, output);
        break;
      case 'windsurf':
        convertToWindsurf(skillPath, output);
        break;
      default:
        throw new Error(`Unsupported tool: ${String(tool)}`);
    }
  }
}

export default FormatAdapter;
