import { open } from 'node:fs/promises';
import { LocalWhisperProvider } from '../../packages/gv-shorts-core/src/providers/whisper-api.js';
import { runSync } from '../core/run-command.js';

function transcribeWithPython(file: string, language: string, model: string) {
  const script = String.raw`
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
def stamp(t):
    msec = round(t * 1000)
    sec, ms = divmod(msec, 1000)
    minutes, sec = divmod(sec, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{sec:02d},{ms:03d}"
pcm = subprocess.run(
    ["ffmpeg", "-nostdin", "-v", "error", "-i", sys.argv[1], "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
    capture_output=True, check=True, timeout=30,
    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
).stdout
model = WhisperModel(sys.argv[3], device="cpu", compute_type="int8")
segments, _ = model.transcribe(np.frombuffer(pcm, dtype="<f4"), language=sys.argv[2], vad_filter=True)
lines = [f"{i}\n{stamp(s.start)} --> {stamp(s.end)}\n{s.text.strip()}" for i, s in enumerate(segments, 1)]
print(json.dumps("\n\n".join(lines)))
`;
  const result = runSync('python', ['-c', script, file, language, model], {
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error)
    throw new Error(
      'faster-whisper local falló. Verificá la instalación, el modelo y su descarga.',
    );
  const srt = JSON.parse(result.stdout);
  if (typeof srt !== 'string' || !srt.trim()) throw new Error('No se detectó habla utilizable.');
  return { srt, provider: 'faster-whisper', verification: 'audio-review-pending' };
}

export async function transcribeEditorialAudio(file: string, language: string) {
  const baseUrl = process.env.GV_SHORTS_WHISPER_URL;
  const localModel = process.env.GV_EDITORIAL_WHISPER_MODEL;
  if (!baseUrl && !localModel)
    throw new Error(
      'Configurá GV_SHORTS_WHISPER_URL o GV_EDITORIAL_WHISPER_MODEL para transcribir audio.',
    );
  const handle = await open(file, 'r');
  let audioBytes: Buffer;
  try {
    const { size } = await handle.stat();
    if (size < 12 || size > 25 * 1024 * 1024) throw new Error('Se requiere WAV de hasta 25 MiB.');
    audioBytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (
    audioBytes.toString('ascii', 0, 4) !== 'RIFF' ||
    audioBytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('El proveedor editorial requiere un archivo WAV.');
  if (!baseUrl) return transcribeWithPython(file, language, localModel!);
  const provider = new LocalWhisperProvider({
    baseUrl,
    model: process.env.GV_SHORTS_WHISPER_LOCAL_MODEL,
    apiKey: process.env.GV_SHORTS_WHISPER_KEY,
    fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(90_000) }),
  });
  try {
    const result = await provider.align({
      audioBytes,
      audioPath: file,
      text: 'Transcripción literal del audio. Conserva nombres y cifras.',
      lang: language,
      engine: 'faster-whisper',
    });
    if (!result.srt.trim() || result.durationMs <= 0)
      throw new Error('El proveedor no devolvió segmentos utilizables.');
    return { srt: result.srt, provider: provider.name, verification: 'audio-review-pending' };
  } catch {
    if (localModel) return transcribeWithPython(file, language, localModel);
    throw new Error('El servidor Whisper no entregó segmentos utilizables.');
  }
}
