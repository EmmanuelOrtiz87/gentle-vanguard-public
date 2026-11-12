/**
 * CONTRATO del release de instalador (BL-MW2P528K-HQ5Y).
 *
 * Protege la decision "un solo producto .exe": si alguien vuelve a publicar el
 * launcher SEA junto al Setup NSIS, o publica dos instaladores en un mismo
 * release, este test lo tiene que ver antes que un usuario confundido.
 *
 * Ejecutar: node --import tsx --test src/release/installer-release-contract.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateInstallerAssets,
  parseSha256File,
  digestMatches,
} from './installer-release-contract.js';

describe('evaluateInstallerAssets', () => {
  it('acepta un unico instalador con su checksum', () => {
    const result = evaluateInstallerAssets([
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe' },
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe.sha256' },
    ]);
    assert.equal(result.verdict, 'ok');
    assert.equal(result.setup?.name, 'Gentle-Vanguard-Setup-4.4.0.exe');
    assert.equal(result.checksum?.name, 'Gentle-Vanguard-Setup-4.4.0.exe.sha256');
  });

  it('rechaza el release con launcher SEA junto al instalador', () => {
    const result = evaluateInstallerAssets([
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe' },
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe.sha256' },
      { name: 'gentle-vanguard-launcher-4.4.0.exe' },
    ]);
    assert.equal(result.verdict, 'duplicate-product');
    assert.deepEqual(result.launchers, ['gentle-vanguard-launcher-4.4.0.exe']);
    assert.match(result.detail, /launcher/);
  });

  it('rechaza dos instaladores compitiendo', () => {
    const result = evaluateInstallerAssets([
      { name: 'Gentle-Vanguard-Setup-4.3.1.exe' },
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe' },
    ]);
    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.extraSetups.length, 1);
  });

  it('rechaza un release sin instalador', () => {
    const result = evaluateInstallerAssets([{ name: 'update-manifest.json' }]);
    assert.equal(result.verdict, 'missing');
  });

  it('rechaza un instalador sin checksum publicado', () => {
    const result = evaluateInstallerAssets([{ name: 'Gentle-Vanguard-Setup-4.4.0.exe' }]);
    assert.equal(result.verdict, 'checksum-missing');
  });

  it('no confunde un .exe de otra app con el instalador del stack', () => {
    const result = evaluateInstallerAssets([
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe' },
      { name: 'Gentle-Vanguard-Setup-4.4.0.exe.sha256' },
      { name: 'gv-agenda-0.3.0.exe' },
    ]);
    assert.equal(result.verdict, 'ok');
  });
});

describe('parseSha256File', () => {
  it('acepta hash solo y hash con nombre', () => {
    const hash = 'a'.repeat(64);
    assert.equal(parseSha256File(hash), hash);
    assert.equal(parseSha256File(`${hash}  Gentle-Vanguard-Setup-4.4.0.exe\n`), hash);
  });

  it('rechaza contenido invalido', () => {
    assert.equal(parseSha256File('no soy un hash'), null);
    assert.equal(parseSha256File(''), null);
  });
});

describe('digestMatches', () => {
  it('ignora mayusculas y espacios', () => {
    assert.equal(digestMatches('ABC123', ' abc123 '), true);
    assert.equal(digestMatches('abc123', 'abc124'), false);
  });
});
