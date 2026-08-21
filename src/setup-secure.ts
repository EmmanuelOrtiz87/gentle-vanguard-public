#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join, resolve } from 'path';

interface SetupSecureArgs {
  force: boolean;
  asJson: boolean;
}

interface AuthResult {
  status: string;
  message: string;
  apiKey?: string;
  file?: string;
}

function parseArgs(): SetupSecureArgs {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force') || args.includes('-f'),
    asJson: args.includes('--as-json'),
  };
}

function newApiKey(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 14);
  const bytes = randomBytes(24);
  const random = Array.from(bytes)
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
  return `fnd_${timestamp}_${random}`;
}

interface SecurityQuestion {
  question: string;
  answerHash: string;
}

interface OwnerAuth {
  name: string;
  apiKey: string;
  createdAt: string;
  securityQuestions: Record<string, SecurityQuestion>;
  permissions: string[];
}

function initializeDeveloperAuth(force: boolean): AuthResult {
  const workspaceDir = join(resolve('.'), '.workspace', 'config');
  const ownerAuthFile = join(workspaceDir, 'owner-auth.json');

  if (existsSync(ownerAuthFile) && !force) {
    return {
      status: 'ALREADY_CONFIGURED',
      message: 'Security already configured. Use --force to regenerate.',
    };
  }

  mkdirSync(workspaceDir, { recursive: true });

  const apiKey = newApiKey();

  const auth: OwnerAuth = {
    name: 'developer',
    apiKey,
    createdAt: new Date().toISOString(),
    securityQuestions: {
      q1: {
        question: 'What is your favorite programming language?',
        answerHash: 'sha256:placeholder',
      },
      q2: { question: 'What city were you born in?', answerHash: 'sha256:placeholder' },
      q3: { question: 'What is your favorite food?', answerHash: 'sha256:placeholder' },
    },
    permissions: ['run-skill-optimizer', 'modify-skills', 'run-tests', 'access-workspace-config'],
  };

  writeFileSync(ownerAuthFile, JSON.stringify(auth, null, 2), 'utf8');

  return {
    status: 'OK',
    message: 'Security configured successfully',
    apiKey,
    file: ownerAuthFile,
  };
}

function main(): void {
  const args = parseArgs();

  console.log('');
  console.log('='.repeat(41));
  console.log('  SECURITY SETUP FOR DEVELOPERS');
  console.log('='.repeat(41));
  console.log('');
  console.log('[REPO] Environment detected');

  const result = initializeDeveloperAuth(args.force);

  if (args.asJson) {
    console.log(JSON.stringify(result));
    return;
  }

  console.log('');
  if (result.status === 'OK') {
    console.log(`[OK] ${result.message}`);
    console.log('');
    console.log(`Your API Key: ${result.apiKey}`);
    console.log('');
    console.log('Store this key securely. You will need it for:');
    console.log('  - npx tsx src/security-orchestrator.ts --action disable --api-key <key>');
    console.log('  - Modify security configuration');
    console.log('');
  } else {
    console.log(`[${result.status}] ${result.message}`);
  }
}

main();
