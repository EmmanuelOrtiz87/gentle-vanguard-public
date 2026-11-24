/**
 * Minimal type declarations for whisper-node (no @types/whisper-node on npm).
 * Source: https://github.com/ariym/whisper-node README + inference from `dist/index.d.ts`.
 *
 * Cubrimos solo lo que usamos en providers/subtitles.ts:
 *   - whisper(audioPath, options) → Promise<{ result: TranscriptionSegment[] }>
 *   - getModelPath(modelName) → string
 */

declare module 'whisper-node' {
  export interface TranscriptionSegment {
    start: string;
    end: string;
    speech: string;
  }

  export interface WhisperOptions {
    modelName: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
    autoDownload?: boolean;
    language?: string;
    threads?: number;
  }

  export interface WhisperResult {
    result: TranscriptionSegment[];
  }

  export function getModelPath(modelName: string): string;
  export function whisper(audioPath: string, options: WhisperOptions): Promise<WhisperResult>;

  const whisperNode: {
    getModelPath: typeof getModelPath;
    whisper: typeof whisper;
  };
  export default whisperNode;
}