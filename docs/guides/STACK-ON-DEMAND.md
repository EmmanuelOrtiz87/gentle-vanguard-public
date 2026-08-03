# Stack On-Demand (Gentle-Vanguard)

## 1. Goal

Operate the Gentle-Vanguard stack without keeping orchestrator controls permanently active.

Default mode:

1. Passive by default.
2. Activate when implementation starts.
3. Validate and close out.
4. Deactivate at session end.

---

## 2. Command

Run from gentle-vanguard root:

`TypeScript -NoProfile -ExecutionPolicy Bypass -File .\scripts\utilities\stack-on-demand.ps1`

Actions:

1. `-Action prepare`
2. `-Action activate`
3. `-Action validate`
4. `-Action demo`
5. `-Action deactivate`

Optional:

1. `-ProjectPath <path>` to apply to an existing project.
2. `-AllowPassive` for validation when deactivation is expected.
3. `-Detailed` for expanded validator output.

---

## 3. New Project Workflow

1. `-Action prepare`
2. `-Action activate -ProjectPath <project-path>`
3. Execute implementation tasks.
4. `-Action validate`
5. Run closeout report template.
6. `-Action deactivate -ProjectPath <project-path>`

---

## 4. Existing Project Adoption

1. Point to the target repo with `-ProjectPath`.
2. Activate on-demand orchestrator.
3. Confirm `config/orchestrator.json` and `.orchestrator-active`.
4. Validate and run normal workflow.
5. Deactivate after delivery.

---

## 5. Benefits

1. Lower token/context overhead in idle periods.
2. Explicit activation evidence for audits.
3. Cleaner runtime posture for multi-repo work.
4. Better cost and cycle-time governance.
