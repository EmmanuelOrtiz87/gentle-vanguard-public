import { useMemo, useState } from 'react';
import { Sparkles, Copy, Check, Wand2 } from 'lucide-react';

interface PromptStudioProps {
  className?: string;
}

const TASK_TYPES = [
  { id: 'review', label: 'Code review' },
  { id: 'feature', label: 'Feature build' },
  { id: 'architecture', label: 'Analysis / architecture' },
  { id: 'docs', label: 'Documentation' },
  { id: 'tests', label: 'Tests' },
  { id: 'refactor', label: 'Refactor / optimization' },
  { id: 'research', label: 'Research' },
] as const;

const OUTPUT_FORMATS = [
  'Findings report with severity levels and evidence per finding',
  'Complete ready-to-apply code, comments only where needed',
  'Numbered step-by-step plan with dependencies and risks',
  'Markdown document with sections and decision table',
  'Strict JSON matching the schema described in context',
];

const EXAMPLE = {
  type: 'review',
  role: 'Senior software engineer specialized in quality and architecture',
  goal: 'Review the checkout module before releasing to production',
  context:
    'TypeScript + React 18 monorepo. vitest tests. Stripe payments. Public API contracts must not break. Module at apps/web/src/checkout/.',
  criteria: 'No high/medium vulnerabilities\nCovers error and timeout paths\nFlags technical debt\nMatches repo style',
  format: OUTPUT_FORMATS[0],
  tone: 'Direct, technical, no filler',
};

export function PromptStudio({ className = '' }: PromptStudioProps) {
  const [type, setType] = useState<string>('review');
  const [role, setRole] = useState('');
  const [goal, setGoal] = useState('');
  const [context, setContext] = useState('');
  const [criteria, setCriteria] = useState('');
  const [format, setFormat] = useState(OUTPUT_FORMATS[0]);
  const [tone, setTone] = useState('');
  const [copied, setCopied] = useState(false);

  const taskLabel = useMemo(
    () => TASK_TYPES.find((x) => x.id === type)?.label ?? '',
    [type],
  );

  const prompt = useMemo(() => {
    const crit = criteria
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const L: string[] = [];
    L.push('# Role');
    L.push(
      `Act as ${role.trim() || '[FILL: who the assistant should be]'}. Your goal: ${
        goal.trim() || '[FILL: the concrete task in one sentence]'
      }.`,
    );
    L.push('');
    L.push('# Task');
    L.push(
      `${taskLabel}. Work from the provided information; if something essential is missing, ask ONE short list of questions before executing.`,
    );
    if (context.trim()) {
      L.push('');
      L.push('# Context');
      L.push(context.trim());
    }
    if (crit.length) {
      L.push('');
      L.push('# Acceptance criteria');
      L.push('The answer is correct only if:');
      crit.forEach((c) => L.push(`- ${c}`));
    }
    L.push('');
    L.push('# Output format');
    L.push(`${format}.`);
    if (tone.trim()) {
      L.push('');
      L.push('# Style');
      L.push(`${tone.trim()}.`);
    }
    L.push('');
    L.push('# Verification');
    L.push(
      'Before answering, review your draft against the acceptance criteria and fix it. Show only the final version.',
    );
    return L.join('\n');
  }, [taskLabel, role, goal, context, criteria, format, tone]);

  const fillExample = () => {
    setType(EXAMPLE.type);
    setRole(EXAMPLE.role);
    setGoal(EXAMPLE.goal);
    setContext(EXAMPLE.context);
    setCriteria(EXAMPLE.criteria);
    setFormat(EXAMPLE.format);
    setTone(EXAMPLE.tone);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputCls =
    'w-full rounded-lg bg-slate-900/70 border border-slate-600/50 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400/60 transition-colors';

  return (
    <div className={`gv-panel p-5 ${className}`} data-testid="prompt-studio">
      <header className="mb-4">
        <div className="flex items-center gap-2 text-cyan-300 text-xs font-semibold tracking-widest uppercase">
          <Sparkles className="w-4 h-4" /> Interactive tool
        </div>
        <h2 className="text-xl font-bold text-slate-100 mt-1">Prompt Studio</h2>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Build structured professional prompts (role, task, context, acceptance criteria,
          output format, verification) and copy them to any model. Runs entirely in your
          browser — nothing leaves the machine.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-type">
              Task type
            </label>
            <select id="ps-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {TASK_TYPES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-role">
              Assistant role
            </label>
            <input
              id="ps-role"
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Who the assistant should be"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-goal">
              Goal / task
            </label>
            <input
              id="ps-goal"
              className={inputCls}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="One concrete sentence"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-context">
              Context
            </label>
            <textarea
              id="ps-context"
              className={`${inputCls} font-mono text-xs min-h-[84px]`}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Repo, stack, business constraints…"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-criteria">
              Acceptance criteria (one per line)
            </label>
            <textarea
              id="ps-criteria"
              className={`${inputCls} font-mono text-xs min-h-[84px]`}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-format">
              Output format
            </label>
            <select
              id="ps-format"
              className={inputCls}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {OUTPUT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-tone">
              Tone / style (optional)
            </label>
            <input
              id="ps-tone"
              className={inputCls}
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="e.g. direct, technical, no filler"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={fillExample}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-400/50 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10 transition-colors"
            >
              <Wand2 className="w-4 h-4" /> Load example
            </button>
          </div>
        </section>

        <section className="flex flex-col">
          <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="ps-out">
            Your prompt
          </label>
          <textarea
            id="ps-out"
            readOnly
            value={prompt}
            className="flex-1 w-full rounded-xl bg-slate-950/80 border border-violet-400/25 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100 min-h-[360px] whitespace-pre-wrap"
          />
          <button
            type="button"
            onClick={copy}
            className="mt-3 inline-flex items-center gap-2 self-start rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 px-5 py-2 text-sm font-bold text-slate-950 hover:opacity-90 transition-opacity"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </section>
      </div>
    </div>
  );
}

export default PromptStudio;
