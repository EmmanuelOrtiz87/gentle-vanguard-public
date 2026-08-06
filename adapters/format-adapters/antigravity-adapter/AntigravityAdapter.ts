import FormatAdapter from '../../FormatAdapter.js';
import { convertToAntigravity } from '../../index.js';

class AntigravityAdapter extends FormatAdapter {
  constructor() {
    super('antigravity');
  }

  init(): void {}
  shutdown(): void {}

  convert(skillPath: string, output: string): void {
    convertToAntigravity(skillPath, output);
  }
}

export default new AntigravityAdapter();