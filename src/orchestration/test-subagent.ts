#!/usr/bin/env npx tsx
/**
 * Test script for subagent model resolution
 * Run after restart to verify task() works
 *
 * Note: This is a diagnostic script. The actual `task()` function
 * is provided by the OpenCode runtime environment.
 */

export {}; // Make this a module to avoid global scope conflicts

// task() is injected by OpenCode runtime - declare for TypeScript
declare function task(options: {
  subagent_type: string;
  prompt: string;
  description?: string;
}): Promise<string>;

async function main(): Promise<void> {
  console.log('=== Testing subagent model resolution ===\n');

  try {
    console.log('1. Testing sdd-explore...');
    const result = await task({
      subagent_type: 'sdd-explore',
      prompt: 'Report which model you are using. Reply with exact model name.',
    });
    console.log('✅ SUCCESS:', result);

    console.log('\n2. Testing sdd-apply...');
    const result2 = await task({
      subagent_type: 'sdd-apply',
      prompt: 'What model are you using?',
    });
    console.log('✅ SUCCESS:', result2);

    console.log('\n✅ ALL TESTS PASSED - Subagents working!');
  } catch (error) {
    console.error('\n❌ FAILED:', error);
    console.error('\nStill getting "Model not found inherit-from-session" error');
    console.log('\nTroubleshooting steps:');
    console.log('1. Check ~/.config/opencode/opencode.json has correct model');
    console.log('2. Check ./opencode.json has correct model');
    console.log('3. Restart opencode completely');
    console.log('4. Try: npm run model:check');
    process.exit(1);
  }
}

// Handle floating promise properly
void main();
