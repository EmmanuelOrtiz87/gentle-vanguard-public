/**
 * Provider Connection Hub — inventario seguro y agnóstico de credenciales.
 *
 * This module never reads passwords, cookies or full secrets. It only reports
 * whether an official API env var, a local CLI or an explicit local setting is
 * available. OAuth adapters can be added without changing consumers.
 */
import { spawnSync } from 'child_process';

export type ProviderConnection = 'local' | 'cli' | 'api' | 'oauth' | 'unavailable';
export type ProviderState = 'ready' | 'needs-credential' | 'needs-oauth' | 'not-detected';

export interface ProviderStatus {
  id: string;
  label: string;
  connection: ProviderConnection;
  state: ProviderState;
  configured: boolean;
  source: string;
  model?: string;
  note: string;
}

function present(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

function cliAvailable(command: string): boolean {
  try {
    const result = spawnSync(command, ['--version'], {
      timeout: 3500,
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export interface ProviderHubInput {
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  stackModel?: string;
}

export function listProviderStatuses(input: ProviderHubInput = {}): ProviderStatus[] {
  const opencode = cliAvailable(process.env.GV_OPENCODE_BIN || 'opencode');
  const openaiKey = process.env.CONTENT_LLM_API_KEY || input.openaiApiKey;
  const openaiBase = process.env.CONTENT_LLM_BASE_URL || input.openaiBaseUrl;
  const geminiKey = process.env.GEMINI_API_KEY || input.geminiApiKey;
  const anthropic = present(process.env.ANTHROPIC_API_KEY);
  const minimax = present(process.env.MINIMAX_API_KEY);
  const zai = present(process.env.ZAI_API_KEY, process.env.GLM_API_KEY);
  const copilot = cliAvailable('gh');

  return [
    {
      id: 'opencode',
      label: 'OpenCode',
      connection: 'cli',
      state: opencode ? 'ready' : 'not-detected',
      configured: opencode,
      source: opencode ? 'sesión local / oc-keyring' : 'CLI no detectado',
      model: input.stackModel,
      note: opencode
        ? 'Usa la cuenta activa del CLI. Rotación con oc-keyring.'
        : 'Instalá o configurá el CLI de OpenCode.',
    },
    {
      id: 'google-account',
      label: 'Cuenta Google',
      connection: 'oauth',
      state: 'needs-oauth',
      configured: false,
      source: 'OAuth oficial aún no vinculado a Content OS',
      note: 'El login Google identifica la cuenta, pero Gemini requiere una autorización de API compatible.',
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      connection: 'api',
      state: geminiKey ? 'ready' : 'needs-credential',
      configured: Boolean(geminiKey),
      source: geminiKey ? 'API key local/env' : 'sin API key',
      model: input.geminiModel,
      note: geminiKey
        ? 'Validar modelos disponibles antes de generar.'
        : 'Google login no reemplaza una credencial de Gemini API.',
    },
    {
      id: 'openai',
      label: 'OpenAI-compatible',
      connection: 'api',
      state: openaiKey && openaiBase ? 'ready' : 'needs-credential',
      configured: Boolean(openaiKey && openaiBase),
      source: openaiKey && openaiBase ? 'base URL + key local/env' : 'falta base URL o key',
      model: input.openaiModel,
      note: 'Requiere endpoint y credencial compatibles con la API seleccionada.',
    },
    {
      id: 'anthropic',
      label: 'Claude / Anthropic',
      connection: 'api',
      state: anthropic ? 'ready' : 'needs-credential',
      configured: anthropic,
      source: anthropic ? 'ANTHROPIC_API_KEY' : 'sin API key',
      note: 'Disponible mediante API oficial; login de Claude no se reutiliza.',
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      connection: 'api',
      state: minimax ? 'ready' : 'needs-credential',
      configured: minimax,
      source: minimax ? 'MINIMAX_API_KEY' : 'sin API key',
      note: 'Adaptador API pendiente de activación en CMS.',
    },
    {
      id: 'zai',
      label: 'z.ai / GLM',
      connection: 'api',
      state: zai ? 'ready' : 'needs-credential',
      configured: zai,
      source: zai ? 'ZAI_API_KEY / GLM_API_KEY' : 'sin API key',
      note: 'Adaptador API pendiente de activación en CMS.',
    },
    {
      id: 'github-copilot',
      label: 'GitHub Copilot',
      connection: 'oauth',
      state: copilot ? 'needs-oauth' : 'not-detected',
      configured: false,
      source: copilot ? 'GitHub CLI detectado' : 'GitHub CLI no detectado',
      note: 'El login de GitHub no se convierte automáticamente en API de Copilot.',
    },
    {
      id: 'local',
      label: 'GV local',
      connection: 'local',
      state: 'ready',
      configured: true,
      source: 'runtime local',
      note: 'Fallback sin cuenta externa, red ni cuota de proveedor.',
    },
  ];
}
