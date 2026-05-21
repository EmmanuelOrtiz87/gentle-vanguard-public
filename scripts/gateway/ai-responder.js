const AI_PROVIDER = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

export async function generateReply(cfg, msg, log) {
  const ai = cfg.ai;
  if (!ai?.enabled || !ai?.provider || !ai?.apiKey) return null;

  const systemPrompt = ai.systemPrompt || 'Eres un asistente. Respondé de forma clara y concisa.';

  try {
    if (ai.provider === 'openai') {
      const res = await fetch(AI_PROVIDER.openai, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({
          model: ai.model || 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: msg }],
          max_tokens: ai.maxTokens || 500,
        }),
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    }

    if (ai.provider === 'anthropic') {
      const res = await fetch(AI_PROVIDER.anthropic, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ai.model || 'claude-3-haiku-20240307',
          system: systemPrompt,
          messages: [{ role: 'user', content: msg }],
          max_tokens: ai.maxTokens || 500,
        }),
      });
      const data = await res.json();
      return data.content?.[0]?.text?.trim() || null;
    }

    return null;
  } catch (err) {
    log(`ai-responder: error -> ${err.message}`);
    return null;
  }
}
