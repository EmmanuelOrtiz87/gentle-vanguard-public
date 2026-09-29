/** Parse canonical skill names from the generated Markdown registry table. */
export function parseSkillRegistry(content: string): string[] {
  const names = content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim())[2] ?? '')
    .filter((name) => /^[a-z][a-z0-9_-]+$/.test(name) && name !== 'skill');
  return [...new Set(names)].sort();
}
