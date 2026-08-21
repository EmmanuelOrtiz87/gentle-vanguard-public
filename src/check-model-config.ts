#!/usr/bin/env npx tsx
/**
 * Simple test without task() - uses direct execution
 * Alternative when task() doesn't work
 */

console.log('=== Alternative test without task() ===\n');
console.log('Current model from config:');

import { readFileSync } from 'fs';

// Check global config
const globalConfig = JSON.parse(
  readFileSync(`${process.env.USERPROFILE}/.config/opencode/opencode.json`, 'utf-8'),
);

console.log('Global config model:', globalConfig.model);
console.log('Global config small_model:', globalConfig.small_model);

// Check project config
const projectConfig = JSON.parse(readFileSync('./opencode.json', 'utf-8'));

console.log('\nProject config orchestrator:', projectConfig.agent.orchestrator.model);
console.log('Project config provider:', projectConfig.agent.orchestrator.provider);

// Check active model
import { existsSync } from 'fs';
const activePath = './.runtime/model-active.json';
if (existsSync(activePath)) {
  const active = JSON.parse(readFileSync(activePath, 'utf-8'));
  console.log('\nActive model:', active.model, '(from', active.source + ')');
}

console.log('\n---');
console.log('If all show "moonshotai/kimi-k2.5" or compatible model,');
console.log('then task() SHOULD work after restart.');
console.log('If showing "inherit-from-session" or errors,');
console.log('then configs need fixing.');
