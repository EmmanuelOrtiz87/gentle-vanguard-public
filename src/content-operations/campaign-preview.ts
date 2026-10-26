/** Branded campaign proofs. Offline rendering; no publishing, scheduling or approval changes. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { exportKit } from './export-kit.js';
import { validate, loadPlatformRegistry, type Job } from './engine.js';

const root=resolve(import.meta.dirname,'../..');
const campaignArg=process.argv.indexOf('--campaign-dir');
const campaignDir=campaignArg>=0 ? resolve(process.argv[campaignArg+1] || '') : join(root,'docs/marketing/campaigns/2026-10-gv-social-v2');
const dateArg=process.argv.indexOf('--date');
const campaignDate=dateArg>=0 ? process.argv[dateArg+1]! : new Intl.DateTimeFormat('en-CA',{timeZone:'America/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
assert.match(campaignDate,/^\d{4}-\d{2}-\d{2}$/,'Expected --date YYYY-MM-DD');
type Piece={id:string;category:string;title:string[];accentLine:number;body:string;art:string;cta:string;action:string;destination:string;alt:string;caption:string;storySticker:string};
const campaign=JSON.parse(readFileSync(join(campaignDir,'campaign.json'),'utf8')) as {id:string;pieces:Piece[]};
const output=join(campaignDir,`preview-${Date.now()}`);
mkdirSync(join(output,'assets'),{recursive:true});
const assets=join(root,'apps/corporate-web/public/assets');
cpSync(join(root,'packages/gv-design-system/dist/tokens.css'),join(output,'tokens.css'));
for(const name of ['gv-fonts.css','fonts','icon.svg','nexus-hero.webp','service-software.webp','service-automation.webp','service-ai.webp'])cpSync(join(assets,name),join(output,'assets',name),{recursive:true});
assert.equal(createHash('sha256').update(readFileSync(join(output,'assets/icon.svg'))).digest('hex'),createHash('sha256').update(readFileSync(join(root,'assets/brand/gentle-vanguard/v2/svg/icons/gv-transparent.svg'))).digest('hex'),'Official transparent icon must be byte-identical');
const escape=(text:string)=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
const arrow='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const css=`
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--gv-bg);color:var(--gv-text);font-family:var(--gv-font-body)}
.canvas{width:1080px;height:1350px;position:relative;overflow:hidden;isolation:isolate;background:var(--gv-bg)}
.canvas:before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 90% 55%,var(--gv-glow-purple),transparent 62%);z-index:-1}
.brand{position:absolute;left:76px;top:64px;display:flex;align-items:center;gap:16px;font:700 34px/1 var(--gv-font-display);letter-spacing:-.025em}
.brand img{width:60px;height:60px}.brand em{font-style:normal;background:var(--gv-gradient);background-clip:text;color:transparent}
.copy{position:absolute;left:76px;right:76px;top:180px;z-index:2}.category{font:500 26px/1.4 var(--gv-font-body);color:var(--gv-cyan-soft);margin:0 0 26px}
h1{font:700 83px/1.1 var(--gv-font-display);letter-spacing:-.035em;margin:0 0 28px;max-width:950px}h1 span{display:block}h1 .accent{color:var(--gv-purple-soft)}
.body{font:400 34px/1.5 var(--gv-font-body);max-width:850px;margin:0;color:var(--gv-text-secondary);text-wrap:pretty}
.art{position:absolute;left:100px;right:-120px;top:550px;height:630px;z-index:0;mask-image:linear-gradient(transparent,#000 14%,#000 82%,transparent)}
.art img{width:100%;height:100%;object-fit:contain}.presentacion .art{left:40px;right:-240px;top:490px;height:720px;mask-image:linear-gradient(transparent,#000 22%,#000 78%,transparent)}
.presentacion .art img{object-fit:cover;object-position:72% 50%}.presentacion h1{font-size:79px}
.footer{position:absolute;left:76px;right:76px;bottom:68px;z-index:3;padding-top:28px;border-top:1px solid var(--gv-border);background:linear-gradient(transparent,var(--gv-bg) 26%)}
.cta{font:700 32px/1.3 var(--gv-font-display);margin:0 0 14px;display:flex;align-items:center;justify-content:space-between;gap:20px}.cta svg{width:34px;height:34px;color:var(--gv-cyan-soft)}
.action{font:400 30px/1.4 var(--gv-font-body);margin:0;color:var(--gv-text-secondary)}
.academy-graphic{position:absolute;top:690px;left:76px;right:76px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start}
.resource{position:relative;min-height:310px;padding:30px 24px;border:1px solid var(--gv-border);border-radius:var(--gv-radius-lg);background:var(--gv-surface);transform:perspective(900px) rotateY(-12deg)}
.resource:nth-child(2){margin-top:42px;background:var(--gv-surface-raised)}.resource:nth-child(3){margin-top:84px}.resource svg{width:58px;height:58px;color:var(--gv-cyan-soft);margin-bottom:60px}.resource strong{font:700 29px/1.2 var(--gv-font-display);display:block}.resource span{display:block;color:var(--gv-text-secondary);font-size:21px;margin-top:16px}
.story{height:1920px}.story .brand{top:220px}.story .copy{top:352px}.story h1{font-size:91px}.story .body{font-size:34px;max-width:850px}.story .art{top:850px;height:650px;left:36px;right:-120px}.story.presentacion .art{top:800px;height:750px;left:20px;right:-220px}.story .footer{bottom:290px}.story .academy-graphic{top:1010px}.story .resource{min-height:330px}
`;
writeFileSync(join(output,'campaign.css'),css);
const assetsWritten:{path:string;sha256:string;width:number;height:number}[]=[];
const jobs:Job[]=[];
const browser=await chromium.launch();
try {
  for(const piece of campaign.pieces) {
    assert.match(piece.id,/^[a-z0-9-]+$/);
    assert.ok(piece.title.length<=3 && piece.body.length<=110,'Keep one idea and brief supporting copy');
    assert.ok(['https://eortiz148700.github.io','https://gentlevanguard.github.io'].includes(new URL(piece.destination).origin));
    for(const format of ['feed','story'] as const) {
      const filename=`${piece.id}-${format}`;
      const height=format==='feed'?1350:1920;
      const graphic=piece.art==='academy'?`<div class="academy-graphic" aria-hidden="true">${[['Cursos','Aprendé'],['Ebooks','Profundizá'],['Toolkits','Practicá']].map(([label,detail],i)=>`<div class="resource"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2"><path d="${['M14 14h30v38H14zM22 24h14M22 32h14M22 40h8','M12 16h18v36H12zM30 16h22v36H30M19 24h5M37 24h8','M12 22h40v30H12zM22 22V12h20v10M12 34h40M28 30h8v8h-8z'][i]}"/></svg><strong>${label}</strong><span>${detail}</span></div>`).join('')}</div>`:`<div class="art" aria-hidden="true"><img src="assets/${piece.art}" alt=""></div>`;
      const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${escape(piece.category)} · GentleVanguard</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="assets/gv-fonts.css"><link rel="stylesheet" href="campaign.css"></head><body><main class="canvas ${piece.id} ${format}"><div class="brand"><img src="assets/icon.svg" alt=""><span>Gentle<em>Vanguard</em></span></div>${graphic}<div class="copy"><p class="category">${escape(piece.category)}</p><h1>${piece.title.map((line,i)=>`<span class="${i===piece.accentLine?'accent':''}">${escape(line)}</span>`).join('')}</h1><p class="body">${escape(piece.body)}</p></div><div class="footer"><p class="cta">${escape(piece.cta)}${arrow}</p><p class="action">${escape(piece.action)}</p></div></main></body></html>`;
      const htmlPath=join(output,`${filename}.html`);
      writeFileSync(htmlPath,html);
      const page=await browser.newPage({viewport:{width:1080,height},deviceScaleFactor:1});
      const errors:string[]=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(img=>img.decode()));});
      assert.deepEqual(errors,[]);
      const layout=await page.evaluate(()=>{
        const canvas=document.querySelector('.canvas')!.getBoundingClientRect();
        const copy=document.querySelector('.copy')!.getBoundingClientRect();
        const footer=document.querySelector('.footer')!.getBoundingClientRect();
        return {overflow:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,titleFits:Array.from(document.querySelectorAll('h1 span')).every(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)*1.1),copyBottom:copy.bottom,footerTop:footer.top,brandTop:document.querySelector('.brand')!.getBoundingClientRect().top,footerBottom:footer.bottom,canvasBottom:canvas.bottom,poppins:document.fonts.check('700 83px Poppins'),inter:document.fonts.check('400 30px Inter')};
      });
      assert.ok(!layout.overflow && layout.titleFits && layout.copyBottom<layout.footerTop && layout.poppins && layout.inter,`${filename}: containment/fonts ${JSON.stringify(layout)}`);
      if(format==='story')assert.ok(layout.brandTop>=200 && layout.footerBottom<=1650,'Story critical content respects working safe zone');
      const pngPath=join(output,`${filename}.png`);
      await page.screenshot({path:pngPath});
      assetsWritten.push({path:`${filename}.png`,sha256:createHash('sha256').update(readFileSync(pngPath)).digest('hex'),width:1080,height});
      const link=new URL(piece.destination);link.searchParams.set('utm_source','instagram');link.searchParams.set('utm_medium','organic_social');link.searchParams.set('utm_campaign',campaign.id);link.searchParams.set('utm_content',filename.replaceAll('-','_'));
      const job:Job={id:`${campaign.id}_${filename}`,date:campaignDate,timezone:'America/Buenos_Aires',platform:'instagram',campaign:campaign.id,theme:piece.category,contentType:format==='feed'?'image':'story',title:piece.title.join(' '),copy:piece.caption,cta:link.href,asset:relative(root,pngPath).replaceAll('\\','/'),status:'DRAFT',approvalRequired:true};
      assert.deepEqual(validate(job,loadPlatformRegistry(root)),[]);
      jobs.push(job);
      await page.close();
    }
  }
  const board=`<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="assets/gv-fonts.css"><style>*{box-sizing:border-box}body{margin:0;padding:44px;width:1440px;background:var(--gv-bg);color:var(--gv-text);font:400 20px Inter}h1{font:700 32px Poppins;margin:0 0 8px}p{color:var(--gv-text-secondary);margin:0 0 32px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px 24px}figure{margin:0}img{display:block;width:100%}figcaption{padding-top:12px;font-size:20px}</style><h1>GentleVanguard · Propuesta de campaña</h1><p>Cinco mensajes independientes. Una misma identidad.</p><div class="grid">${campaign.pieces.map((p,i)=>`<figure><img src="${p.id}-feed.png" alt="${escape(p.alt)}"><figcaption>${i+1}. ${escape(p.category)}</figcaption></figure>`).join('')}</div></html>`;
  writeFileSync(join(output,'board.html'),board);
  const boardPage=await browser.newPage({viewport:{width:1440,height:1500}});
  await boardPage.goto(pathToFileURL(join(output,'board.html')).href);
  await boardPage.evaluate(()=>document.fonts.ready);
  await boardPage.screenshot({path:join(output,'propuestas.png'),fullPage:true});
  await boardPage.close();
} finally {await browser.close();}
writeFileSync(join(output,'jobs-review.json'),JSON.stringify(jobs,null,2));
writeFileSync(join(output,'inventory.json'),JSON.stringify({campaign:campaign.id,status:'REVIEW',publications:0,assets:assetsWritten},null,2));
const captions=campaign.pieces.map(piece=>`## ${piece.category}\n\n${piece.caption}\n\n### Enlaces\n\n${jobs.filter(j=>j.theme===piece.category).map(j=>`${j.contentType}: ${j.cta}`).join('\n')}\n\nHistoria: agregar sticker «${piece.storySticker}» con el enlace de story.\n\nTexto alternativo: ${piece.alt}\n`).join('\n');
writeFileSync(join(output,'textos-y-enlaces.md'),`# Propuesta de campaña · GentleVanguard\n\nEstado: REVIEW. No publicada ni programada. La fecha de jobs es de preparación, no un compromiso de publicación. Los enlaces de un PNG no son clicables. En Instagram, usar enlace del perfil/sticker; en LinkedIn/Facebook, agregar el enlace al texto. Los UTM de Academy no acreditan seguimiento: su destino es otro sitio y se debe medir por separado.\n\n${captions}`);
writeFileSync(join(output,'index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GentleVanguard · Revisión de campaña</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="assets/gv-fonts.css"><style>body{margin:0;background:var(--gv-bg);color:var(--gv-text);font:400 16px Inter;padding:32px}main{max-width:1100px;margin:auto}h1,h2{font-family:Poppins}p{line-height:1.7;color:var(--gv-text-secondary)}a{color:var(--gv-cyan-soft);padding-block:12px;display:inline-block}img{max-width:100%;height:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}figure{margin:0}section{padding-block:32px;border-top:1px solid var(--gv-border)}@media(max-width:650px){.pair{grid-template-columns:1fr}}a:focus-visible{outline:2px solid var(--gv-cyan)}</style><main><h1>GentleVanguard · Propuesta de campaña</h1><p>Cinco temas independientes. Revisá mensaje, estilo y llamada a la acción. Estas piezas están preparadas para aprobación; no se publicaron en redes.</p><p><a href="textos-y-enlaces.md">Textos, enlaces y descripciones accesibles</a></p>${campaign.pieces.map(p=>`<section><h2>${escape(p.category)}</h2><p>${escape(p.caption)}</p><div class="pair">${['feed','story'].map(f=>`<figure><a href="${p.id}-${f}.png" download>Descargar ${f==='feed'?'feed · 1080×1350':'historia · 1080×1920'}</a><img src="${p.id}-${f}.png" alt="${escape(p.alt)}" loading="lazy"></figure>`).join('')}</div></section>`).join('')}</main></html>`);
cpSync(join(campaignDir,'README.md'),join(output,'LEEME.md'));
cpSync(join(campaignDir,'campaign.json'),join(output,'campaign.json'));
const zip=exportKit({root:output,outputDir:resolve(output,'..'),items:['assets','tokens.css','campaign.css','index.html','board.html','propuestas.png','textos-y-enlaces.md','inventory.json','jobs-review.json','LEEME.md','campaign.json',...campaign.pieces.flatMap(p=>['feed','story'].flatMap(f=>[`${p.id}-${f}.png`,`${p.id}-${f}.html`]))]});
console.log(JSON.stringify({output,zip,assets:assetsWritten.length,jobs:jobs.length,status:'REVIEW',published:0},null,2));
