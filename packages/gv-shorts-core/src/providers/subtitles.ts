/**
 * @gentle-vanguard/gv-shorts-core/providers/subtitles — Whisper aligned SRT.
 *
 * Wrapper sobre whisper-node (bindings nativos de whisper.cpp — corre local en CPU).
 *
 * Diseño:
 *   - Genera SRT burned-in listo para ffmpeg.
 *   - Modelo descargable on-demand (whisper-node lo baja la primera vez).
 *   - Si whisper-node no puede correr (binario no disponible para esta plataforma),
 *     fallback a API externa (OpenAI Whisper / Gemini) implementada en FASE 2.
 *
 * Modelo default: 'base' (~74MB, multilingüe). Tamaños disponibles:
 *   tiny (~39MB), base (~74MB), small (~244MB), medium (~769MB), large-v3 (~1550MB).
 *
 * Estado: el wrapper está implementado pero `whisper-node` requiere binarios pre-compilados
 * que no siempre están disponibles para todas las plataformas. Si el binario falla, el
 * provider lanza un error claro con instrucciones para el fallback.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { SubtitlesConfig, SubtitlesResult } from '../types.js';

export class WhisperProvider {
  readonly name: string;
  private readonly modelPath: string;

  constructor(opts: { modelPath?: string; name?: string } = {}) {
    this.name = opts.name ?? 'whisper-local';
    this.modelPath = opts.modelPath ?? path.join(os.tmpdir(), 'gv-whisper-models');
  }

  async align(config: SubtitlesConfig): Promise<SubtitlesResult> {
    if (!config.audioPath) {
      throw new Error('audioPath is required');
    }
    if (!config.text) {
      throw new Error('text is required');
    }

    // Verificar que el audio existe
    try {
      await fs.access(config.audioPath);
    } catch {
      throw new Error(`audio not found: ${config.audioPath}`);
    }

    // Lazy import whisper-node — si el binario nativo no está disponible, falla claro
    type WhisperBinding = {
      getModelPath?: (model: string) => Promise<string> | string;
      whisper?: (
        audioPath: string,
        opts: { modelName: string; autoDownload?: boolean; language?: string },
      ) => Promise<{
        result: Array<{ start: string; end: string; speech: string }>;
      }>;
    };
    let whisperNode: WhisperBinding;
    try {
      whisperNode = (await import('whisper-node')).default as WhisperBinding;
    } catch (err) {
      throw new Error(
        `whisper-node native binding not available: ${(err as Error).message}. ` +
          'Run `npx whisper-node download` to fetch models, or use OpenAI/Gemini API fallback.',
      );
    }

    await fs.mkdir(this.modelPath, { recursive: true });

    const modelName = config.modelSize ?? 'base';

    // whisper-node API surface (per docs):
    //   whisperNode.getModelPath(modelName) → string
    //   whisperNode.whisper(audioPath, options) → Promise<{ result: TranscriptionSegment[] }>
    type WhisperModule = {
      getModelPath?: (model: string) => Promise<string> | string;
      whisper?: (
        audioPath: string,
        opts: { modelName: string; autoDownload?: boolean; language?: string },
      ) => Promise<{
        result: Array<{ start: string; end: string; speech: string }>;
      }>;
    };
    const wn = whisperNode as unknown as WhisperModule;
    if (typeof wn.whisper !== 'function') {
      throw new Error(
        'whisper-node.whisper() not exported in this version. ' +
          'Check the installed version or use OpenAI/Gemini API fallback.',
      );
    }

    const transcription = await wn.whisper(config.audioPath, {
      modelName,
      autoDownload: true,
      language: config.lang,
    });

    // Convertir transcripción a SRT
    const srt = transcriptionToSrt(transcription.result);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-srt-'));
    const srtPath = path.join(tmpDir, `subtitles-${Date.now()}.srt`);
    await fs.writeFile(srtPath, srt, 'utf8');

    // Duración total = última entry end
    const lastEnd = transcription.result.at(-1)?.end ?? '0';
    const durationMs = parseSrtTimestamp(lastEnd);

    return {
      path: srtPath,
      srt,
      durationMs,
      engine: 'faster-whisper',
    };
  }
}

// ─── SRT conversion ────────────────────────────────────────────────────────

interface TranscriptionSegment {
  start: string;
  end: string;
  speech: string;
}

function transcriptionToSrt(segments: TranscriptionSegment[]): string {
  return segments
    .map((seg, idx) => {
      const startMs = parseSrtTimestamp(seg.start);
      const endMs = parseSrtTimestamp(seg.end);
      return `${idx + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${seg.speech.trim()}\n`;
    })
    .join('\n');
}

/** Parse SRT timestamp "HH:MM:SS,mmm" or Whisper "HH:MM:SS.mmm" → ms. */
export function parseSrtTimestamp(ts: string): number {
  const normalized = ts.replace('.', ',');
  const match = normalized.match(/^(\d+):(\d{2}):(\d{2}),(\d{1,3})$/);
  if (!match) {
    // Try seconds-only "12.345"
    const secMatch = ts.match(/^(\d+(?:\.\d+)?)$/);
    if (secMatch) return Math.round(parseFloat(secMatch[1]!) * 1000);
    return 0;
  }
  const [, h, m, s, ms] = match;
  return (
    parseInt(h!, 10) * 3_600_000 +
    parseInt(m!, 10) * 60_000 +
    parseInt(s!, 10) * 1000 +
    parseInt((ms ?? '0').padEnd(3, '0').slice(0, 3), 10)
  );
}

/** Format ms → "HH:MM:SS,mmm". */
export function formatSrtTimestamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(millis, 3)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}