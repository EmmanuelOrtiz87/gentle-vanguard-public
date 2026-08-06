import FormatAdapter from '../../FormatAdapter.js';
import { convertToWindsurf } from '../../index.js';

class WindsurfAdapter extends FormatAdapter {
  constructor() {
    super('windsurf');
  }

  init(): void {}

  shutdown(): void {}

  convert(skillPath: string, output: string): void {
    convertToWindsurf(skillPath, output);
  }
}

export default new WindsurfAdapter();