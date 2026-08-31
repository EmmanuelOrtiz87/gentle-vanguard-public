import {
  compressPrompt,
  CompressionResult as PromptCompressionResult,
} from '../../compression/prompt-compression.js';
import {
  compressOutput,
  CompressionResult as OutputCompressionResult,
} from '../../compression/output-compression.js';
import {
  enforceChatLevel,
  ChatLevelEnforcementResult,
  ChatLevel,
} from '../../orchestration/chat-level-enforcer.js';
import { ResponseCache } from '../../resilience/response-cache.js';

export function optimizePrompt(prompt: string, skill?: string): PromptCompressionResult {
  return compressPrompt(prompt, skill ?? 'default');
}

export function optimizeResponse(
  response: string,
  chatLevel: ChatLevel = 'chat-compact',
  profile?: 'ultra' | 'lleno' | 'lite' | 'simple',
): { chatEnforcement: ChatLevelEnforcementResult; outputCompression: OutputCompressionResult } {
  const chatEnforcement = enforceChatLevel(response, chatLevel);
  const outputCompression = compressOutput(chatEnforcement.enforced, profile ?? 'auto');

  return { chatEnforcement, outputCompression };
}

export function checkCache(prompt: string, context?: string): { hit: boolean; response?: string } {
  const cache = new ResponseCache();
  const cached = cache.get(prompt, context ?? '');
  return { hit: !!cached, response: cached?.response };
}
