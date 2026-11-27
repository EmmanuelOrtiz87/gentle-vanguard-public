import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectConflict,
  describeHttpError,
  diffSummary,
  fingerprint,
  parseCliArgs,
  parsePlan,
  publishPage,
  resolvePlanBody,
} from '../../scripts/khorall/publish-governed.js';
import type {
  CensorClient,
  PublisherState,
  Writer,
} from '../../scripts/khorall/publish-governed.js';

const IMAGE = '<ac:image><ri:attachment ri:filename="referencia-att4749492226.png"/></ac:image>';

test('una raíz con plataforma declarada exige su prefijo también al traducir o actualizar', () => {
  for (const platform of ['OTT', 'SKY', 'DTV']) {
    const root = {
      id: '123',
      platform,
      title: `[${platform}] - Buyflow — Digital`,
      body: '<p>English</p>',
    };
    assert.equal(parsePlan({ pages: [root] }).pages[0].platform, platform);
    for (const title of ['Buyflow — Digital', '[OTHER] - Buyflow', `[${platform}] - `]) {
      assert.throws(() => parsePlan({ pages: [{ ...root, title }] }), /prefijo/);
    }
    assert.throws(() => parsePlan({ pages: [{ ...root, title: undefined }] }), /prefijo/);
  }
  assert.throws(
    () => parsePlan({ pages: [{ id: '123', platform: 'OTHER', body: 'x' }] }),
    /plataforma/,
  );
});

test('la biblioteca compartida y las áreas no requieren prefijo de plataforma', () => {
  assert.equal(
    parsePlan({ pages: [{ id: '123', title: 'Magento — Buyflow Digital', body: 'x' }] }).pages[0]
      .platform,
    undefined,
  );
});

/** Cliente falso: la página existe con el cuerpo dado y los adjuntos indicados. */
function fakeClient(options: {
  body: string;
  version?: number;
  attachments?: Record<string, string[]>;
  /** Páginas concretas por id (id → cuerpo, padre, versión). */
  pages?: Record<string, { body?: string; title?: string; version?: number; parentId?: string }>;
  /** Ids que devuelve la búsqueda CQL por título. */
  searchIds?: string[];
  /** Clave del espacio que resuelve `/rest/api/space/{id}`. */
  spaceKey?: string;
}): { client: CensorClient; puts: Array<{ path: string; body: any }> } {
  const puts: Array<{ path: string; body: any }> = [];
  const attachments = options.attachments ?? {};
  const client: CensorClient = {
    async request(path: string) {
      if (path.startsWith('/rest/api/search')) {
        return { results: (options.searchIds ?? []).map((id) => ({ content: { id } })) };
      }
      if (path.startsWith('/rest/api/space/')) {
        return { key: options.spaceKey ?? 'TEST' };
      }
      if (path.startsWith('/api/v2/pages/')) {
        const id = path.split('/').pop() ?? '';
        const page = options.pages?.[id];
        if (page) {
          return {
            id,
            title: page.title ?? 'Ficha',
            version: { number: page.version ?? options.version ?? 1 },
            ...(page.parentId ? { parentId: page.parentId } : {}),
            body: { storage: { value: page.body ?? options.body } },
          };
        }
        return {
          id: '1',
          title: 'Ficha',
          version: { number: options.version ?? 1 },
          body: { storage: { value: options.body } },
        };
      }
      return {};
    },
    async fetchPageAttachments(pageId: string) {
      return (attachments[pageId] ?? []).map((title, index) => ({
        id: `${pageId}-${index}`,
        title,
      }));
    },
  };
  return { client, puts };
}

function fakeWriter(
  puts: Array<{ path: string; body: any }>,
  options: {
    posts?: Array<{ path: string; body: any }>;
    createResponse?: () => Response;
  } = {},
): Writer {
  const posts = options.posts ?? [];
  return {
    base: 'https://ejemplo.atlassian.net/wiki',
    authorization: 'Basic test',
    async request(path: string, init?: { method?: string; body?: BodyInit }) {
      if (init?.method === 'PUT') puts.push({ path, body: JSON.parse(String(init.body)) });
      if (init?.method === 'POST' && path === '/api/v2/pages') {
        posts.push({ path, body: JSON.parse(String(init.body)) });
        return options.createResponse
          ? options.createResponse()
          : new Response(JSON.stringify({ id: '999', version: { number: 1 } }), { status: 201 });
      }
      if (init?.method === 'POST' && path.includes('/child/attachment'))
        return new Response('{}', { status: 200 });
      if (path.includes('/child/attachment?filename='))
        return new Response(
          JSON.stringify({ results: [{ _links: { download: '/download/attachments/1/x.png' } }] }),
          { status: 200 },
        );
      return new Response('{}', { status: 200 });
    },
  };
}

function fakeFetch(): typeof fetch {
  return (async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })) as unknown as typeof fetch;
}

test('el publicador no escribe cuando el cuerpo ya es el mismo', async () => {
  const body = '<p>Sin cambios</p>';
  const { client, puts } = fakeClient({ body });
  const state: PublisherState = { pages: {} };
  const receipt = await publishPage({
    entry: { id: '1', body },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'sin-cambios');
  assert.equal(puts.length, 0);
});

test('el adjunto que falta en el destino se copia desde el origen', async () => {
  const { client, puts } = fakeClient({
    body: '<p>Actual</p>',
    attachments: { '1': [], '2': ['referencia-att4749492226.png'] },
  });
  const state: PublisherState = { pages: {} };
  const receipt = await publishPage({
    entry: { id: '1', body: `<p>Nuevo</p>${IMAGE}`, sourcePageId: '2' },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: true,
    strict: true,
    fetchImpl: fakeFetch(),
  });
  assert.equal(receipt.status, 'publicado');
  assert.deepEqual(receipt.attachments?.copied, ['referencia-att4749492226.png']);
  assert.deepEqual(receipt.attachments?.pending, []);
  // El PUT lleva el markup de imagen: ahora el adjunto viaja con la página.
  assert.ok(puts[0].body.body.value.includes('ri:filename'));
});

test('si el adjunto no existe en el origen, el markup no se publica y queda pendiente', async () => {
  const { client, puts } = fakeClient({
    body: '<p>Actual</p>',
    attachments: { '1': [], '2': [] },
  });
  const state: PublisherState = { pages: {} };
  const receipt = await publishPage({
    entry: { id: '1', body: `<p>Nuevo</p>${IMAGE}`, sourcePageId: '2' },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: true,
    strict: false,
    fetchImpl: fakeFetch(),
  });
  assert.equal(receipt.status, 'publicado');
  assert.deepEqual(receipt.attachments?.pending, ['referencia-att4749492226.png']);
  // El cuerpo publicado no lleva el markup roto: la referencia queda como texto.
  assert.ok(!puts[0].body.body.value.includes('ri:filename'));
  assert.ok(puts[0].body.body.value.includes('referencia-att4749492226.png'));
});

test('en modo estricto, un adjunto sin resolver bloquea la publicación', async () => {
  const { client, puts } = fakeClient({
    body: '<p>Actual</p>',
    attachments: { '1': [], '2': [] },
  });
  const state: PublisherState = { pages: {} };
  const receipt = await publishPage({
    entry: { id: '1', body: `<p>Nuevo</p>${IMAGE}`, sourcePageId: '2' },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: true,
    strict: true,
    fetchImpl: fakeFetch(),
  });
  assert.equal(receipt.status, 'bloqueado');
  assert.equal(puts.length, 0);
  assert.ok(receipt.notice?.includes('referencia-att4749492226.png'));
});

test('una edición humana bloquea la publicación', async () => {
  const { client, puts } = fakeClient({ body: '<p>Editado por una persona</p>' });
  const state: PublisherState = {
    pages: {
      '1': {
        fingerprint: fingerprint('<p>Publicado</p>'),
        version: 2,
        publishedAt: '2026-11-20T00:00:00.000Z',
      },
    },
  };
  const receipt = await publishPage({
    entry: { id: '1', body: '<p>Propuesto</p>' },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'conflicto');
  assert.equal(puts.length, 0);
});

test('el dry-run muestra el diff y no escribe', async () => {
  const { client, puts } = fakeClient({ body: '<h2>Contexto</h2><p>Actual</p>' });
  const state: PublisherState = { pages: {} };
  const receipt = await publishPage({
    entry: { id: '1', body: '<h2>Contexto</h2><p>Propuesto</p>' },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts),
    state,
    apply: false,
    strict: false,
  });
  assert.equal(receipt.status, 'simulado');
  assert.equal(puts.length, 0);
  assert.deepEqual(receipt.diff?.changedSections, ['Contexto']);
});

test('el plan exige páginas con id y cuerpo', () => {
  const plan = parsePlan({
    spaceId: '45940737',
    pages: [{ id: '6138494977', body: '<p>hola</p>' }],
  });
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].id, '6138494977');
  assert.throws(() => parsePlan({}));
  assert.throws(() => parsePlan({ pages: [] }));
  assert.throws(() => parsePlan({ pages: [{ body: '<p>x</p>' }] }));
  assert.throws(() => parsePlan({ pages: [{ id: 'abc', body: '<p>x</p>' }] }));
  assert.throws(() => parsePlan({ pages: [{ id: '6138494977' }] }));
});

test('el cuerpo puede venir inline o desde un archivo del plan', () => {
  const entry = parsePlan({ pages: [{ id: '1', body: '<p>inline</p>' }] }).pages[0];
  assert.equal(resolvePlanBody(entry, process.cwd()), '<p>inline</p>');
  const fromFile = parsePlan({ pages: [{ id: '1', bodyFile: 'package.json' }] }).pages[0];
  assert.ok(resolvePlanBody(fromFile, process.cwd()).length > 0);
  const missing = parsePlan({ pages: [{ id: '1', bodyFile: 'no-existe.json' }] }).pages[0];
  assert.throws(() => resolvePlanBody(missing, process.cwd()));
});

test('la huella no depende del fin de línea ni de los espacios finales', () => {
  assert.equal(fingerprint('<p>a</p>\r\n<p>b</p>'), fingerprint('<p>a</p>\n<p>b</p>'));
  assert.equal(fingerprint('<p>a</p>  '), fingerprint('<p>a</p>'));
  assert.notEqual(fingerprint('<p>a</p>'), fingerprint('<p>b</p>'));
});

test('el diff resume secciones y líneas cambiadas', () => {
  const current = '<h2>Contexto</h2><p>Uno</p><h2>Cierre</h2><p>Dos</p>';
  const same = diffSummary(current, current);
  assert.equal(same.identical, true);
  assert.equal(same.addedLines, 0);

  const changed = diffSummary(current, '<h2>Contexto</h2><p>Uno</p><h2>Cierre</h2><p>Tres</p>');
  assert.equal(changed.identical, false);
  assert.deepEqual(changed.changedSections, ['Cierre']);

  const added = diffSummary(current, `${current}<h2>Anexo</h2><p>Nuevo</p>`);
  assert.deepEqual(added.addedSections, ['Anexo']);
  assert.ok(added.addedLines > 0);

  const removed = diffSummary(current, '<h2>Contexto</h2><p>Uno</p>');
  assert.deepEqual(removed.removedSections, ['Cierre']);
});

test('la edición humana se detecta como conflicto', () => {
  const current = fingerprint('<p>actual</p>');
  const proposed = fingerprint('<p>propuesto</p>');
  const last = { fingerprint: fingerprint('<p>publicado</p>'), version: 3 };

  // La página cambió desde la última publicación conocida y no es el publicador.
  const edited = detectConflict({
    currentFingerprint: current,
    proposedFingerprint: proposed,
    lastPublished: last,
  });
  assert.equal(edited.conflict, true);
  assert.ok(edited.reason?.includes('editada por una persona'));

  // La página está como la publicó el stack: se puede actualizar.
  const clean = detectConflict({
    currentFingerprint: last.fingerprint,
    proposedFingerprint: proposed,
    lastPublished: last,
  });
  assert.equal(clean.conflict, false);

  // Versión esperada distinta de la actual: conflicto.
  const drifted = detectConflict({
    currentFingerprint: current,
    proposedFingerprint: proposed,
    currentVersion: 5,
    expectedVersion: 4,
  });
  assert.equal(drifted.conflict, true);
  assert.ok(drifted.reason?.includes('versión 5'));

  // Primera publicación: no hay conflicto.
  assert.equal(
    detectConflict({ currentFingerprint: current, proposedFingerprint: proposed }).conflict,
    false,
  );
});

test('los errores HTTP distinguen credenciales de permiso', () => {
  assert.ok(describeHttpError(401, 'la página 1').includes('Sin credenciales'));
  assert.ok(describeHttpError(403, 'la página 1').includes('Sin permiso'));
  assert.ok(describeHttpError(404, 'la página 1').includes('No existe'));
});

test('sin --apply el publicador queda en dry-run', () => {
  assert.equal(parseCliArgs(['--plan', 'p.json']).apply, false);
  assert.equal(parseCliArgs(['--plan', 'p.json', '--apply']).apply, true);
  assert.equal(parseCliArgs(['--plan', 'p.json', '--apply', '--dry-run']).apply, false);
  assert.equal(parseCliArgs(['--strict']).strict, true);
  assert.equal(parseCliArgs(['--runtime-dir', 'x']).runtimeDir, 'x');
  assert.equal(parseCliArgs(['--help']).help, true);
});

test('el markup de imagen sin adjunto es un pendiente declarado', () => {
  // El caso medido el 20/11/2026: markup que viaja sin el archivo adjunto.
  const body = `<p>Ficha</p>${IMAGE}`;
  assert.ok(body.includes('ri:filename'));
  const referenced = body.match(/ri:filename="([^"]+)"/g) ?? [];
  assert.equal(referenced.length, 1);
});

/* --------------------------------------------------------------- creación ---- */

const SPACE = '45940737';
const PARENT = '6138494977';

function createArgs(overrides: Record<string, unknown> = {}) {
  const { client } = fakeClient({ body: '' });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  return {
    client,
    puts,
    posts,
    args: {
      entry: {
        title: 'Ficha nueva',
        body: '<p>Nuevo</p>',
        spaceId: SPACE,
        parentId: PARENT,
        create: true,
        ...overrides,
      },
      planDir: process.cwd(),
      client,
      writer: fakeWriter(puts, { posts }),
      state: { pages: {} } as PublisherState,
      apply: true,
      strict: false,
    },
  };
}

test('una página sin id se crea con POST /api/v2/pages', async () => {
  const { args, puts, posts } = createArgs();
  const receipt = await publishPage(args);
  assert.equal(receipt.status, 'publicado');
  assert.equal(receipt.operation, 'created');
  assert.equal(receipt.id, '999');
  assert.equal(receipt.createdPageId, '999');
  assert.equal(puts.length, 0);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/v2/pages');
  assert.equal(posts[0].body.spaceId, SPACE);
  assert.equal(posts[0].body.parentId, PARENT);
  assert.equal(posts[0].body.title, 'Ficha nueva');
  assert.equal(posts[0].body.status, 'current');
  assert.equal(posts[0].body.body.representation, 'storage');
  assert.ok(posts[0].body.body.value.includes('Nuevo'));
});

test('el estado recuerda la página creada por espacio, padre y título', async () => {
  const { args } = createArgs();
  const receipt = await publishPage(args);
  assert.equal(receipt.status, 'publicado');
  assert.equal(args.state.created?.[`${SPACE}|${PARENT}|ficha nueva`]?.pageId, '999');
});

test('en dry-run la creación no escribe y avisa qué se crearía', async () => {
  const { args, puts, posts } = createArgs();
  const receipt = await publishPage({ ...args, apply: false });
  assert.equal(receipt.status, 'simulado');
  assert.equal(receipt.operation, 'created');
  assert.equal(posts.length, 0);
  assert.equal(puts.length, 0);
  assert.ok(receipt.notice?.includes(`se crearía «Ficha nueva» bajo ${PARENT}`));
});

test('si la página ya existe bajo el mismo padre, se actualiza en vez de duplicar', async () => {
  const { client } = fakeClient({
    body: '',
    searchIds: ['777'],
    pages: { '777': { body: '<p>Viejo</p>', title: 'Ficha', version: 3, parentId: PARENT } },
  });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const receipt = await publishPage({
    entry: { title: 'Ficha nueva', body: '<p>Nuevo</p>', spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, { posts }),
    state: { pages: {} },
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'publicado');
  assert.equal(receipt.operation, 'updated');
  assert.equal(receipt.id, '777');
  assert.equal(posts.length, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, '/api/v2/pages/777');
  assert.ok(puts[0].body.body.value.includes('Nuevo'));
});

test('si la página existe bajo otro padre, se reporta conflicto y no se pisa', async () => {
  const { client } = fakeClient({
    body: '',
    searchIds: ['888'],
    pages: { '888': { body: '<p>Otro</p>', title: 'Ficha', version: 1, parentId: '999999' } },
  });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const receipt = await publishPage({
    entry: { title: 'Ficha nueva', body: '<p>Nuevo</p>', spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, { posts }),
    state: { pages: {} },
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'conflicto');
  assert.ok(receipt.reason?.includes('otro padre'));
  assert.equal(puts.length, 0);
  assert.equal(posts.length, 0);
});

test('el estado previo con el id creado actualiza esa página en vez de crear otra', async () => {
  const { client } = fakeClient({
    body: '',
    pages: { '555': { body: '<p>Viejo</p>', title: 'Ficha', version: 2, parentId: PARENT } },
  });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const state: PublisherState = {
    pages: {
      '555': {
        fingerprint: fingerprint('<p>Viejo</p>'),
        version: 2,
        publishedAt: '2026-11-20T00:00:00.000Z',
      },
    },
    created: {
      [`${SPACE}|${PARENT}|ficha nueva`]: {
        pageId: '555',
        fingerprint: fingerprint('<p>Viejo</p>'),
        version: 2,
        publishedAt: '2026-11-20T00:00:00.000Z',
      },
    },
  };
  const receipt = await publishPage({
    entry: { title: 'Ficha nueva', body: '<p>Nuevo</p>', spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, { posts }),
    state,
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'publicado');
  assert.equal(receipt.operation, 'updated');
  assert.equal(receipt.id, '555');
  assert.equal(posts.length, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, '/api/v2/pages/555');
});

test('un 403 al crear se reporta como falta de permiso para crear', async () => {
  const { client } = fakeClient({ body: '' });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const receipt = await publishPage({
    entry: { title: 'Ficha nueva', body: '<p>Nuevo</p>', spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, {
      posts,
      createResponse: () => new Response('{"message":"forbidden"}', { status: 403 }),
    }),
    state: { pages: {} },
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'error');
  assert.ok(receipt.reason?.includes('Sin permiso para crear páginas en este espacio'));
  assert.ok(receipt.reason?.includes('(403)'));
});

test('en creación los adjuntos referenciados quedan pendientes', async () => {
  const { client } = fakeClient({ body: '' });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const receipt = await publishPage({
    entry: { title: 'Con imagen', body: `<p>Nuevo</p>${IMAGE}`, spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, { posts }),
    state: { pages: {} },
    apply: true,
    strict: false,
  });
  assert.equal(receipt.status, 'publicado');
  assert.deepEqual(receipt.attachments?.pending, ['referencia-att4749492226.png']);
  assert.deepEqual(receipt.attachments?.copied, []);
  assert.ok(!posts[0].body.body.value.includes('ri:filename'));
});

test('en creación, un adjunto sin resolver bloquea en modo estricto', async () => {
  const { client } = fakeClient({ body: '' });
  const puts: Array<{ path: string; body: any }> = [];
  const posts: Array<{ path: string; body: any }> = [];
  const receipt = await publishPage({
    entry: { title: 'Con imagen', body: `<p>Nuevo</p>${IMAGE}`, spaceId: SPACE, parentId: PARENT },
    planDir: process.cwd(),
    client,
    writer: fakeWriter(puts, { posts }),
    state: { pages: {} },
    apply: true,
    strict: true,
  });
  assert.equal(receipt.status, 'bloqueado');
  assert.equal(posts.length, 0);
  assert.ok(receipt.notice?.includes('referencia-att4749492226.png'));
});

test('el plan acepta páginas a crear (sin id, con título y espacio numérico)', () => {
  const plan = parsePlan({
    spaceId: SPACE,
    pages: [{ title: 'Nueva', body: '<p>x</p>', parentId: PARENT }],
  });
  assert.equal(plan.pages[0].id, undefined);
  assert.equal(plan.pages[0].create, true);
  assert.equal(plan.pages[0].spaceId, SPACE);
  assert.equal(plan.pages[0].parentId, PARENT);
  // El espacio puede venir a nivel de página.
  const perPage = parsePlan({
    pages: [{ title: 'Nueva', body: '<p>x</p>', spaceId: SPACE }],
  });
  assert.equal(perPage.pages[0].spaceId, SPACE);
  // Sin título no se puede crear.
  assert.throws(() => parsePlan({ spaceId: SPACE, pages: [{ body: '<p>x</p>' }] }));
  // Sin espacio no se puede crear.
  assert.throws(() => parsePlan({ pages: [{ title: 'T', body: '<p>x</p>' }] }));
  // El espacio de creación tiene que ser numérico.
  assert.throws(() => parsePlan({ spaceId: 'OTT', pages: [{ title: 'T', body: '<p>x</p>' }] }));
  // Sin id y con create:false no hay página que actualizar.
  assert.throws(() =>
    parsePlan({ spaceId: SPACE, pages: [{ title: 'T', body: '<p>x</p>', create: false }] }),
  );
});
