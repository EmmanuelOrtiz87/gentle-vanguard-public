/**
 * @gentle-vanguard/gv-shorts-core/types — interfaces del pipeline.
 *
 * Fase 0 — solo tipos. Las implementaciones viven en:
 *   - pipeline.ts        (orquestador)
 *   - providers/llm.ts   (multi-provider LLM router)
 *   - providers/tts.ts   (multi-provider TTS router)
 *   - providers/stock.ts (stock footage fetcher)
 *   - providers/subtitles.ts (Whisper aligned)
 *   - composer.ts         (ffmpeg determinista)
 *   - queue.ts           (job queue local)
 */

// ─── Pipeline input/output ─────────────────────────────────────────────────

import type { ShortRequest, Aspect, BgmSpec, BrandingSpec } from '../../shared/src/short-request.js';
export type { ShortRequest, Platform, Aspect, BgmSpec, BrandingSpec } from '../../shared/src/short-request.js';

export interface ShortResult {
  /** Path al mp4 final */
  mp4Path: string;
  /** Path al SRT (subtítulos aligned) */
  srtPath: string;
  /** Path al script JSON (input del LLM + output) */
  scriptPath: string;
  /** Metadata para audit/debug */
  metadata: ShortMetadata;
}

export interface ShortMetadata {
  durationMs: number;
  ffmpegArgs: string[];
  /** Cost is populated only when provider usage and a configured price are both present. */
  costUsd?: number;
  providerUsage: Array<{
    provider: string;
    kind: 'llm' | 'tts' | 'stock' | 'subtitles' | 'compose' | 'pipeline';
    durationMs: number;
    /** Duración del medio generado, distinta del tiempo de ejecución. */
    mediaDurationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    bytes?: number;
  }>;
  failovers: Array<{
    from: string;
    to: string;
    reason: string;
    at: string;
  }>;
  warnings: string[];
}

// ─── LLM router ────────────────────────────────────────────────────────────

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: { system: string; prompt: string; maxTokens?: number }): Promise<string | LlmProviderResponse>;
}

export interface LlmProviderResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmRouterConfig {
  providers: Array<{
    name: string;
    apiKey: string;
    model: string;
    priority: number;
    pricing?: { inputUsdPerMillion: number; outputUsdPerMillion: number };
  }>;
  onFailover?: (from: string, to: string, err: Error) => void;
  onSuccess?: (provider: string, durationMs: number) => void;
  cooldownMs?: number;
}

// ─── TTS router ────────────────────────────────────────────────────────────

export interface TtsProvider {
  readonly name: string;
  /**
   * instructions: control de delivery en lenguaje natural (solo engines que lo
   * soportan — ej. Voicebox/OpenAI-compat con Qwen; los demás lo ignoran).
   */
  synthesize(input: { text: string; voice?: string; lang?: string; instructions?: string }): Promise<TtsResult>;
}

export interface TtsResult {
  wavPath: string;
  durationMs: number;
  provider: string;
  voice: string;
}

// ─── Stock footage ─────────────────────────────────────────────────────────

export interface StockClip {
  source: 'pexels' | 'pixabay' | 'openverse';
  query: string;
  videoPath: string;
  durationMs: number;
  attribution: { author: string; url: string };
}

export interface StockConfig {
  sources: Array<'pexels' | 'pixabay' | 'openverse'>;
  cacheDir: string;
  apiKeys?: Partial<Record<'pexels' | 'pixabay', string>>;
}

// ─── Subtitles ─────────────────────────────────────────────────────────────

export interface SubtitlesConfig {
  audioPath: string;
  text: string;
  lang: string;
  engine: 'faster-whisper' | 'openai-whisper-api' | 'gemini-api';
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
}

export interface SubtitlesResult {
  path: string;
  srt: string;
  durationMs: number;
  engine: string;
}

// ─── Composer (ffmpeg) ─────────────────────────────────────────────────────

export interface ComposeConfig {
  clips: StockClip[];
  audio: TtsResult;
  srt: SubtitlesResult;
  bgm: BgmSpec | null;
  branding: BrandingSpec | null;
  output: {
    path: string;
    aspect: Aspect;
    fps: number;
    durationSec: number;
    codec: 'h264' | 'h265' | 'vp9';
    bitrate: string;
  };
}

export interface ComposeResult {
  path: string;
  durationMs: number;
  ffmpegArgs: string[];
}

// ─── Job queue ─────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'active' | 'done' | 'failed' | 'dead';

export interface ShortJob {
  id: string;
  request: ShortRequest;
  status: JobStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  result?: ShortResult;
  createdAt: string;
  updatedAt: string;
}
