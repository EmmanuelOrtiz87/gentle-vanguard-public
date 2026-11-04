# Script — GentleVanguard - An orchestration layer for your company AI (EN)

- **Deck:** `gv-enterprise-en`
- **Content file:** `content/gv-enterprise.en.js`
- **Audience:** Business and technology leadership at a large company (reference: telecom) that wants to bring AI to its teams in a governed way.
- **Target duration:** 18 minutes of talk + 10 minutes of questions.
- **What must land in the room:** That the stack is an orchestration layer — not a chatbot — with roles, budgets, traceability and audit; that adoption is gradual and reversible; and that the next step is a working session, not a contract.

> How to use: this script is a memory guide, not a teleprompter. The per-slide times are the rehearsal budget; if you have time left, go deeper into the expected questions instead of adding slides.

> Note for reviewers: the coverage gate (`decks:guion`) matches the Spanish contract keys, so every section carries the English label used by the presenter plus the Spanish key the gate reads.

---

## Slide 1 — An orchestration layer for your company AI

**Layout:** cover · **Time:** 0:45

**What to say:** (**Qué decir:**)
> The question that usually reaches leadership is not "which model do we use", it is "what happens when AI touches our data, our costs and our teams". GentleVanguard is a layer that puts that answer first: assistants stop being loose accounts and become roles with permissions, budgets and traceability. In the next few minutes I am not going to show you a product; I am going to explain what gets solved if you adopt it as a platform, and what happens on the day you stop maintaining it.

**Transition:** (**Transicion:**)
> Before talking about the stack, it is worth saying who built it and from what experience.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Is this a commercial product with a price?
  **R:** There is no published official rate. The working model is the platform installed on your own infrastructure, on top of an open source repository; the first conversation is a free diagnostic.
- **P:** How is this different from buying an enterprise AI tool?
  **R:** They are different things: the tool is the input, this is the governance layer that decides who uses it, with which limits, and leaving which record.
- **P:** Can you show us a customer already using it?
  **R:** The stack has no customers: the applications that run on it are our own internal developments, which is exactly what the next slides explain.

**Do not say:** (**No decir:**)
- Do not say "we are the leading platform" or compare against named products: the repository holds no comparative study that backs it.
- Do not say the stack has certifications or external audits: it does not.
- Do not promise implementation timelines or business results in the opening.

---

## Slide 2 — The person who knows applied AI in large companies has done it before

**Layout:** statement · **Time:** 1:00

**What to say:** (**Qué decir:**)
> This platform does not start from a lab idea, it starts from concrete integration problems in large companies: systems to integrate, costs to understand, teams to coordinate. That is why control and traceability are built in from the base instead of being added later as a wrapper. Once that context is clear, we move to what actually matters in this room: what this stack is.

**Transition:** (**Transicion:**)
> With the background of who builds it, let us define what the stack is and, more importantly, what it is not.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Are DIRECTV, GlobalLogic or Oracle customers of GentleVanguard?
  **R:** No. They are previous professional stages of the founder: the track record is verifiable, they are not cases of this product.
- **P:** What does the founder's experience guarantee?
  **R:** That the design answers problems already seen in enterprise integration. It is not a guarantee of results and should not be presented as one.

**Do not say:** (**No decir:**)
- Do not present DIRECTV, GlobalLogic or Oracle as customers of the stack.
- Do not turn the track record into service promises ("with this we guarantee X"): there is no published SLA.
- Do not use the experience as a reason to skip the diagnostic.

---

## Slide 3 — The stack is not a chatbot: it is the layer that governs it

**Layout:** figureLayers · **Time:** 1:45

**What to say:** (**Qué decir:**)
> What the slide shows is four pieces and six layers, but the frame that matters is a different one: each piece answers a management question that today gets answered by improvisation. Who is allowed to do what? What does the system know? What evidence is left? What happens if something goes wrong? The point is that those four answers should not depend on each team's good will, but on a shared layer that can be audited. Everything you will see next is the detail behind that layer.

**Transition:** (**Transicion:**)
> If the stack is a layer, it is worth looking at its full anatomy, because that is where the answer to the question this audience cares about most comes from: what if we stop maintaining it.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Does the stack replace the tools we already use?
  **R:** No. The stack operates over the surfaces and tools you already have: the goal is to govern them, not to replace them.
- **P:** Does it work without an internet connection?
  **R:** The control, agent and data layers are local; models can be provider-hosted with a failover chain to local models. That is detailed on the topology slide.

**Do not say:** (**No decir:**)
- Do not say the stack is "100% local": the model can be remote and memory sync is optional.
- Do not say the skills are "code you write": they are invoked by context, not by development.
- Do not re-read the figures on the slide: the evidence lives in the repository, not in the spoken promise.

---

## Slide 4 — Nine layers, each with an explicit boundary

**Layout:** layers · **Time:** 2:15

**What to say:** (**Qué decir:**)
> This slide is the map of the stack and also the partial answer to the maintenance question. Every layer has an explicit boundary: it knows what it does and what it does not do, which is what allows one layer to be replaced, audited or extended without dragging the others down. That is what turns the stack into a platform rather than a monolith. When a piece gets old, you replace that piece; you do not have to rebuild the whole thing.

**Transition:** (**Transicion:**)
> With the structure in mind, it is worth sizing the real scale of what sits behind it.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** What does it cost to maintain this?
  **R:** It is a real cost and I will say so: there are more than 800 files of our own code, more than 550 test files and more than 600 operational scripts. What you buy in exchange is a base that can be updated layer by layer, with versioned migrations and gates that verify the state.
- **P:** What if the project ends or priorities change?
  **R:** The knowledge lives in the repository and in the local database (Nexus), with 22 versioned migrations: that can be archived, handed over or reviewed by a new team.
- **P:** Can each layer be swapped for an external provider?
  **R:** The model layer is decoupled by design (provider, then Ollama, then LM Studio). The rest of the stack is ours, and that is precisely the point: the control does not depend on a third party.

**Do not say:** (**No decir:**)
- Do not say the stack "needs no maintenance": it does, and the proposal is that that maintenance lives inside the platform.
- Do not promise SLAs, availability or support with service-level commitments: there is no published SLA.
- Do not read the figures on the slide as market metrics: they are counts of our own repository.

---

## Slide 5 — Not a prototype: a system under sustained use

**Layout:** metrics · **Time:** 0:45

**What to say:** (**Qué decir:**)
> These four numbers are our own code: how many implementation files, how many test files, how many operational commands and how many health checks. The reason I show them is simple: when someone asks "is this real?", the strongest answer available is not a statement, it is the repository, which any of you can open. The file that summarises the current state of the stack is `docs/generated/STACK-FACTS.md`, and it is regenerated from the live configuration.

**Transition:** (**Transicion:**)
> With the scale in the clear, let us move to what the company actually gets when it installs this.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Do these numbers mean N companies are using it?
  **R:** No. They are counts of code, tests, scripts and checks in our own repository. They are not market or customer metrics.
- **P:** Are the tests green today?
  **R:** The state of the health checks and the suite is queryable through the watchtower and the operational scripts; what we claim in this room is that verification exists and is automated, not a coverage percentage.

**Do not say:** (**No decir:**)
- Do not use these numbers as proof of adoption, customers or market size.
- Do not invent coverage percentages, build times or success rates that are not in the repository.
- Do not say "externally audited": the audit is ours and hash-chained.

---

## Slide 6 — What the company gets when it installs the stack

**Layout:** cards · **Time:** 1:30

**What to say:** (**Qué decir:**)
> The three cards are the three things leadership eventually asks for. Roles, so AI capability does not depend on one specific person who left. Cost, so spend has a ceiling and becomes visible before the invoice. Permissions, so exposure to data and risky actions is written down before it happens. The value is not in each piece alone, it is in the three moving together: a role without budget and permissions is a risk, and a budget without roles is diffuse spending.

**Transition:** (**Transicion:**)
> With what you receive defined, let us see what that looks like day to day, because the promise stands or falls in the working loop.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Do the budgets guarantee the invoice will not surprise us?
  **R:** They are not insurance: they are configurable cuts with a soft and a hard threshold. They bound exposure and raise the signal; actual spend control stays with the finance team.
- **P:** How is a new role defined?
  **R:** In the repository, with permissions, step limits, skills and model bindings by area and criticality. It is a versioned artefact, not an informal setting.
- **P:** Is the ROI measured?
  **R:** The stack measures and exposes the cost of the operation; the savings versus running tools without control are not measured in the repository and we will not invent them.

**Do not say:** (**No decir:**)
- Do not quote savings, ROI or productivity percentages: there is no published measurement.
- Do not say budgets are a guaranteed hard cap on spending: they cut with soft and hard thresholds.
- Do not say "permissions per role equals zero risk": the model is explicit and auditable, not a guarantee.

---

## Slide 7 — How a task actually runs, end to end

**Layout:** flow · **Time:** 1:30

**What to say:** (**Qué decir:**)
> This is the working loop, and it behaves the same for a one-week project as for a six-month one, which is exactly what allows adoption to be gradual without changing methodology halfway through. Every turn injects context and rules, the router picks model and agent, the agent works with real tools and leaves a trace, and the gates and the reviewer close the loop before work is declared done. For leadership the relevant part is the last step: the work is not accepted because the model said so.

**Transition:** (**Transicion:**)
> If the loop ends in verification, then governance is not an add-on: it is part of the circuit.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Who reviews it, a person or the system?
  **R:** Both: the gates verify automatically and there is an explicit reviewer before closing. The point is that review sits inside the process, not in someone's good intentions.
- **P:** How much does a task cost?
  **R:** It depends on the chosen model and on complexity; the router decides by cost, latency and load, and the budgets cut when the limit is exceeded.

**Do not say:** (**No decir:**)
- Do not say the loop is identical in cost and in time between a small project and a large one: the shape is the same, the invoice is not.
- Do not say agents work without human intervention: there is review and there is escalation.
- Do not call a process with mandatory gates "autonomous".

---

## Slide 8 — What keeps this from being an uncontrolled experiment

**Layout:** bullets · **Time:** 2:00

**What to say:** (**Qué decir:**)
> This is the slide that answers "is this safe for us?". The six controls live in the repository and are executable: gates run in the git hook and in CI, secret scanning reviews before commit, the chained audit detects if someone edits the log, the SBOM documents what the delivery is made of, the dashboard shows what really happened, and the daily backup makes recovery possible. The underlying point is that none of these controls depends on someone remembering to apply them.

**Transition:** (**Transicion:**)
> With the controls clear, the open question is a management one: do we adopt AI tool by tool or with a shared layer, and what happens if we stop maintaining that layer.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Does the chained audit prove nobody did anything wrong?
  **R:** No. It proves the log was not altered inconsistently: it is log integrity, not a conduct investigation.
- **P:** Is the OWASP mapping a certification?
  **R:** No. It is a documented mapping of controls against OWASP Top 10 for agents, in the repository's security documentation. There is no third-party certification.
- **P:** Who operates the gates?
  **R:** The git hook and the CI pipeline, with the configuration in `config/quality-gates.json`. It is infrastructure, not somebody's task.

**Do not say:** (**No decir:**)
- Do not say "audited", "certified" or "compliant with the standard" in the sense of certification: no third-party certification exists.
- Do not say traceability prevents leaks: it lets you know what happened and prove it.
- Do not promise the controls cover everything: they cover what is implemented and versioned in the repository.

---

## Slide 9 — Adopting AI tool by tool, or with an orchestration layer

**Layout:** compare · **Time:** 2:00

**What to say:** (**Qué decir:**)
> The two columns do not differ in how good the models are: they differ in where the capability ends up. On the left, capability stays inside the company, with the standard, the budget and the record defined in the repository. On the right, every team improvises and process knowledge lives in conversations that get lost. On the maintenance question, the honest answer is that the layer also needs maintenance; what changes is that this maintenance is done once, versioned and with migrations, instead of being repeated inside every tool.

**Transition:** (**Transicion:**)
> If the difference is where each part lives, the next slide maps the residence of the data.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** So the stack needs no maintenance?
  **R:** It does. The difference is that maintenance ends up in one place, versioned and auditable, instead of being scattered across every tool each team adopted on its own.
- **P:** Is the right-hand column "wrong"?
  **R:** It is not wrong, it is dispersed: it works while the team is small and the same group controls the tool. The cost shows up when you have to audit, migrate or explain what the model did.
- **P:** Can we use the stack with the model provider we already have?
  **R:** Yes, and the routing table allows switching model or provider without rewriting the processes.

**Do not say:** (**No decir:**)
- Do not say the alternative "does not work" or is non-compliant: it works, it just does not consolidate capability.
- Do not say "zero cost" or "no maintenance": the stack has an operating cost and I will say so.
- Do not use this slide to discredit tools you already have: the point is the shared standard.

---

## Slide 10 — Where each part lives, and why it matters

**Layout:** table · **Time:** 1:30

**What to say:** (**Qué decir:**)
> This table is what backs the portability promise, and it is also where precision matters most. Process control lives locally, on the team machine; the operational database is local and queryable without network latency; the audit is versioned files that can be archived or shipped to a SIEM. On leaving the process behind: if you stop maintaining this platform tomorrow, what remains is a documented repository, a database with a versioned schema and a log of what happened. It is not a black box and not a vendor dependency.

**Transition:** (**Transicion:**)
> With the residence map clear, we can talk about the one variable finance actually cares about: how much it costs and how it is bounded.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** Does our data ever leave the organisation?
  **R:** Operational data and the audit are local by default; memory allows optional sync and models can be provider-hosted. If that is not acceptable, the stack has a local route (Ollama, LM Studio) and that is defined by policy, not by contract.
- **P:** Can we audit outward?
  **R:** Yes: audit and traces are versioned files that can be archived, exported to a SIEM or retained per company policy.
- **P:** What happens if the company changes model provider?
  **R:** The routing table and the failover chain live in configuration (`config/model-router.json`); the processes do not depend on a specific model.

**Do not say:** (**No decir:**)
- Do not say "air-gapped" or "data never leaves": memory sync is optional and configurable.
- Do not promise any app of the stack can be exposed to the internet without a security review: exposure is optional and has to be decided with policy.
- Do not say the database is "replicated to the cloud" unless it is configured that way in your company.

---

## Slide 11 — The cost of AI, measured and bounded

**Layout:** metrics · **Time:** 0:45

**What to say:** (**Qué decir:**)
> These four numbers are the current budget and routing configuration of the stack, and they are the ones you can change. The goal is not to stop using AI, it is to make the invoice stop being a surprise and become a design variable. Once this is installed in a company, these values are tuned to the real budget and written into configuration, not kept in someone's head.

**Transition:** (**Transicion:**)
> With the economics in order, the last step is how to get in without breaking anything.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** What does it cost to run?
  **R:** It depends on token consumption and on the model the router selects; the current limits are in `config/token-budget-guard.json` and are adjusted by policy. There is no published official price for the product.
- **P:** What happens if the budget is exceeded?
  **R:** The budget guard cuts, and depending on configuration it downgrades the model to a cheaper profile before reaching the hard limit.

**Do not say:** (**No decir:**)
- Do not quote product prices or ranges: the price catalogue in the repository states there is no published 2026 rate.
- Do not translate token limits into a promise of savings in currency: they are caps, not a measured saving.
- Do not say the budget "guarantees" spend control: it bounds and warns; reconciliation is still done by finance.

---

## Slide 12 — How to get in without breaking anything

**Layout:** timeline · **Time:** 1:30

**What to say:** (**Qué decir:**)
> The four steps are ordered by reversibility, which is the criterion I propose them with. You audit what is already installed, you run a bounded pilot with budget and tracing live from day one, you extend what worked into formal roles, and finally you bring gates, backups, audit and upgrades into the operating routine. Step two is the one not to skip: a badly chosen pilot is the fastest way to lose leadership interest.

**Transition:** (**Transicion:**)
> With the entry path clear, let us close with what I am actually proposing today.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** How long does each phase take?
  **R:** It depends on the area and the process, which is why the first phase is the diagnostic: there is no generic timeline that can be defended before seeing the real surface.
- **P:** What if the pilot does not work?
  **R:** It stops and is reviewed. Because every step is reversible and bounded, a failed pilot costs time, not a system migration.
- **P:** What do we need from our side to start?
  **R:** One area, one process, one agent and one counterpart with decision authority over that process. The rest is provided by the stack.

**Do not say:** (**No decir:**)
- Do not say the audit guarantees execution will work: it reveals the real surface, nothing more.
- Do not promise an adoption calendar or a full migration of existing systems.
- Do not use this slide to close on price: there is no published price and the step is a diagnostic.

---

## Slide 13 — The next step is a diagnostic, not a contract

**Layout:** closing · **Time:** 1:00

**What to say:** (**Qué decir:**)
> What I am proposing is a working session, with no cost and no implementation commitment: we review how AI sits in your organisation today, which tools, skills and permissions are installed, and which part of this platform can be adopted without friction. If that session concludes that we should not move ahead, that is a valid answer too, and the platform stays open source. Before the questions, one thing to state out loud: this is not another tool, it is a control layer that stays inside the company.

**Transition:** (**Transicion:**)
> That ends the talk; let us take the questions.

**Expected questions:** (**Preguntas esperadas:**)
- **P:** What happens to our data during the diagnostic?
  **R:** The review covers tools, skills and permissions already installed; information-handling rules are yours to define, and the scope can be adjusted before starting if needed.
- **P:** Who maintains the stack afterwards?
  **R:** Adoption is internal: configuration, roles and evidence live in the repository and in the company database, with documentation and versioned migrations. It is a decision with a name attached, not a black box.

**Do not say:** (**No decir:**)
- Do not close with an implementation, price or timeline commitment: the proposed step is a diagnostic.
- Do not say the diagnostic guarantees frictionless adoption: its purpose is to tell you honestly how viable it is.
- Do not close without saying out loud what must land in the room: a governed orchestration layer that stays inside the company.
