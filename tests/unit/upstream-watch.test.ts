import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { changedSources, sourceSig, buildAlertBody, buildVbs } from '../../src/ops/upstream-watch.js';

describe('sourceSig', () => {
  it('determinística y sensible al contenido', () => {
    const a = sourceSig(['hola\nmundo', 'x']);
    const b = sourceSig(['hola\nmundo', 'x']);
    const c = sourceSig(['hola\nmundo', 'x!']);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
  it('normaliza CRLF (el contenido cruza plataformas)', () => {
    assert.equal(sourceSig(['a\r\nb']), sourceSig(['a\nb']));
  });
});

describe('changedSources', () => {
  const st = (id: string, sig: string): { id: string; sig: string; changedAt: string } => ({ id, sig, changedAt: '' });
  it('alerta sólo sources ya conocidos que cambiaron', () => {
    const prev = [st('gentle-ai', 'aaa'), st('otro', 'bbb')];
    const next = [st('gentle-ai', 'ccc'), st('otro', 'bbb'), st('nuevo', 'ddd')];
    assert.deepEqual(changedSources(prev, next), ['gentle-ai']);
  });
  it('baseline (prev vacío) nunca alerta', () => {
    assert.deepEqual(changedSources([], [st('gentle-ai', 'aaa')]), []);
  });
});

describe('buildAlertBody', () => {
  it('incluye urls, sigs y doc de absorción con acción', () => {
    const body = buildAlertBody(
      { id: 'gentle-ai', label: 'upstream', urls: ['https://a', 'https://b'], absorptionDoc: 'docs/reference/x.md' },
      'aaa', 'bbb', '2026-10-21',
    ).join('\n');
    assert.ok(body.includes('2026-10-21') && body.includes('aaa') && body.includes('bbb'));
    assert.ok(body.includes('https://a') && body.includes('docs/reference/x.md') && body.includes('Acción'));
  });
});

describe('buildVbs (procesos-ocultos)', () => {
  it('launcher wscript siempre WINDOWSTYLE 0 y node --import tsx directo', () => {
    const vbs = buildVbs('T1', 'C:\\r\\script.ts', 'C:\\root');
    assert.ok(vbs.includes('node.exe') || vbs.includes('node'));
    assert.ok(vbs.includes('--import tsx') && vbs.includes(', 0, False'));
    assert.ok(!vbs.toLowerCase().includes('cmd') && !vbs.toLowerCase().includes('powershell'));
  });
});
