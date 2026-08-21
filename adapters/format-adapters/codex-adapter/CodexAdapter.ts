import FormatAdapter from '../../FormatAdapter.js';
import { convertToCodex } from '../../index.js';

class CodexAdapter extends FormatAdapter {
  constructor() {
    super('codex');
  }

  init(): void {
    // adapter-specific init if needed
  }

  shutdown(): void {
    // cleanup if needed
  }

  convert(skillPath: string, output: string): void {
    convertToCodex(skillPath, output);
  }
}

export default new CodexAdapter();
