/// <reference lib="dom" />
/**
 * gemini-browser-import.ts — Import de gemas de la cuenta Gemini usando el navegador real.
 *
 * Por qué existe: Google NO reconoce las cookies __Secure-1PSID pegadas desde Node
 * (fingerprint TLS no-navegador → degrada a "guest" y nunca emite SNlM0e). La única vía
 * estable es ejecutar el protocolo reverse-engineered DENTRO del navegador autenticado.
 *
 * Este CLI del stack arranca Chromium (Playwright) con un perfil persistente de la app,
 * el usuario inicia sesión UNA vez en gemini.google.com, y a partir de ahí cada import
 * se hace con la sesión real (cookies + fingerprint de Chromium), ejecutando el
 * batchexecute vía page.evaluate.
 *
 * Modos:
 *   --check    (headless) detecta si el perfil tiene sesión en Gemini; salida JSON {ok, needsLogin}
 *   --login    (headed) abre gemini.google.com en ventana para que el usuario ingrese; queda abierta
 *   --import   (headless) hace el fetch de las gemas con la sesión guardada; salida JSON {ok, gems}
 *
 * Uso:
 *   node --import tsx src/ops/gemini-browser-import.ts --check --profile <dir>
 *   node --import tsx src/ops/gemini-browser-import.ts --login --profile <dir>
 *   node --import tsx src/ops/gemini-browser-import.ts --import --profile <dir>
 *
 * Salida (stdout JSON):
 *   { ok:true, needsLogin?:boolean, gems?: [...], imported?: number }
 *   { ok:false, error:string }
 *
 * Dependencia: playwright en el root del stack. Binarios: ms-playwright chromium.
 */
import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PROFILE = process.env.GV_PROMPT_PROFILE_DIR ?? join(ROOT, '.runtime', 'prompt-studio', 'browser-profile');

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
// flags booleanos por presencia (getArg rompe si el flag es el último argumento)
const hasFlag = (name: string) => process.argv.includes(name);
const mode = hasFlag('--check') ? 'check' : hasFlag('--login') ? 'login' : hasFlag('--import') ? 'import' : 'check';
const profileDir = resolve(getArg('--profile') ?? PROFILE);

function out(data: unknown, code = 0): never {
  console.log(JSON.stringify(data));
  process.exit(code);
}

const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

async function checkSession(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  const info = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const token = html.match(/"SNlM0e":\s*"(.*?)"/)?.[1] ?? '';
    const hasSignIn = html.includes('Sign in') && !html.includes('user-info');
    return { hasToken: token.length > 0, tokenLength: token.length, hasSignIn };
  });
  return info;
}

async function main(): Promise<void> {
  mkdirSync(profileDir, { recursive: true });
  // Chrome real del sistema si está instalado — Google desconfía del Chromium
  // empaquetado de Playwright en el login ("Este navegador no es seguro").
  const launch = async (headless: boolean) => {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        headless,
        channel: 'chrome',
        args: LAUNCH_ARGS,
      });
    } catch {
      return await chromium.launchPersistentContext(profileDir, { headless, args: LAUNCH_ARGS });
    }
  };
  type PersistentContext = Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  let context: PersistentContext | undefined;
  try {
    if (mode === 'login') {
      context = await launch(false);
      const loginCtx = context;
      const page = loginCtx.pages()[0] ?? (await loginCtx.newPage());
      // Formulario de email/contraseña de Google DIRECTO; al terminar redirige a Gemini
      await page.goto(
        'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp&hl=es',
        { waitUntil: 'domcontentloaded', timeout: 60_000 },
      );
      // Mantener la ventana abierta hasta que el usuario la cierre o timeout de 10 min
      await new Promise<void>((resolve) => {
        loginCtx.on('close', () => resolve());
        setTimeout(() => resolve(), 600_000); // 10 min timeout
      });
      out({ ok: true, login: true, message: 'Login completado o timeout' });
      return;
    }

    context = await launch(true);

    if (mode === 'check') {
      const info = await checkSession(context);
      out({ ok: true, needsLogin: !info.hasToken, tokenLength: info.tokenLength, hasSignIn: info.hasSignIn });
    }

    // mode === 'import'
    const info = await checkSession(context);
    if (!info.hasToken) {
      out({ ok: false, error: 'Sesión de Gemini no iniciada — ejecutá primero el modo --login.', needsLogin: true });
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // extraer token de la página ya cargada
    const htmlNow = await page.evaluate(() => document.documentElement.outerHTML);
    const accessToken = htmlNow.match(/"SNlM0e":\s*"(.*?)"/)?.[1] ?? '';
    const sessionId = htmlNow.match(/"FdrFJe":\s*"(.*?)"/)?.[1] ?? '';
    const language = htmlNow.match(/"TuX5cc":\s*"(.*?)"/)?.[1] ?? 'en';
    if (!accessToken) out({ ok: false, error: 'SNlM0e no disponible en la sesión.', needsLogin: true });

    // POST batchexecute dentro del navegador (misma sesión + fingerprint). rpcids:
    //  - CNgdBe [4]=system (+hidden), [2]=custom — LISTA con prompt TRUNCADO (~100 chars)
    //  - HcT8bb ["<gem_id>"] — DETALLE con prompt COMPLETO (descubierto por reverse-eng, 2026-09-06)
    const raw = await page.evaluate(
      async ({ token, lang, sid }) => {
        const params = new URLSearchParams({
          rpcids: 'CNgdBe,CNgdBe',
          hl: lang,
          _reqid: String(100000 + Math.floor(Math.random() * 900000)),
          rt: 'c',
          'source-path': '/app',
        });
        if (sid) params.set('f.sid', sid);
        const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params.toString()}`;
        const fReq = JSON.stringify([
          [
            ['CNgdBe', `[4,['${lang}'],0]`, null, 'system'],
            ['CNgdBe', `[2,['${lang}'],0]`, null, 'custom'],
          ],
        ]);
        const body = new URLSearchParams();
        body.set('at', token);
        body.set('f.req', fReq);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: body.toString(),
        });
        if (!res.ok) return `HTTP ${res.status}`;
        return await res.text();
      },
      { token: accessToken, lang: language, sid: sessionId },
    );

    // Parser robusto: el formato length-prefixed de batchexecute dejó de parsear (frames
    // truncados/rotos). Extracción JSON-aware de cada payload string "wrb.fr","<rpcid>","<json>"
    // via regex con soporte de escapes — validado contra respuesta real 2026-09-06.
    const extractPayloads = (rawText: string, rpcid: string): string[] => {
      const re = new RegExp(`\\["wrb\\.fr","${rpcid}","((?:[^"\\\\]|\\\\.)*)"`, 'g');
      const payloads: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(rawText))) {
        try {
          payloads.push(JSON.parse('"' + m[1] + '"') as string);
        } catch {
          /* payload corrupto — saltar */
        }
      }
      return payloads;
    };

    const parseGemList = (payload: string) => {
      try {
        const partBody = JSON.parse(payload) as unknown[];
        const list = partBody[2];
        if (!Array.isArray(list)) return [];
        const gemsOut: Array<{ id: string; name: string; description: string; prompt: string; predefined: boolean }> = [];
        for (const gem of list) {
          if (!Array.isArray(gem) || typeof gem[0] !== 'string') continue;
          const meta = Array.isArray(gem[1]) ? gem[1] : [];
          const promptArr = Array.isArray(gem[2]) ? gem[2] : [];
          gemsOut.push({
            id: gem[0],
            name: String(meta[0] ?? 'Sin nombre'),
            description: String(meta[1] ?? ''),
            prompt: typeof promptArr[0] === 'string' ? promptArr[0] : '',
            predefined: false, // se define por el identificador del payload que lo contiene
          });
        }
        return gemsOut;
      } catch {
        return [];
      }
    };

    const gems: Array<{ id: string; name: string; description: string; prompt: string; predefined: boolean }> = [];
    if (typeof raw === 'string' && !raw.startsWith('HTTP ')) {
      for (const payload of extractPayloads(raw, 'CNgdBe')) {
        for (const g of parseGemList(payload)) gems.push(g);
      }
    }
    // Clasificación: los ids de gemas CUSTOM son hex (ej. 36c023573889); los del sistema son
    // kebab-case (ej. canvas-create-infographics). Empíricamente [4]→custom y [2]→system en
    // esta cuenta (invertido vs. la librería de referencia) — el hex-id es el criterio estable.
    const isCustomId = (id: string) => /^[0-9a-f]{10,}$/i.test(id);
    const customGems = gems.filter((g) => isCustomId(g.id));
    const detailResult = await page.evaluate(
      async ({ token, lang, sid, ids }) => {
        const out: Record<string, string> = {};
        for (const id of ids) {
          try {
            const params = new URLSearchParams({
              rpcids: 'HcT8bb',
              hl: lang,
              _reqid: String(100000 + Math.floor(Math.random() * 900000)),
              rt: 'c',
              'source-path': '/app',
            });
            if (sid) params.set('f.sid', sid);
            const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params.toString()}`;
            const body = new URLSearchParams();
            body.set('at', token);
            body.set('f.req', JSON.stringify([[['HcT8bb', JSON.stringify([id]), null, 'generic']]]));
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
              body: body.toString(),
            });
            if (!res.ok) continue;
            out[id] = await res.text();
          } catch {
            /* gema sin detalle — queda con el preview */
          }
        }
        return out;
      },
      { token: accessToken, lang: language, sid: sessionId, ids: customGems.map((g) => g.id) },
    );
    for (const g of customGems) {
      const rawDetail = detailResult[g.id];
      if (!rawDetail) continue;
      const payloads = extractPayloads(rawDetail, 'HcT8bb');
      for (const p of payloads) {
        try {
          const partBody = JSON.parse(p) as unknown[];
          const gemArr = Array.isArray(partBody) ? partBody[0] : null;
          if (!Array.isArray(gemArr)) continue;
          const promptArr = Array.isArray(gemArr[2]) ? gemArr[2] : [];
          const full = typeof promptArr[0] === 'string' ? promptArr[0] : '';
          if (full.length > g.prompt.length) g.prompt = full; // solo si es mejor que el preview
        } catch {
          /* detalle ilegible — queda el preview */
        }
      }
    }

    // Solo las gemas CUSTOM se importan (las del sistema son 60+ y no se editan)
    out({ ok: true, gems: customGems, imported: customGems.length, session: { language, sessionId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (context) await context.close().catch(() => undefined);
    if (msg.includes('already running') || msg.includes('locked')) {
      out({ ok: false, error: 'El perfil del navegador está en uso. Si el modo --login está abierto, cerrá esa ventana y reintentá.' });
    }
    out({ ok: false, error: msg });
  }
}

void main().catch((err) => {
  out({ ok: false, error: err instanceof Error ? err.message : String(err) });
});