import type {BrowserContext} from 'playwright';
/** QA may read its target, but cannot create payments, contacts or analytics events. */
export async function readOnlyQA(context:BrowserContext,base:string):Promise<void>{
 const origin=new URL(base).origin;
 await context.route('**/*',route=>{
  const request=route.request();
  return new URL(request.url()).origin===origin&&['GET','HEAD'].includes(request.method())
   ?route.continue():route.fulfill({status:204});
 });
}
