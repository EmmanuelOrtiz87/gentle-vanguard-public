/** Public request contracts; generation providers stay in the private product. */
export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
export type Aspect = '9:16' | '4:5' | '1:1' | '16:9';

export interface ShortRequest {
  /** Brief en lenguaje natural (>= 10 chars) */
  brief: string;
  /** Plataforma destino (define formato, duración máx, hashtags default) */
  platform: Platform;
  /** Aspect ratio del output */
  aspect: Aspect;
  /** Duración objetivo en segundos (clamp: 5-180) */
  durationSec: number;
  /** Provider LLM preferido (override del router default) */
  llm?: string;
  /** Provider TTS preferido (override del router default) */
  tts?: string;
  /** Providers de stock footage a usar */
  stock?: Array<'pexels' | 'pixabay' | 'openverse'>;
  /** Referencia a voz clonada (si voice cloning está habilitado) */
  voice?: string | null;
  /**
   * ID de un voice sample del Voice Studio nativo (apps/voice-studio).
   * Si está set, el ShortsRunner consulta `/api/voice-studio/samples/:id` y usa
   * el engine configurado (coqui-xtts / openvoice-v2 / f5-tts) en vez de Edge.
   * Mutuamente excluyente con `voice` (uno u otro).
   */
  voiceSampleId?: string;
  /** Bed musical opcional */
  bgm?: BgmSpec | null;
  /** Branding overlay (tokens del design system) */
  branding?: BrandingSpec | null;
}

export interface BgmSpec {
  /** 'gv-music' = track local de apps/gv-music, 'url' = URL externa, 'none' = sin BGM */
  source: 'gv-music' | 'url' | 'none';
  /** Track ID (si source = 'gv-music') */
  trackId?: string;
  /** Ruta local resuelta por el manifiesto de exportación de GV Music. */
  path?: string;
  /** URL (si source = 'url') */
  url?: string;
  /** Gain en dB (default -12, clamp -30..0) */
  gainDb?: number;
}

export interface BrandingSpec {
  /** Path a tokens del design system (relative a packages/gv-design-system/dist) */
  tokensPath: string;
  /** Path al asset raster del logo que FFmpeg debe sobreimprimir. */
  logoPath?: string;
  /** Posición del watermark (default 'bottom-right') */
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'none';
  /** Mostrar logo overlay */
  showLogo?: boolean;
  /** Opacidad del logo (0..1, default 0.86). */
  opacity?: number;
  /** Ancho del logo en px (default: 18% del ancho del video). */
  widthPx?: number;
  /** Margen del logo en px (default 32). */
  marginPx?: number;
}

