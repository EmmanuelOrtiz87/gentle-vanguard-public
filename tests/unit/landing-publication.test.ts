import {describe, it, expect} from 'vitest';
import {publicProducts} from '../../apps/academy-web/scripts/landing-publication.mjs';

const products = [{id:'paid'}, {id:'unrelated-free', type:'free'}, {id:'talk-gift', talk:'charla-1'}];
describe('talk publication switch', () => {
  it('withholds talk gifts by default without hiding other products', () => {
    for (const settings of [{}, {talkResourcesEnabled:false}, {talkResourcesEnabled:'true'}]) {
      expect(publicProducts(products, settings).map(p=>p.id)).toEqual(['paid','unrelated-free']);
    }
  });
  it('restores the original gift when explicitly enabled', () => {
    expect(publicProducts(products, {talkResourcesEnabled:true})).toEqual(products);
  });
});
