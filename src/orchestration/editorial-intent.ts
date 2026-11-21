/** Recognize explicit editorial requests before generic historical routing. */
export function editorialIntent(task: string): string | undefined {
  const text = task
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/^(?:por favor|please)[, ]+/, '');
  if (
    /^(?:sintetiza|sintetizar|sintetizo|sintetize|unifica|unifique|consolida|consolide|synthesize|synthesise|combine)\b.*\b(?:autores|informacion|informacoes|documentos|fuentes|fontes|relatorios|sources|documents|findings|reports)\b/.test(
      text,
    )
  )
    return 'synthesis';
  if (/^(?:traduce|traducir|traduci|translate|traduza|traduzir)\b/.test(text)) return 'translation';
  if (
    /^(?:resume|resumir|resumi|summarize|summarise|resuma)\b/.test(text) ||
    /^(?:haz|hace|prepara|redacta|dame|make|write|prepare|faca)\s+(?:(?:un|um|a)\s)?(?:resumen|resumo|summary)\b[^.;]{0,80}/.test(
      text,
    )
  )
    return 'summary';
  if (/^(?:transcribe|transcribir|transcreva|transcrever)\b/.test(text)) return 'transcription';
  if (
    /^(?:humaniza|humanizar|humanize|reescribe|reescribir|reescribi|rewrite|reescreva)\b/.test(text)
  )
    return 'rewrite';
  if (
    /^(?:extrae|extraer|extrai|extrair|extract|extracto|extraia)\b.*\b(?:textos?|citas?|quotes?|texts?|trechos?|extractos?|excerpts?)\b/.test(
      text,
    ) ||
    /^(?:dame|prepara|give me|prepare)\s+(?:(?:un|an)\s)?(?:extractos?|excerpts?)\b[^.;]{0,80}/.test(
      text,
    )
  )
    return 'extract';
  if (
    /^(?:convierte|convert|converti|converta|pasa|migra)\b.*\b(?:markdown|docx|word|pdf|texto)\b/.test(
      text,
    )
  )
    return 'conversion';
  if (
    /^(?:redacta|redactar|escribe|escribir|escribi|write|draft|redija|escreva)\b.*\b(?:texto|text|mensaje|mensagem|message|correo|email|narrativa|narrative|guion|script de video|documentacion|documentation|documento|document|informe|report)\b/.test(
      text,
    )
  )
    return 'draft';
  return undefined;
}
