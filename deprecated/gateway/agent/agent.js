import fs from 'node:fs';
import path from 'node:path';
import { toolDefinitions, executeTool } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { getProjectContext, ConversationHistory } from './context.js';
import { handleIncomingMessage } from './scheduler-integration.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const HISTORY_FILE = path.join(ROOT, '.session', 'gateway', 'agent-history.json');

const AI_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

export class Agent {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.history = new ConversationHistory(50);
    this.running = false;
    this.ctx = getProjectContext();
    this.systemPrompt = buildSystemPrompt(this.ctx);
    this.processing = new Set();
  }

  start() {
    this.running = true;
    this.history.load(HISTORY_FILE);
    this.log('agent: started');
  }

  stop() {
    this.running = false;
    this.history.save(HISTORY_FILE);
    this.log('agent: stopped');
  }

  async processMessage(msgId, platform, from, text, onResponse) {
    if (this.processing.has(msgId)) return;
    this.processing.add(msgId);

    try {
      this.history.add('user', `[${platform} @${from}]: ${text}`);

      const handled = await handleIncomingMessage(this, text, platform, from, onResponse);
      if (handled) {
        this.history.save(HISTORY_FILE);
        return;
      }

      this.ctx = getProjectContext();
      this.systemPrompt = buildSystemPrompt(this.ctx);

      const response = await this.runReAct();
      if (response) {
        this.history.add('assistant', response);
        await onResponse(response);
      }
      this.history.save(HISTORY_FILE);
    } finally {
      this.processing.delete(msgId);
    }
  }

  getConfig() {
    return this.config;
  }

  async runReAct() {
    const ai = this.config.ai;
    if (!ai?.enabled || !ai?.apiKey) return null;

    const maxIterations = this.config.agent?.maxIterations || 10;
    let messages = [{ role: 'system', content: this.systemPrompt }];
    messages.push(...this.history.get());

    for (let i = 0; i < maxIterations; i++) {
      const result = await this.callLLM(messages, ai);
      if (!result) return '❌ Error al contactar el modelo.';

      const { content, toolCalls } = result;

      if (!toolCalls || toolCalls.length === 0) {
        return content || '✅ Listo.';
      }

      messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) });

      for (const tc of toolCalls) {
        const toolResult = await executeTool(tc.name, tc.args, this.log);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });

        if (tc.name === 'send_message') {
          return toolResult.output;
        }
      }
    }

    return '⚠️ Límite de iteraciones alcanzado. Simplificá tu consulta.';
  }

  async callLLM(messages, ai) {
    try {
      if (ai.provider === 'openai' || ai.provider === 'openai-compatible') {
        return await this.callOpenAI(messages, ai);
      }
      if (ai.provider === 'anthropic') {
        return await this.callAnthropic(messages, ai);
      }
      this.log(`agent: unknown provider ${ai.provider}`);
      return null;
    } catch (err) {
      this.log(`agent: LLM error -> ${err.message}`);
      return null;
    }
  }

  async callOpenAI(messages, ai) {
    const body = {
      model: ai.model || 'gpt-4o-mini',
      messages,
      tools: toolDefinitions.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      max_tokens: ai.maxTokens || 2000,
    };

    const endpoint = ai.baseURL ? `${ai.baseURL}/chat/completions` : AI_ENDPOINTS.openai;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.apiKey}`,
      ...ai.headers
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) return null;

    const toolCalls = choice.message?.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    })) || [];

    return { content: choice.message.content, toolCalls };
  }

  async callAnthropic(messages, ai) {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const convMessages = messages.filter(m => m.role !== 'system').map(m => {
      if (m.role === 'tool') {
        return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] };
      }
      if (m.tool_calls) {
        return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })) };
      }
      return { role: m.role, content: m.content };
    });

    const body = {
      model: ai.model || 'claude-3-5-haiku-20241022',
      system: systemMsgs.map(m => m.content).join('\n'),
      messages: convMessages,
      tools: toolDefinitions.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      max_tokens: ai.maxTokens || 2000,
    };

    const res = await fetch(AI_ENDPOINTS.anthropic, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    const topContent = data.content?.[0];
    if (!topContent) return null;

    const toolCalls = data.content
      ?.filter(c => c.type === 'tool_use')
      .map(tc => ({ id: tc.id, name: tc.name, args: tc.input })) || [];

    const text = data.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n') || '';

    return { content: text, toolCalls };
  }
}
