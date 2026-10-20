import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProducts } from '../../apps/academy-crm/src/catalog.js';
test('CRM uses canonical prices and quote-only services without losing custom products',()=>{
 const saved=[{id:'course-mentor',name:'Old offer',price:100,currency:'USD',active:true},{id:'custom-1',name:'Trabajo acordado',price:73,currency:'USD',active:true}];
 const effective=reconcileProducts(saved);
 assert.equal(effective.find(p=>p.id==='course-mentor')?.price,null);
 assert.equal(effective.find(p=>p.id==='pack-agencia')?.price,320);
 assert.equal(effective.find(p=>p.id==='custom-1')?.price,73);
 assert.equal(saved[0].price,100,'raw saved data is preserved');
});
