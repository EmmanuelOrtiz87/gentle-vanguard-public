/** Public website boundary: two maintained sources, one static deployable app. */
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
export const PUBLIC_SITE = 'https://gentlevanguard.github.io/';
const extensions = new Set(['.html','.css','.js','.txt','.md','.webmanifest','.svg','.png','.webp','.woff2','.ico','.json','.pdf','.zip','.epub','.jpg','.jpeg','.mp4','.webm']);
const academyFiles = new Set(['index.html','catalog.json','catalog.css','catalog.js','offers.css','academy.css','academy.js','favicon.ico','favicon.svg','gv-fonts.css','gv-shell.css','gv-tokens.css','logo.svg','manifest.webmanifest','og-cover.png','og-cover.webp']);
const academyFolders = new Set(['covers','data','downloads','fonts','media']);

export function buildPublicSite(root: string, destination: string): void {
  const corporate = resolve(root,'apps/corporate-web/public');
  const academy = resolve(root,'apps/academy-landing');
  const academySource=readFileSync(join(academy,'index.html'),'utf8');
  if(!academySource.includes('href="gv-tokens.css"')||!academySource.includes('var(--gv-font-body)')) throw new Error('Academy generator must preserve canonical tokens and typography before publication');
  const target = resolve(destination);
  if ([corporate,academy,resolve(root)].includes(target)||[corporate,academy].some(source=>target.startsWith(source+sep))) throw new Error('Build must use a separate output directory');
  mkdirSync(target,{recursive:true});
  function copyTree(source:string,to:string) {
    for (const entry of readdirSync(source,{withFileTypes:true})) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) throw new Error('Unexpected public entry: '+entry.name);
      const from=join(source,entry.name), file=join(to,entry.name);
      if(entry.isDirectory()){mkdirSync(file,{recursive:true});copyTree(from,file);}
      else {
        if(!extensions.has(extname(entry.name))) throw new Error('Unexpected public extension: '+from);
        mkdirSync(dirname(file),{recursive:true});cpSync(from,file);
      }
    }
  }
  copyTree(corporate,target);
  mkdirSync(join(target,'academy'),{recursive:true});
  for (const entry of readdirSync(academy,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Symlink in Academy source');
    if(entry.isDirectory()&&academyFolders.has(entry.name))copyTree(join(academy,entry.name),join(target,'academy',entry.name));
    else if(entry.isFile()&&academyFiles.has(entry.name))cpSync(join(academy,entry.name),join(target,'academy',entry.name));
  }
  function metadata(file:string,url:string,image:string) {
    let html=readFileSync(file,'utf8').replace('content="noindex,nofollow"','content="index,follow"');
    html=html.replace(/\s*<link[^>]*rel="canonical"[^>]*>/g,'').replace(/\s*<meta[^>]*property="og:(?:url|image)"[^>]*>/g,'');
    html=html.replace(/(<meta name="twitter:image" content=")[^"]+/,`$1${image}`);
    html=html.replace('</head>',`<link rel="canonical" href="${url}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"></head>`);
    writeFileSync(file,html);
  }
  const index=join(target,'index.html');
  writeFileSync(index,readFileSync(index,'utf8').replaceAll('href="https://gentlevanguard.github.io/" target="_blank"','href="academy/"'));
  metadata(index,PUBLIC_SITE,PUBLIC_SITE+'assets/social-preview.png');
  // Academy campaign anchors from the former root keep their destination.
  const legacy=`<script>(()=>{function academyRoute(){if(/^#(?:sec-(?:destacados|cursos|manuales|micro|toolkits|gratis)|lead|charla-1)$/.test(location.hash))location.replace('/academy/'+location.search+location.hash)}academyRoute();addEventListener('hashchange',academyRoute)})();</script>`;
  writeFileSync(index,readFileSync(index,'utf8').replace('</head>',legacy+'</head>'));
  const academyIndex=join(target,'academy/index.html');
  const landing=readFileSync(academyIndex,'utf8');

  writeFileSync(academyIndex,landing);
  // Both public surfaces consume exactly one chrome stylesheet after local composition.
  cpSync(resolve(root,'src/web-presence/public-chrome.css'),join(target,'public-chrome.css'));
  for(const [file,surface,href] of [[index,'corporate','public-chrome.css'],[academyIndex,'academy','../public-chrome.css']]) {
    const html=readFileSync(file,'utf8').replace('<body ',`<body data-public-surface="${surface}" `).replace('</head>',`<link rel="stylesheet" href="${href}"></head>`);
    writeFileSync(file,html);
  }
  metadata(academyIndex,PUBLIC_SITE+'academy/',PUBLIC_SITE+'academy/og-cover.png');
  // Historical /academy-landing/ links converge on the same maintained page.
  mkdirSync(join(target,'academy-landing'),{recursive:true});
  writeFileSync(join(target,'academy-landing/index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${PUBLIC_SITE}academy/"><title>GentleVanguard Academy</title><script>location.replace('/academy/'+location.search+location.hash)</script><a href="/academy/">Ir a Academy</a></html>`);
  const manifest=join(target,'academy/manifest.webmanifest');
  const pwa=JSON.parse(readFileSync(manifest,'utf8'));
  Object.assign(pwa,{name:'GentleVanguard Academy',short_name:'GV Academy',id:'/academy/',start_url:'/academy/',scope:'/academy/'});
  writeFileSync(manifest,JSON.stringify(pwa,null,2)+'\n');
  writeFileSync(join(target,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${PUBLIC_SITE}sitemap.xml\n`);
  writeFileSync(join(target,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PUBLIC_SITE}</loc></url><url><loc>${PUBLIC_SITE}academy/</loc></url></urlset>\n`);
  writeFileSync(join(target,'.nojekyll'),'');
  writeFileSync(join(target,'README.md'),'# GentleVanguard\n\nWeb corporativa: '+PUBLIC_SITE+'\n\nAcademy: '+PUBLIC_SITE+'academy/\n\nUna publicación estática en GitHub Pages. Fuentes y generadores mantenidos en el workspace privado; este repositorio recibe sólo el export público revisado.\n');
}

export function publicFiles(destination:string):string[] {
  const paths:string[]=[];
  function visit(folder:string){for(const entry of readdirSync(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())visit(path);else paths.push(relative(destination,path).replaceAll('\\','/'));}}
  visit(destination);return paths.sort();
}
