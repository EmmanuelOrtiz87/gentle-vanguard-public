/** One documentation shell, derived from the approved Architecture presentation. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Canonical `<head>` shape shared with normalize-doc-html.ts.
 *
 * The two tools used to disagree: sync-public-presence-docs generated its page
 * through presentationShell(), and the normalizer rewrote the same header
 * afterwards, so `docs:presence:check` reported drift right after every
 * normalize pass. Applying the same rules here makes the pipeline idempotent:
 * generate -> normalize -> check all produce identical bytes.
 */
function normalizeHead(html: string): string {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || 'Documentación';
  let out = html.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
    const withClass = /\bclass=["'][^"']*["']/i.test(attrs)
      ? attrs.replace(/class=["']([^"']*)["']/i, (_m, value) => {
          const classes = [...new Set(`${value} gv-document-page`.split(/\s+/).filter(Boolean))];
          return `class="${classes.join(' ')}"`;
        })
      : `${attrs} class="gv-document-page"`;
    return `<html${/\bdata-bs-theme=/i.test(withClass) ? withClass : `${withClass} data-bs-theme="dark"`}>`;
  });
  out = out.replace(/\s*<meta\s+name=["'](?:theme-color|description)["'][^>]*>/gi, '');
  out = out.replace(
    /<head([^>]*)>/i,
    (_match, attrs: string) =>
      `<head${attrs}>\n    <meta name="theme-color" content="#0b1020" />\n    <meta name="description" content="${title.replace(/"/g, '&quot;')} — GentleVanguard documentation" />`,
  );
  if (!/<link[^>]+href=["']assets\/css\/gv\.css/i.test(out)) {
    out = out.replace(/<\/head>/i, `    <link rel="stylesheet" href="assets/css/gv.css?v=3.0" />\n  </head>`);
  }
  if (!/<title>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (head) => `${head}\n    <title>${title}</title>`);
  }
  return out;
}

export function presentationShell(html: string, root: string): string {
  const reference = readFileSync(resolve(root, 'docs/presentations/architecture.html'), 'utf8');
  const header = reference.match(/<header class="gv-topbar">[\s\S]*?<\/header>/)?.[0];
  if (!header) throw new Error('Architecture shell missing');
  html=html.replace(/\s*<link\b[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi,'');
  html = html.replace(/\s*<!-- GV-EDITORIAL:START -->[\s\S]*?<!-- GV-EDITORIAL:END -->/g, '');
  html = html.replace(/<script>\(\(\)=>\{try\{const t=localStorage[\s\S]*?document\.querySelector\('#doc-theme'\)[\s\S]*?<\/script>/g, '');
  if (/<header class="gv-topbar">/.test(html)) html = html.replace(/<header class="gv-topbar">[\s\S]*?<\/header>/, header);
  else html = html.replace(/<header>[\s\S]*?<\/header>/, header);
  // Last stylesheet wins over historical page-local aliases, without redefining GV tokens.
  html = html.replace(/\s*<link[^>]*href="assets\/css\/presentation-shell\.css[^"]*"[^>]*>/g, '');
  for (const script of ['i18n-content.js?v=2.1', 'i18n-extra.js?v=2.1', 'i18n.js?v=3.0', 'theme-toggle.js?v=2.0', 'gv.js?v=2.1', 'presentation-shell.js?v=1']) {
    if (!html.includes(`assets/js/${script.split('?')[0]}`)) html = html.replace('</body>', `<script src="assets/js/${script}"></script></body>`);
  }
  if (!html.includes('assets/css/gv.css')) html = html.replace('</head>', '<link rel="stylesheet" href="assets/css/gv.css?v=3.0"></head>');
  if (!html.includes('assets/vendor/bootstrap-icons.min.css')) html = html.replace('</head>', '<link rel="stylesheet" href="assets/vendor/bootstrap-icons.min.css"></head>');
  html = html.replace(/\s*<\/head>/, '\n<link rel="icon" href="assets/canon/icon.svg"><link rel="stylesheet" href="assets/css/presentation-shell.css?v=1"></head>');
  const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
  const footer=`<footer class="gv-document-footer"><p><strong>GentleVanguard</strong> · v${version}</p><nav aria-label="Documentación"><a href="index.html">Documentación</a><a href="resources-index.html">Recursos</a><a href="public-presence.html">Estado vigente</a></nav></footer>`;
  if (/<footer\b/.test(html)) html=html.replace(/<footer\b[\s\S]*?<\/footer>/,footer);
  else html=html.replace('</main>','</main>'+footer);
  return normalizeHead(html);
}
