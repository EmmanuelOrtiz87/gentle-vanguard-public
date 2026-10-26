import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncProviderModels} from '../../src/tools/model-catalog-sync.js';

test('materializes authenticated custom provider models for the OpenCode selector', () => {
  for (const provider of [{}, {models:{}}]) {
    syncProviderModels(provider, {catalogOK:true, upstreamCatalog:['big-pickle']}, true);
    assert.deepEqual(provider.models, {'big-pickle':{name:'big-pickle'}});
  }
});
test('preserves configured models when the upstream catalog cannot be authenticated', () => {
  const provider={models:{existing:{name:'Existing',limit:{context:1000}}}};
  syncProviderModels(provider,{catalogOK:false,upstreamCatalog:[]},true);
  assert.equal(provider.models.existing.limit.context,1000);
});
test('keeps model metadata while adding verified models and removing retired entries', () => {
  const provider={models:{existing:{name:'Existing'},retired:{name:'Retired'}}};
  const result=syncProviderModels(provider,{catalogOK:true,upstreamCatalog:['existing','new']},true);
  assert.deepEqual(provider.models,{existing:{name:'Existing'},new:{name:'new'}});
  assert.deepEqual(result,{removed:1,added:1});
});
