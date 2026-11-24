/**
 * @gentle-vanguard/gv-shorts-core/providers/whisper-api — Whisper via OpenAI/Gemini API.
 *
 * Whisper-node (whisper.cpp bindings) requires native binaries + `make` + shell scripts —
 * flaky on Windows. This provider uses HTTP APIs that work everywhere with just an API key.
 *
 * Two adapters:
 *  - OpenAIWhisperProvider: $0.006/min, multilingual, response_format=srt
 *  - GeminiWhisperProvider: free tier available, response_format=text (need to convert to SRT)
 *
 * Router picks first configured provider in priority order; cooldown on 429/5xx.
 *
 * Why this and not lib-fusion:
 *   - whisper-node is Apache 2.0 but requires build tools (out-of-band)
 *   - API-based path is 0-dep, deterministic, testable with fetch
 *   - Cost is negligible: 30s short × $0.006/min × 100/mo = $0.30/mo
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SubtitlesResult, SubtitlesConfig } from '../types.js';
import { parseSrtTimestamp, formatSrtTimestamp } from './subtitles.js';

export interface WhisperApiProvider {
  readonly name: string;
  /** Returns SRT content + path. Throws on unrecoverable error. */
  align(config: SubtitlesConfig & { audioBytes: Buffer }): Promise<SubtitlesResult>;
}

// ─── OpenAI Whisper API ────────────────────────────────────────────────────

export class OpenAIWhisperProvider implements WhisperApiProvider {
  readonly name = 'openai-whisper';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'whisper-1';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async align(config: SubtitlesConfig & { audioBytes: Buffer }): Promise<SubtitlesResult> {
    if (!config.audioBytes || config.audioBytes.length === 0) {
      throw new Error('audioBytes is required and must be non-empty');
    }
    if (!config.text) {
      throw new Error('text is required (used as prompt/context for alignment)');
    }

    // Multipart form data — Node 20+ has FormData + File native built-ins.
    // Copy the bytes into a fresh ArrayBuffer to avoid the ArrayBufferLike (potentially SharedArrayBuffer)
    // type confusion in Blob's BlobPart.
    const ab = new ArrayBuffer(config.audioBytes.byteLength);
    new Uint8Array(ab).set(config.audioBytes);
    const blob = new Blob([ab], { type: 'audio/wav' });
    const form = new FormData();
    form.append('file', blob, 'audio.wav');
    form.append('model', this.model);
    form.append('response_format', 'srt');
    form.append('language', config.lang ?? 'es');
    // `prompt` parameter helps the model stay on topic (improves alignment).
    // Cap at 224 tokens (~1000 chars) per OpenAI docs.
    if (config.text) {
      form.append('prompt', config.text.slice(0, 1000));
    }

    const res = await this.fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(
        `openai-whisper ${res.status}: ${text.slice(0, 300)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const srt = (await res.text()) as string;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-srt-'));
    const srtPath = path.join(tmpDir, `subtitles-${Date.now()}.srt`);
    await fs.writeFile(srtPath, srt, 'utf8');

    // Parse duration from the last entry's end timestamp
    const entries = parseSrtEntries(srt);
    const lastEnd = entries.at(-1)?.end ?? '00:00:00,000';
    const durationMs = parseSrtTimestamp(lastEnd);

    return {
      path: srtPath,
      srt,
      durationMs,
      // Use config.engine as authoritative (caller decides what to report in metadata).
      engine: config.engine,
    };
  }
}

// ─── Local Whisper (whisper.cpp / faster-whisper OpenAI-compatible) ─────────

/**
 * Provider 100% local: habla con un server local que exponga el shape
 * OpenAI `/v1/audio/transcriptions` con `response_format=srt`. Compatible con:
 *   - whisper.cpp `server` (-O srt), faster-whisper-server, Speaches, etc.
 * Se activa con GV_SHORTS_WHISPER_URL y tiene PRIORIDAD sobre OpenAI (gratis,
 * sin red externa). Sin API key requerida (opcional Bearer si el server la pide).
 */
export class LocalWhisperProvider implements WhisperApiProvider {
  readonly name = 'local-whisper';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    baseUrl: string;
    model?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model ?? 'whisper-1';
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async align(config: SubtitlesConfig & { audioBytes: Buffer }): Promise<SubtitlesResult> {
    if (!config.audioBytes || config.audioBytes.length === 0) {
      throw new Error('audioBytes is required and must be non-empty');
    }
    if (!config.text) {
      throw new Error('text is required (used as prompt/context for alignment)');
    }

    // Multipart idéntico al OpenAI API (el shape es el mismo contrato).
    const ab = new ArrayBuffer(config.audioBytes.byteLength);
    new Uint8Array(ab).set(config.audioBytes);
    const blob = new Blob([ab], { type: 'audio/wav' });
    const form = new FormData();
    form.append('file', blob, 'audio.wav');
    form.append('model', this.model);
    form.append('response_format', 'srt');
    form.append('language', config.lang ?? 'es');
    if (config.text) {
      form.append('prompt', config.text.slice(0, 1000));
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(
        `local-whisper ${res.status}: ${text.slice(0, 300)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const srt = (await res.text()) as string;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-srt-'));
    const srtPath = path.join(tmpDir, `subtitles-${Date.now()}.srt`);
    await fs.writeFile(srtPath, srt, 'utf8');

    const entries = parseSrtEntries(srt);
    const lastEnd = entries.at(-1)?.end ?? '00:00:00,000';
    const durationMs = parseSrtTimestamp(lastEnd);

    return {
      path: srtPath,
      srt,
      durationMs,
      engine: config.engine,
    };
  }
}

// ─── SRT entry parsing ─────────────────────────────────────────────────────

interface SrtEntry {
  index: number;
  start: string;
  end: string;
  text: string;
}

function parseSrtEntries(srt: string): SrtEntry[] {
  const blocks = srt.trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const index = Number(lines[0]);
      const [start, end] = (lines[1] ?? '00:00:00,000 --> 00:00:00,000').split(' --> ');
      const text = lines.slice(2).join('\n').trim();
      if (!Number.isFinite(index) || !start || !end) return null;
      return { index, start: start.trim(), end: end.trim(), text };
    })
    .filter((e): e is SrtEntry => e !== null);
}

// ─── WhisperRouter (multi-provider with failover) ──────────────────────────

export interface WhisperRouterConfig {
  providers: WhisperApiProvider[];
  cooldownMs?: number;
}

export class WhisperRouter {
  private readonly providers: WhisperApiProvider[];
  private readonly cooldown: Map<string, number> = new Map();
  private readonly cooldownMs: number;

  constructor(config: WhisperRouterConfig) {
    if (config.providers.length === 0) {
      throw new Error('WhisperRouter: at least one provider is required');
    }
    this.providers = config.providers;
    this.cooldownMs = config.cooldownMs ?? 60_000;
  }

  async align(input: SubtitlesConfig & { audioBytes: Buffer }): Promise<SubtitlesResult> {
    for (const provider of this.providers) {
      const cooldownUntil = this.cooldown.get(provider.name) ?? 0;
      if (Date.now() < cooldownUntil) continue;

      try {
        return await provider.align(input);
      } catch (err) {
        const error = err as Error & { status?: number };
        if (isRecoverable(error)) {
          this.cooldown.set(provider.name, Date.now() + this.cooldownMs);
          // try the next provider
          continue;
        }
        // Non-recoverable: stop and surface the error (don't failover — bad prompt, etc).
        throw err;
      }
    }
    throw new Error('WhisperRouter: all providers in cooldown or failed');
  }
}

function isRecoverable(err: Error & { status?: number }): boolean {
  if (!err.status) return true; // network
  return [429, 500, 502, 503, 504].includes(err.status);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export { parseSrtTimestamp, formatSrtTimestamp };