import { readFileSync } from 'node:fs';
import { calculateQuote, validateEducationPackage } from './service.js';
const [command, path, ...options] = process.argv.slice(2);
if (!path || !['quote','validate'].includes(command)) {
  console.error('Uso: node --import tsx src/education/cli.ts quote|validate archivo.json [--draft]');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(readFileSync(path, 'utf8'));
    if (command === 'quote') console.log(JSON.stringify(calculateQuote(input), null, 2));
    else {
      const delivery = !options.includes('--draft');
      const errors = validateEducationPackage(input, delivery);
      console.log(JSON.stringify({ ok: !errors.length, mode: delivery ? 'delivery' : 'structure-only', errors, notice: 'El control estructural no verifica exactitud disciplinar ni maquetación.' }, null, 2));
      if(errors.length) process.exitCode=1;
    }
  } catch (error) { console.error(String(error)); process.exitCode=1; }
}
