import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('apps/academy-web/scripts/build-landing.mjs','utf8');
const postLead=source.slice(source.indexOf('function postLead(lead)'),source.indexOf('function savedContactPrefill()'));
function submit(hostname:string,enabled:boolean){
 const requests:unknown[]=[],events:unknown[]=[];
 const context={LOCAL_CRM_ENABLED:enabled,location:{hostname},fetch:(...args:unknown[])=>{requests.push(args);return Promise.resolve({ok:true});},track:(_name:string,data:unknown)=>events.push(data)};
 runInNewContext(postLead+';postLead({name:"QA",email:"qa@example.invalid",audience:"personas",interest:"Curso",origin:"checkout"})',context);
 return {requests,events};
}
describe('public contact boundary',()=>{
 it('disables remote metrics by default and permits an explicitly empty payment bridge',()=>{
  const setting=(name:string,env:Record<string,string>)=>runInNewContext(source.match(new RegExp('const '+name+' = ([^;]+);'))![1],{process:{env}});
  expect(setting('TRACK_URL',{})).toBe('');
  expect(setting('MP_BRIDGE_URL',{MP_BRIDGE_URL:''})).toBe('');
 });
 it('never posts from the public site to a visitor local CRM, even if local integration is enabled',()=>{
  expect(submit('gentlevanguard.github.io',true).requests).toEqual([]);
 });
 it('requires explicit opt-in on loopback and omits name/email from metrics',()=>{
  expect(submit('127.0.0.1',false).requests).toEqual([]);
  const local=submit('127.0.0.1',true);expect(local.requests).toHaveLength(1);
  expect(JSON.stringify(local.events)).not.toContain('qa@example.invalid');
 });
});
