import {describe,it,expect} from 'vitest';
import {catalogText,catalogExcerpt,catalogCard} from '../../apps/academy-web/scripts/catalog-card.mjs';
describe('public catalog presentation',()=>{
  it('uses the official company spelling in the public presentation',()=>{
    const html=catalogCard({title:'Gentle-Vanguard',description:'El stack de Gentle Vanguard.',cover:'cover.svg',badge:'CURSO',meta:'',price:'USD 50',actions:''});
    expect(html).toContain('<h3>GentleVanguard</h3>');
    expect(html).not.toMatch(/Gentle[ -]Vanguard/);
  });
  it('normalizes real and serialized line breaks without losing words',()=>{
    expect(catalogText('  Software\n\n a   medida\\n con IA  ')).toBe('Software a medida con IA');
  });
  it('keeps the full escaped description and price while giving a bounded readable preview',()=>{
    const full='Aprender a conectar herramientas & procesos de trabajo. '.repeat(12);
    const html=catalogCard({title:'Curso <avanzado>',description:full,cover:'covers/test.svg',badge:'CURSO',meta:'20 h',price:'USD 50',actions:'<a href="#lead">Comprar</a>'});
    expect(catalogExcerpt(full).length).toBeLessThanOrEqual(157);
    expect(html).toContain('Curso &lt;avanzado&gt;');
    expect(html).toContain(catalogText(full).replaceAll('&','&amp;'));
    expect(html).toContain('<strong>USD 50</strong>');
    expect(html).toContain('<details class="product-details">');
  });
});
