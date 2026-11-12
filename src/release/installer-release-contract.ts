/**
 * installer-release-contract.ts — un solo producto .exe por release.
 *
 * EL PROBLEMA QUE RESUELVE (BL-MW2P528K-HQ5Y)
 * El pipeline publicaba DOS binarios distintos con nombres casi iguales:
 *   - SEA launcher:  `gentle-vanguard-launcher-<v>.exe` (job build-installer)
 *   - NSIS setup:    `Gentle-Vanguard-Setup-<v>.exe`    (job build-nsis-installer)
 * Un usuario que descarga "el .exe" puede terminar con el launcher, y dos
 * builds del mismo nombre en distintos entornos producian shas distintos (el
 * caso real de 4.3.0: build local 77 MB vs release oficial).
 *
 * LA REGLA
 *   - Exactamente UN asset `Gentle-Vanguard-Setup-<semver>.exe`.
 *   - Su checksum `<asset>.sha256` viaja en el mismo release.
 *   - NINGUN asset de launcher: el instalador es el unico producto publicado.
 *
 * Este contrato es puro (sin red, sin disco): la workflow le pasa la lista de
 * assets del release y el veredicto decide si se califica o se aborta.
 */

export interface ReleaseAsset {
  name: string;
  /** Tamano en bytes, cuando la API lo informa. */
  size?: number;
}

type InstallerContractVerdict =
  | 'ok'
  | 'missing'
  | 'ambiguous'
  | 'duplicate-product'
  | 'checksum-missing';

export interface InstallerContract {
  verdict: InstallerContractVerdict;
  /** Asset del instalador elegido (solo si verdict === 'ok'). */
  setup?: ReleaseAsset;
  /** Asset del checksum publicado. */
  checksum?: ReleaseAsset;
  /** Assets de launcher detectados (violacion de producto unico). */
  launchers: string[];
  /** Otros assets Setup cuando hay mas de uno (ambiguedad). */
  extraSetups: string[];
  detail: string;
}

const SETUP_RE = /^Gentle-Vanguard-Setup-\d+\.\d+\.\d+\.exe$/;
const LAUNCHER_RE = /^gentle-vanguard-launcher[-.\w]*\.exe$/i;

/**
 * Evalua la lista de assets de un release contra el contrato de producto unico.
 * El orden de las violaciones es deliberado: primero se detecta el producto
 * duplicado porque es la causa raiz, despues la ambiguedad, despues la falta.
 */
export function evaluateInstallerAssets(assets: ReleaseAsset[]): InstallerContract {
  const names = assets.map((a) => a.name);
  const launchers = names.filter((name) => LAUNCHER_RE.test(name));
  const setups = assets.filter((a) => SETUP_RE.test(a.name));

  if (launchers.length > 0) {
    return {
      verdict: 'duplicate-product',
      launchers,
      extraSetups: setups.map((s) => s.name),
      detail: `el release publica un launcher ademas del instalador: ${launchers.join(', ')}`,
    };
  }

  if (setups.length === 0) {
    return {
      verdict: 'missing',
      launchers: [],
      extraSetups: [],
      detail: 'no hay asset Gentle-Vanguard-Setup-<semver>.exe en el release',
    };
  }

  if (setups.length > 1) {
    return {
      verdict: 'ambiguous',
      launchers: [],
      extraSetups: setups.map((s) => s.name).slice(1),
      detail: `${setups.length} instaladores compiten en el mismo release: ${setups
        .map((s) => s.name)
        .join(', ')}`,
    };
  }

  const setup = setups[0];
  const checksum = assets.find((a) => a.name === `${setup.name}.sha256`);
  if (!checksum) {
    return {
      verdict: 'checksum-missing',
      setup,
      launchers: [],
      extraSetups: [],
      detail: `falta ${setup.name}.sha256 en el release`,
    };
  }

  return {
    verdict: 'ok',
    setup,
    checksum,
    launchers: [],
    extraSetups: [],
    detail: `un instalador (${setup.name}) con checksum publicado`,
  };
}

/**
 * Valida el contenido de un archivo `.sha256` (formato `HASH` o `HASH  nombre`).
 * Devuelve el hash en minusculas o null si no es un SHA-256 valido.
 */
export function parseSha256File(content: string): string | null {
  const first = content.trim().split(/\r?\n/)[0] ?? '';
  const hash = first.split(/\s+/)[0]?.toLowerCase() ?? '';
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** Compara el hash calculado con el publicado (case-insensitive). */
export function digestMatches(computed: string, published: string): boolean {
  return computed.trim().toLowerCase() === published.trim().toLowerCase();
}
