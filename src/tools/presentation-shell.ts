/** One documentation shell, derived from the approved Architecture presentation. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function presentationShell(html: string, root: string): string {
  const reference = readFileSync(resolve(root, 'docs/presentations/architecture.html'), 'utf8');
  const header = reference.match(/<header class="gv-topbar">[\s\S]*?<\/header>/)?.[0];
  if (!header) throw new Error('Architecture shell missing');
  html=html.replace(/<link\b[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi,'');
  html=html.replace('</head>','<link rel="icon" href="assets/canon/icon.svg"></head>');
  html = html.replace(/\s*<!-- GV-EDITORIAL:START -->[\s\S]*?<!-- GV-EDITORIAL:END -->/g, '');
  html = html.replace(/<script>\(\(\)=>\{try\{const t=localStorage[\s\S]*?document\.querySelector\('#doc-theme'\)[\s\S]*?<\/script>/g, '');
  if (/<header class="gv-topbar">/.test(html)) html = html.replace(/<header class="gv-topbar">[\s\S]*?<\/header>/, header);
  else html = html.replace(/<header>[\s\S]*?<\/header>/, header);
  // Last stylesheet wins over historical page-local aliases, without redefining GV tokens.
  html = html.replace(/\s*<link[^>]*href="assets\/css\/presentation-shell\.css[^"]*"[^>]*>/g, '');
  html = html.replace('</head>', '\n<link rel="stylesheet" href="assets/css/presentation-shell.css?v=1"></head>');
  for (const script of ['i18n-content.js?v=2.1', 'i18n-extra.js?v=2.1', 'i18n.js?v=3.0', 'theme-toggle.js?v=2.0', 'gv.js?v=2.1', 'presentation-shell.js?v=1']) {
    if (!html.includes(`assets/js/${script.split('?')[0]}`)) html = html.replace('</body>', `<script src="assets/js/${script}"></script></body>`);
  }
  if (!html.includes('assets/css/gv.css')) html = html.replace('<style>', '<link rel="stylesheet" href="assets/css/gv.css?v=3.0"><style>');
  if (!html.includes('assets/vendor/bootstrap-icons.min.css')) html = html.replace('</head>', '<link rel="stylesheet" href="assets/vendor/bootstrap-icons.min.css"></head>');
  const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
  const footer=`<footer class="gv-document-footer"><p><strong>GentleVanguard</strong> · v${version}</p><nav aria-label="Documentación"><a href="index.html">Documentación</a><a href="resources-index.html">Recursos</a><a href="public-presence.html">Estado vigente</a></nav></footer>`;
  if (/<footer\b/.test(html)) html=html.replace(/<footer\b[\s\S]*?<\/footer>/,footer);
  else html=html.replace('</main>','</main>'+footer);
  return html;
}
