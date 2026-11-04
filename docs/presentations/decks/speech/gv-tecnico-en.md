# Script — GentleVanguard - Technical onboarding for the stack (EN)

- **Deck:** `gv-tecnico-en`
- **Content file / Archivo de contenido:** `content/gv-tecnico.en.js`
- **Audience / Audiencia:** engineers joining the stack or operating on it: first-week profiles, or the team that is about to touch the stack code.
- **Target duration / Duración objetivo:** 18 minutes (14 slides, with room to cut three if you run long).
- **Room takeaway / Salida de la sala:** anyone in the room should be able to clone, install, start a session, read the stack health status and know where every piece lives, without depending on someone else answering.

> Memory guide, not a teleprompter. The counts cited here come from
> `docs/generated/STACK-FACTS.md`, `config/quality-gates.json` and `opencode.json`;
> if your checkout differs from the deck's v4.3.0, the command is the same but the
> number is regenerated with `npm run stack:facts`.
>
> Every contract key is shown in both languages: the Spanish key is the one the
> coverage gate (`src/tools/decks-guion-coverage-gate.ts`) matches, the English one
> is what you read. The spoken text is English.

---

## Slide 1 — How work happens inside the stack

**Layout:** cover · **Time:** 0:45

**Qué decir:** · **What to say:**
> This is not a product demo, it is the operating manual for the stack: what you touch, under which rules and with which commands. In twenty minutes you will have the full repository map and the session cycle end to end. Everything I show exists in the repository and can be verified on the spot. If something cannot be verified, I do not say it.

**Transicion:** · **Transition:**
Before the content, here is the order in which it is worth walking through during your first week.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Is this a product you sell or an internal development?
  **R:** It is our own stack: the repository open right here. The 28 applications under `apps/` are our own internal developments, not client cases.
- **P:** How is this different from the tooling I already use?
  **R:** The stack does not replace your editor or your terminal: it wraps them with memory across sessions, gates that run by themselves and traces. If all you need is to edit one file, you do not need this; if you need the work to end up recorded and validated, you do.

**No decir:** · **Do not say:**
- No clients, no logos, no success stories and no "market leader": there are none.
- No pricing and no per-seat rate: there is no published official rate.
- Do not promise that the stack "saves you X hours" or quote deck timings as measured results.

---

## Slide 2 — What you will walk through

**Layout:** agenda · **Time:** 0:40

**Qué decir:** · **What to say:**
> The route goes from the static to the live: first the repository map, then what happens internally when you write a request, then the catalogue of capabilities and finally the rules nobody touches. That is the order of a first week: on day one you install and start, and on the following days you drill into the detail. This deck is self-contained, but every claim has a path in the repository so you can verify it whenever you want.

**Transicion:** · **Transition:**
Let us start with the map: eight folders, one responsibility each.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Do I have to read all of this before touching the code?
  **R:** No. The minimum to get going is the setup and the health check; the rest is consulted when the concrete question shows up, and the last slide is exactly that map.
- **P:** Does this replace onboarding with a human?
  **R:** It replaces the questions whose answers are versioned. Design decisions still need a person.

**No decir:** · **Do not say:**
- No delivery dates and no roadmap: this describes the stack as it is today, v4.3.0.
- Do not say "there is nothing to learn": there is a week of curve.

---

## Slide 3 — Eight folders, one responsibility each

**Layout:** layers · **Time:** 1:25

**Qué decir:** · **What to say:**
> The separation between folders is not cosmetic: it is what makes the validations automatic, because every boundary has an owner and a criterion. `src/` is the stack, `apps/` are our own 28 applications that run on top of it and act as a test bench for the architecture under real conditions, `tests/` is the safety net and `config/` is the single source of everything that can be changed. If one folder starts doing another one's job, automatic validation loses a stable path to reference.

**Transicion:** · **Transition:**
With the map in place, let us see what happens inside a session from the moment you write the request.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Why is `apps/` inside the repository instead of being a separate product?
  **R:** Because they are applications that consume the stack: if a stack change breaks one of our own apps, the same CI pipeline notices, not a client.
- **P:** How do I know which folder a new file belongs to?
  **R:** By responsibility, not by convenience: stack logic goes in `src/`, brand material in `assets/`, documentation in `docs/` and templates in `docs/templates/gv/`.

**No decir:** · **Do not say:**
- Never present `apps/` as a client portfolio: they are internal developments.
- Do not turn file counts into market metrics: they are repository counts, with a date.
- Do not say "clean architecture" as if it were a methodology: it is a separation with a concrete criterion.

---

## Slide 4 — What happens when you write a request

**Layout:** flow · **Time:** 1:30

**Qué decir:** · **What to say:**
> What matters in this flow is not the number of stages, it is that none of them is opaque: each one leaves a record. Pre-processing injects skills, context and rules before the model sees your message, the router decides which model answers, and everything that happens afterwards lands in the trace. That is what later lets you reconstruct why an answer came out the way it did, and it is what turns a mistake into something diagnosable instead of something improvised.

**Transicion:** · **Transition:**
Those stages are executed by concrete pieces of the stack; the next slide shows who is who.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Can I skip a stage?
  **R:** Not from your side: pre-processing and the recording are part of the stack contract. What is opt-in is the SDD cycle, which turns on when the work needs several sessions.
- **P:** Where do I see the trace of a session?
  **R:** In Nexus: sessions, traces, events and tokens are persisted there and queried with direct SQL.

**No decir:** · **Do not say:**
- Do not say the router "picks the best model" as if it were guessing: it picks by the rules declared in `config/model-router.json`.
- Do not promise that everything ends up in the trace: what is not instrumented is not there, and that is why the gates exist.

---

## Slide 5 — 20 agents, each with its own perimeter

**Layout:** cards · **Time:** 1:20

**Qué decir:** · **What to say:**
> The roster has 20 agents, and the point is not that you pick one every time, it is that each agent declares its perimeter: model, permissions, step limit, budget and fallback. That is what lets you delegate without losing control, because the delegator cannot delegate something the sub-agent is not allowed to do. In practice the router picks the agent most of the time based on the shape of the task; you invoke a specific one when you need a specific perimeter.

**Transicion:** · **Transition:**
Agents are the executors; the capabilities they can use are the skills.

**Preguntas esperadas:** · **Expected questions:**
- **P:** How do I pick the right agent?
  **R:** With the recommender: `npm run recommend:agent -- --task "..." --topn 3`, or `npx tsx src/orchestration/recommend-agent.ts --task "..." --topn 3`. The roster is in `config/agents.json` and `opencode.json`.
- **P:** Are the agents "AI employees" that work on their own?
  **R:** No. They are roles with bounded permissions, a budget and traceability; the work is still yours and the result gets reviewed.

**No decir:** · **Do not say:**
- No "autonomous agents that do the work on their own" and no measured productivity.
- Do not cite the number of agents as a metric of anything: it is a roster count.
- Do not say every agent writes code: there are operations, business and documentation roles.

---

## Slide 6 — Skills: the library that stops us rewriting things

**Layout:** bullets · **Time:** 1:25

**Qué decir:** · **What to say:**
> A skill is a `SKILL.md` with frontmatter, description and contract. You do not invoke it by name: the router scores your task against the description of every capability and proposes the closest one, so you do not depend on remembering what it was called. What makes it trustworthy is the hygiene: every skill passes structure and accent lint plus the secret scanner before it enters the index, and part of the critical contracts are exercised in real execution.

**Transicion:** · **Transition:**
With agents and capabilities clear, let us look at how you operate it: the commands.

**Preguntas esperadas:** · **Expected questions:**
- **P:** How many skills are there and how do I verify it?
  **R:** The current count lives in `docs/generated/STACK-FACTS.md` (253 indexed, 28 critical) and is regenerated with `npm run stack:facts`. If the number on the slide differs, that is structural drift and `npm run stack:facts:check` reports it.
- **P:** What happens if a skill fails?
  **R:** Nexus separates production, evaluation and maintenance outcomes: you can see whether a capability performs on a real task or only in the evaluation.

**No decir:** · **Do not say:**
- Do not count skills from memory and do not quote the slide number as if it were current: the generated file wins.
- Do not say skills "are trained" or that they are plug-ins that work on their own.
- Do not promise that every skill is tested in execution: only a critical subset is.

---

## Slide 7 — The ones used every day

**Layout:** table · **Time:** 1:40

**Qué decir:** · **What to say:**
> The important property of this table is not the list, it is the principle: every stack operation is an auditable command and its output is recorded. There are no hidden actions and no shortcuts that only work if you know some internal secret of the repository. The daily routine comes down to three: start the session, check the health, check the budget; the rest is used when the work asks for it.

**Transicion:** · **Transition:**
With that you can already operate; now let us see where the memory of everything the stack did lives.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Are there internal commands that are not in this table?
  **R:** There are more scripts in the repository, yes. What this table shows is the daily set; everything else is still a versioned command, not a manual action.
- **P:** Which command is used the most?
  **R:** `npm run watchtower:health` is the one that answers "is the stack healthy?", and `npm run session:autostart:detached` is the one that starts the session in the background, idempotently.

**No decir:** · **Do not say:**
- Do not invent commands: if it is not in `package.json`, it does not exist.
- Do not say this list is exhaustive of everything that can be run.
- Do not promise exact execution times: the table shows an approximation for one environment.

---

## Slide 8 — Nexus: the operational memory of the stack

**Layout:** figureLayers · **Time:** 1:25

**Qué decir:** · **What to say:**
> Nexus is the operational database of the stack: SQLite in WAL mode, with versioned migrations and a daily backup. This is where everything the stack learns from its own work ends up: sessions, traces, events, tokens, skill usage and routing decisions. The relevant design decision is that it is queried with direct SQL, with no reporting layer that could drift away from the truth. And let us be honest about one thing: it is a local file, so the backup is a discipline, not a detail.

**Transicion:** · **Transition:**
If everything the stack learns is recorded, the next question is who verifies it.

**Preguntas esperadas:** · **Expected questions:**
- **P:** What happens if the stack goes down or the database breaks?
  **R:** The work is not lost: the code is in git, the stack state is in Nexus, and uncommitted changes are backed up with `npm run guard:snapshot`. To diagnose: `npm run watchtower:health`, `npm run health:check`, `npm run stack:doctor` and `npm run db:health`; if the database ended up corrupted, `npm run db:restore latest`. Then you bring the session back with `npm run session:autostart:detached`.
- **P:** Is it a cloud service?
  **R:** No: it runs on your machine, under `.runtime`, with daily backups and 14 copies retained. If the machine dies, you restore from the last backup or you re-clone the repository.

**No decir:** · **Do not say:**
- Do not say Nexus is multi-tenant or that it is a managed service.
- Do not promise high availability or redundancy: it is a local file with a backup.
- Do not claim end-to-end encryption unless it is in the repository.

---

## Slide 9 — Quality is not requested: it is executed

**Layout:** metrics · **Time:** 1:15

**Qué decir:** · **What to say:**
> The difference with a stack that has no gates is that validation does not depend on somebody remembering. The stack runs its own controls on every commit, every push and every health cycle, and the registry of what actually runs is `config/quality-gates.json`. That file separates the gates that lefthook or CI execute from the aspirational ones, and `npm run gates:stats` recomputes the count. One detail worth flagging: the hooks are installed by `npm run setup` through lefthook, and the workflows live in CI.

**Transicion:** · **Transition:**
With the structure understood, let us get practical: how this gets installed on your machine.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Do the gates guarantee the code has no bugs?
  **R:** No, and I am not going to sell it that way. Gates verify what can be verified automatically; the rest is human review.
- **P:** What happens if a gate blocks my commit?
  **R:** The gate tells you which rule broke and where. The blocks are intentional: the destruction guardrail requires explicit confirmation and the untracked snapshot runs before any risky operation.

**No decir:** · **Do not say:**
- Do not say the gates guarantee quality: they verify what is verifiable.
- Do not say every gate in the registry runs: the file marks which ones do and which ones do not.
- No certifications and no third-party standards the stack does not have.

---

## Slide 10 — From clone to first session

**Layout:** timeline · **Time:** 1:30

**Qué decir:** · **What to say:**
> Installation is one command: `npm run setup`, which goes through the setup orchestrator and leaves the machine ready. Before that, `npm run install:doctor` checks the prerequisites: Node 22.18 or later, pnpm 11 and Git. Then dependencies with a frozen lockfile, the Nexus database created under `.runtime` with its pending migrations, and lefthook installed with the commit and push hooks. Every step is idempotent: if it breaks, you run it again and nothing duplicates.

**Transicion:** · **Transition:**
Now you have the stack running; what is left is to understand who decides which model answers you.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Does it work on Windows, Linux and macOS?
  **R:** The verified prerequisites are Node 22.18 or later, pnpm 11 and Git. The repository is worked on today with Windows; on another operating system, `npm run install:doctor` tells you what is missing before you touch anything.
- **P:** What happens if `pnpm install` breaks halfway?
  **R:** You run it again: the frozen lockfile makes the workspace tree resolve the same way every time.

**No decir:** · **Do not say:**
- Do not promise the setup works on any operating system or with any Node version.
- Do not say the setup replaces reading `AGENTS.md`: it installs it, it does not internalise it.
- Do not invent steps that are not in the orchestrator.

---

## Slide 11 — The router decides, and the code decides it

**Layout:** table · **Time:** 1:30

**Qué decir:** · **What to say:**
> You do not pick the model on every message: the policy picks it, and the policy is versioned in the repository, which is the difference with changing a parameter on the fly. There are profiles, escalation by task complexity, a failover chain across local providers, a circuit that opens after five failures and a 90-day audit of every routing decision. Temperature is locked by default precisely so that behaviour stays reproducible and comparable.

**Transicion:** · **Transition:**
All of that works if the rules are respected, and these are the ones that are not negotiable.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Can I force a premium model for a hard task?
  **R:** Escalation already does it by task complexity, and the per-domain profile is declared. Changing that is a configuration change in the repository, reviewed like any other, not something you tweak at runtime.
- **P:** What happens if the model provider goes down?
  **R:** Failover chains opencode, ollama and lm-studio2, with a five-minute cache and a fallback model. If all three fail, the circuit opens and the stack stops trying; at that point the way out is the local model, with lower quality.

**No decir:** · **Do not say:**
- Do not say the model or the temperature can be changed on the fly: the policy blocks it.
- Do not promise failover is instant or that a local model matches the remote one in quality.
- No per-token pricing and no cost per user.

---

## Slide 12 — What is not negotiable in this repository

**Layout:** bullets · **Time:** 1:40

**Qué decir:** · **What to say:**
> These six rules exist because something broke before: PowerShell processes that opened windows in someone else's session, bulk deletions without confirmation, and documentation that said "TBD" and said nothing at all. The underlying rule is that the stack has to be invisible for the person using it and explicit for the person maintaining it. And on the question that always comes up: why not just use X and be done? Because X does not give you traceability, gates or memory across sessions; if your work does not need that, use X and keep something simple.

**Transicion:** · **Transition:**
With the rules clear, the last reference slide says where every answer lives.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Can I skip the rules if it is faster?
  **R:** They are the rules that make the result trustworthy for whoever comes next. You can skip them; the cost is that the next person has to reconstruct why.
- **P:** What happens if the stack goes down in the middle of a task?
  **R:** The work stays half-done but protected: `npm run guard:snapshot` backs up untracked files and uncommitted patches before any risky operation, and per-slice commits leave usable history. Then you diagnose with `npm run watchtower:health` and `npm run health:check`, and you resume from the session.

**No decir:** · **Do not say:**
- Do not present the rules as bureaucracy: say what breaks without them.
- Do not say the stack never touches production or that it works on client data: neither is true.
- Do not promise exact build or setup times: they depend on the machine.

---

## Slide 13 — Where to find each kind of answer

**Layout:** table · **Time:** 1:05

**Qué decir:** · **What to say:**
> The stack knowledge is versioned, and that is the difference with a team that keeps everything in one person's head. For the rule currently in force, `AGENTS.md` at the repository root; for the detail of one module, the module manual; for the figures, the generated facts file, regenerated with `npm run stack:facts` and cross-checked with `npm run stack:facts:check`. If an answer is not there, it is not written yet, and that is useful information too.

**Transicion:** · **Transition:**
With the knowledge map complete, let us close with what you need to start.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Why are there two manuals?
  **R:** One is modular and consulted by area; the other is the full architecture, for when you need the whole context at once.
- **P:** And if I cannot find what I am looking for?
  **R:** That is a signal: the topic is not documented. The gap gets written into the repository instead of being left in a chat.

**No decir:** · **Do not say:**
- Do not point at paths that do not exist: verify the path before you say it.
- Do not answer "ask in the team chat": the knowledge goes into the repository.
- Do not promise the documentation is complete: it is a living repository.

---

## Slide 14 — Your first day

**Layout:** closing · **Time:** 0:50

**Qué decir:** · **What to say:**
> Concretely for day one: install, start a session and ask for the stack health status; then pick a small issue and let the inline flow do the rest, exploring, implementing and verifying in proportion to the risk. What I want to leave in the room is this: the stack is the repository, its commands are its interface and its documentation is the source of truth. If a rule looks arbitrary to you, argue it as a pull request.

**Transicion:** · **Transition:**
Closing. The question I leave open is which part of the flow you are still missing.

**Preguntas esperadas:** · **Expected questions:**
- **P:** Is there support during the first week?
  **R:** The real support is the repository: `AGENTS.md`, the stack manual and the use case examples. For design decisions, the team; for everything else, the documentation.
- **P:** Where do I start if I already have the repository cloned?
  **R:** With `npm run watchtower:health`: it tells you whether your machine is healthy before you write the first line.

**No decir:** · **Do not say:**
- No response-time promises, no SLA and no scheduled support.
- Do not close without stating the room takeaway: if it ends without that, the talk did not finish.
- Do not promise the first day is trivial: the curve exists and it is a full week.

---

## Plan B (if you run long)

- Cuttable, in this order: Slide 2 (0:40), Slide 9 (1:15) and Slide 13 (1:05). The rest carries content you cannot drop without losing the room takeaway.
- If you really have time, go deeper on the "Expected questions" of Slide 8, Slide 11 and Slide 12: that is where the hard questions land.
- Do not add slides for extra time.
