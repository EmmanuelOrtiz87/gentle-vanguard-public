#!/usr/bin/env node
// This file is a module to avoid global scope conflicts
export {};

interface ScanSkillHookArgs {
  stagedFiles: string;
}

function parseArgs(): ScanSkillHookArgs {
  const args = process.argv.slice(2);
  let stagedFiles = '';
  const idx = args.indexOf('--staged-files');
  if (idx !== -1 && idx + 1 < args.length) stagedFiles = args[idx + 1];
  return { stagedFiles };
}

// scan-skill.ps1 was removed during Phase 1 cleanup.
// Skill validation is now handled by karpathy-enforcer and skill-scan hooks.

function main(): void {
  parseArgs(); // consume args for compatibility
  process.exit(0);
}

void main();
