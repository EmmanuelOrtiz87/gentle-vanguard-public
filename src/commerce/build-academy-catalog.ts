import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const data = resolve(root, 'apps/academy-web/data');
const pricing = JSON.parse(readFileSync(resolve(data, 'store/pricing.json'), 'utf8'));
const products: Record<string, { slug: string; tier: string; title: string; price: number; currency: string }> = {};
for (const [kind, file] of [['courses', 'course.json'], ['ebooks', 'ebook.json'], ['toolkits', 'toolkit.json']]) {
  for (const dir of readdirSync(resolve(data, kind), { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === 'legacy') continue;
    const manifest = JSON.parse(readFileSync(resolve(data, kind, dir.name, file), 'utf8'));
    const tier = manifest.priceTier;
    const price = pricing.products[tier];
    if (manifest.salesStatus === 'reference-only' || price?.salesMode === 'quote' || !(price?.price > 0)) continue;
    products[`${tier}:${manifest.id}`] = { slug: manifest.id, tier, title: manifest.title, price: price.price, currency: pricing.currency };
  }
}
const revision = createHash('sha256').update(JSON.stringify(products)).digest('hex').slice(0, 16);
writeFileSync(resolve(root, 'src/mp-bridge/catalog.json'), JSON.stringify({ revision, products }, null, 2) + '\n');
console.log(`Checkout catalog: ${Object.keys(products).length} active paid products.`);
