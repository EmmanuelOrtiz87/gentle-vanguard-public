import { presentationShell } from './presentation-shell.js';
/** Editorial register for all presentation pages. Facts come from the native inventory, never estimates. */
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..');const dir=join(root,'docs/presentations');const check=process.argv.includes('--check');
const facts=JSON.parse(readFileSync(join(root,'docs/generated/stack-facts.json'),'utf8'));
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
if(facts.packageVersion!==version)throw new Error('Run stack:facts before reconciling presentation content');
const sources:Record<string,[string,string[]]>={
  'agents-pipeline.html':['Agentes y pipeline',['.opencode/agents','config/subagent-mapping.json']],
  'architecture.html':['Arquitectura',['docs/stack-manual-modules.md','docs/stack-manual-full.md']],
  'autonomy.html':['Autonomía con verificaciones',['docs/architecture/universal-quality-gate.md','config/universal-quality-gate.json']],
  'case-study-before-after.html':['Método comparativo; sin resultados comerciales acreditados',['docs/status/PRESENCIA-PUBLICA-Y-DISENO.md']],
  'commands.html':['Comandos según el workspace',['package.json','src/cli/gv.ts']],
  'contract-viewer.html':['Visor documental; exportación PDF simulada en esta página',['config/sdd-framework-mapping.json','src/sdd/check-sdd-gate.ts']],
  'dashboard.html':['Observabilidad local',['apps/web-dashboard/README.md','docs/dashboard/README.md']],
  'glossary.html':['Referencia de términos',['docs/stack-manual-modules.md']],
  'health.html':['Salud: resultados sólo al ejecutar los checks',['docs/stack-manual-modules.md','package.json']],
  'image-studio.html':['Herramienta gráfica documental local; distinta de Content Studio',['apps/content-cms/README.md']],
  'index.html':['Índice técnico del stack',['README.md','docs/status/CANONICAL-STATUS.md']],
  'knowledge-systems.html':['Sistemas de conocimiento',['docs/stack-manual-modules.md']],
  'marketing.html':['Estrategia vigente y antecedentes sin validar',['.agents/product-marketing.md','docs/marketing/README.md']],
  'md-viewer.html':['Visor local de documentación',['docs/README.md']],
  'memory-knowledge.html':['Memoria y datos; respetar identidad de sesión',['skills/engram-memory/SKILL.md','docs/generated/STACK-FACTS.md']],
  'operations-cloud.html':['LOCAL-FIRST; promoción externa opcional',['docs/status/CANONICAL-STATUS.md','docs/OPERATIONS.md']],
  'patterns-conventions.html':['Canon y comportamiento vigentes',['docs/brand/BRAND-KIT.md','docs/design/07-motion-ux-standard.md']],
  'public-presence.html':['Estado generado de presencia pública',['docs/status/PRESENCIA-PUBLICA-Y-DISENO.md']],
  'quickstart.html':['Inicio y operación',['GETTING-STARTED.md','package.json']],
  'resources-index.html':['Referencia documental de recursos; el CMS operativo es otra app',['apps/content-cms/README.md']],
  'security-governance.html':['Seguridad y alcance local',['docs/status/CANONICAL-STATUS.md','docs/architecture/universal-quality-gate.md']],
  'social-post.html':['Composición local de posts; no publica ni aprueba campañas',['apps/content-cms/README.md','docs/operations/CONTENT-OPERATIONS-ENGINE.md']],
  'study-material.html':['Material de estudio; verificar comandos en su app',['docs/README.md','package.json']],
  'v4-features.html':['Referencia de evolución v4; consultar capacidades actuales',['docs/status/CANONICAL-STATUS.md','docs/stack-manual-modules.md']],
  'video-studio.html':['Herramienta documental; video operativo en Content Studio',['apps/content-cms/README.md','apps/content-cms/server/shorts/README.md']],
};
const pages=readdirSync(dir).filter(n=>n.endsWith('.html')).sort();
let drift=false;
function save(path:string,text:string){if(readFileSync(path,'utf8')===text)return;if(check){console.error('DRIFT '+path);drift=true;}else writeFileSync(path,text);}
const register=[];
for(const name of pages){
  const entry=sources[name];if(!entry)throw new Error('Presentation missing editorial classification: '+name);
  for(const source of entry[1])if(!existsSync(join(root,source)))throw new Error('Missing editorial source: '+source);
  let html=readFileSync(join(dir,name),'utf8');
  if(name==='marketing.html'&&!html.includes('GV-HISTORICAL-MARKETING:START')){
    const start=html.indexOf('<header class="hero"');const end=html.indexOf('<footer',start);if(start<0||end<0)throw new Error('Marketing archive anchors missing');
    const old=html.slice(start,end).replace(/<!-- GV-PRESENCE:START -->[\s\S]*?<!-- GV-PRESENCE:END -->/,'');
    html=html.slice(0,start)+`<!-- GV-HISTORICAL-MARKETING:START --><details class="section-card" id="historical-marketing" style="margin:24px auto;max-width:1180px;padding:24px"><summary>Antecedentes de marketing: hipótesis y prototipos sin validación comercial</summary><p>Las cifras de ROI, tiempos, precios y ofertas siguientes son propuestas históricas, no resultados medidos ni servicios aprobados para vender. La estrategia vigente está en la ficha de estado y el README de marketing.</p>${old}</details><!-- GV-HISTORICAL-MARKETING:END -->\n`+html.slice(end);
  }
  if(name!=='public-presence.html'){
    html=html.replace(/<head>[\s\S]*?<\/head>/,head=>head.replaceAll('Gentle-Vanguard','GentleVanguard').replaceAll('#0F1115','#0B1020'));
    html=html.replace(/<header class="gv-topbar">[\s\S]*?<\/header>/,header=>header.replaceAll('Gentle-Vanguard','GentleVanguard').replace(/(<img[^>]*class="gv-brand-logo"[^>]*src=")[^"]+/, '$1assets/canon/icon.svg'));
    html=presentationShell(html,root);
    html=html.replace(/<footer\b[\s\S]*?<\/footer>/g,footer=>footer.replaceAll('Gentle-Vanguard','GentleVanguard').replace('100% Autonomous AI Stack','Documentación técnica').replace(/\d+\/\d+ Health/g,'Health · ejecutar checks').replace(/\d+ Test files/g,'Tests · ejecutar suite').replace(/\d+ TS Files/g,'Código TypeScript · ver fuentes').replace(/\d+ Repos/g,'Workspace privado').replace(/\d+ Normatives/g,'Normativas · ver fuentes').replace(/\d+ Skills/g,`${facts.skills.indexed} skills indexadas`).replace(/v\d+\.\d+\.\d+|v\d+\.\d+/g,`v${version}`));
    html=html.replace(/>92 Skills</g,`>${facts.skills.indexed} skills indexadas<`);
    if(name==='commands.html')html=html.replaceAll('npm run prepare','pnpm exec lefthook install');
    if(name==='index.html'){
      html=html.replaceAll('96/96 PASS','Ejemplo histórico de salud').replaceAll('data-i18n-title="tip_met_health"','').replace(/title="96\/96 checks PASS[^"]*"/,'title="Registro histórico; ejecutar watchtower para conocer el estado real de esta instalación."');
      html=html.replace(/<span class="hero-badge mb-3">[\s\S]*?<\/span>/,`<span class="hero-badge mb-3">✦ v${version} · Documentación técnica</span>`);
      html=html.replace(/<header class="hero" id="overview">[\s\S]*?<\/header>/,hero=>hero
        .replace(/<span class="glow"><span data-i18n="idx_h1">[^<]*<\/span><\/span>/,'Gentle<span class="brand-accent">Vanguard</span>')
        .replace(/Plataforma Autónoma de Orquestración AI —\s*<strong class="text-light">[\s\S]*?<\/strong>/,'Orquestación de IA local-first · automatización con verificaciones')
        .replace(/<div class="d-flex flex-wrap gap-4 justify-content-center z-1 mt-3">[\s\S]*?(?=<div class="mt-4 d-flex)/,`<div class="d-flex flex-wrap gap-4 justify-content-center z-1 mt-3" lang="es"><div class="text-center"><div class="stat-n">${facts.skills.indexed}</div><div class="stat-l">Skills indexadas</div></div><div class="text-center"><div class="stat-n">${facts.agents.opencode}</div><div class="stat-l">Agentes OpenCode</div></div><div class="text-center"><div class="stat-n">${facts.nexus.tables}</div><div class="stat-l">Tablas Nexus</div></div><div class="text-center"><div class="stat-n">${facts.nexus.migrations}</div><div class="stat-l">Migraciones</div></div></div>\n`));
      html=html.replace(/class="lead text-secondary z-1"(?: data-i18n="presence_hero_lead")*/,'class="lead text-secondary z-1" data-i18n="presence_hero_lead"');
      for(const [text,key] of [['Skills indexadas','presence_skills'],['Agentes OpenCode','presence_agents'],['Tablas Nexus','presence_tables'],['Migraciones','presence_migrations']])html=html.replace(`<div class="stat-l">${text}</div>`,`<div class="stat-l" data-i18n="${key}">${text}</div>`);
      html=html.replace(/<footer\b[\s\S]*?<\/footer>/g,footer=>footer.replaceAll('Gentle-Vanguard','GentleVanguard').replace(/v4\.0\.\d+|v4\.0/g,`v${version}`).replace('100% Autonomous AI Stack','Documentación técnica'));
    }
    save(join(dir,name),html);
  }
  register.push({page:name,topic:entry[0],sources:entry[1],reviewed:'2026-10-18',scope:'Architecture shell, canonical aliases/fonts, current-source register and removal of editorial banners; not full historical-content or studio-function certification.',historicalMarketingCollapsed:name==='marketing.html'});
}
const path=join(dir,'presentation-register.json');const value=JSON.stringify({packageVersion:version,factsGeneratedAt:facts.generatedAt,pages:register},null,2)+'\n';
if(!existsSync(path)){if(check){console.error('DRIFT missing presentation register');drift=true;}else writeFileSync(path,value);}else save(path,value);
const brief=join(dir,'STACK-FACTS-BRIEF.md');save(brief,`# GentleVanguard · Stack facts de referencia\n\nGenerados el ${facts.generatedAt} desde configuración, archivos y SQLite read-only. Fuente: [inventario JSON](../generated/stack-facts.json) y [Markdown](../generated/STACK-FACTS.md). Regenerar con npm run stack:facts y luego npm run docs:presentations:sync.\n\n- Versión: ${version}.\n- Skills indexadas: ${facts.skills.indexed}; críticas: ${facts.skills.critical}.\n- Agentes OpenCode: ${facts.agents.opencode}.\n- Nexus: ${facts.nexus.tables} tablas, ${facts.nexus.migrations} migraciones.\n- Presupuesto configurado: ${facts.budgets.daily} diario, ${facts.budgets.perSession} por sesión. No equivale a consumo ni disponibilidad de un proveedor.\n\nNo se publican contadores de tests ni porcentajes de salud como si fueran resultados actuales. Ejecutar la suite/check correspondiente. El registro editorial cubre ${pages.length} presentaciones; no certifica funcionalidad, traducción o accesibilidad completa de cada una.\n`);
if(drift)process.exitCode=1;else console.log(`PASS ${pages.length} presentation entries: classification, current references, summary metrics and historical strategy boundary (${check?'check':'sync'}).`);
