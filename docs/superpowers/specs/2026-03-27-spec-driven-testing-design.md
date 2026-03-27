# Spec-Driven Testing: Design

**Date:** 2026-03-27
**Scope:** aimes monorepo — all microservices

## Problem

When the same agent writes both implementation and tests, tests answer "what does this code do?" instead of "what should this code do?" The implementer is biased by what they built, misses edge cases they forgot, and test coverage grows but confidence doesn't.

This project will have 8-10 microservices. Each service needs a repeatable, reliable testing workflow where tests are driven by the spec, not the implementation.

## Solution

Two skills + one handoff artifact.

The **handoff artifact** (`docs/test-scenarios/<service>.md`) is written before any implementation begins, derived only from the spec and plan. It serves as the immutable contract that the test-writing agent must satisfy.

```
spec.md + plan.md
       │
       ▼
/extract-test-scenarios
       │
       ▼
docs/test-scenarios/<service>.md   ← immutable after this point
       │
       ├──────────────────────────────────────────┐
       ▼                                          ▼
/executing-plans                       (test agent reads this later)
(no tests written)
       │
       ▼
/write-scenario-tests
       │
       ▼
service/src/modules/*/*.test.ts
```

---

## Skill 1: `extract-test-scenarios`

**When to invoke:** After plan is written, before implementation starts.

**Inputs:**
- Spec file path (e.g. `docs/production-service-spec.md`)
- Plan file path (e.g. `docs/superpowers/plans/2026-03-27-production-service-plan.md`)

**What it does:**
1. Reads spec and plan only — never looks at implementation code
2. For every entity + operation pair, extracts testable behaviors grouped by category
3. Flags spec ambiguities as `⚠️ AMBIGUITY:` inline comments so they are resolved before implementation
4. Writes `docs/test-scenarios/<service>.md`
5. Adds an immutability warning header to the output file

**Scenario categories (for every operation):**

| Category | What it captures |
|----------|-----------------|
| `happy path` | Valid input → expected output, which fields get set |
| `constraints` | Validation rules, referential integrity checks |
| `boundaries` | Min/max values, exact equality (≥ vs >), off-by-one |
| `state transitions` | Multi-step sequences on entities with lifecycle states (e.g. start→end→re-start, create→update→delete→fetch). Only applicable to stateful entities. |
| `edge cases` | Production failure modes: backdating, overlaps, concurrent start on same resource |
| `authorization` | visibleIds scoping, permission checks, 404 vs 403 behavior |

**Ambiguity hard block:** If the skill finds any `⚠️ AMBIGUITY` item it cannot resolve from the spec alone, it writes the item, marks the output file as `BLOCKED`, and stops. Do not invoke `/executing-plans` while the file contains unresolved `⚠️ AMBIGUITY` items.

**Output format:**

```markdown
# Test Scenarios: <service-name>

> Generated: <date> | Spec: <path> | Plan: <path>
> ⚠️ Immutable after implementation starts.
>    Changes require: update this file + re-run /write-scenario-tests.

## <Entity>.<operation>

### happy path
- valid data → returns doc with <field>=<value>, <actor> set from caller

### constraints
- <field> missing → error.<code>
- referenced <entity> not found → error.not_found

### boundaries
- <field> at exact minimum → allowed
- <field> below minimum → error.<code>

### state transitions
(only for stateful entities — omit section if entity has no lifecycle)
- pending → start → attempt second start → error.already_started
- running → end → attempt end again → error.already_ended

### edge cases
- <production risk description> → expected behavior

### authorization
- caller's workCenterId not in visibleIds → 404
```

**Resolving ambiguities:** When a `⚠️ AMBIGUITY:` item is resolved, replace the line with the decision:
```
⚠️ AMBIGUITY: unclear if endTime == startTime is allowed
→ becomes →
RESOLVED: endTime == startTime is allowed (spec: "endTime >= startTime")
```
The file is unblocked once no `⚠️ AMBIGUITY:` lines remain.

---

## Skill 2: `write-scenario-tests`

**When to invoke:** After implementation is complete.

**Inputs:**
- `docs/test-scenarios/<service>.md` — the contract (read first, before any code)
- `service/src/modules/` — implementation (read for pattern reference only)

**What it does:**

**Step 1 — Load contract first**
Reads the entire scenarios file before opening any source file. This preserves spec-first thinking.

**Step 2 — Learn existing test patterns (style only)**
Reads `*.test.ts` files in the service for: mock setup conventions, helper function patterns, assertion style. Writes new tests in the same style.

**Rule:** Copy **style**, not logic. Do not copy test logic or assertion patterns blindly. If any existing test contradicts the scenarios file, follow the scenarios file — not the existing test.

**Step 3 — Write one test per scenario**
Every scenario bullet produces exactly one `it()` block. A single bullet may have multiple assertions (e.g., "returns doc with startTime=null, endTime=null, createdBy set" → one test, three `expect()` calls). No tests are added beyond the scenario file. If a scenario is missing from the file, the test is missing — the skill does not silently fill gaps.

**Step 4 — Cross-check map**
After writing, produces a coverage map written to `docs/test-scenarios/<service>-coverage.md` (separate from the immutable scenarios file):

```markdown
## Coverage Map — production-service
Generated: 2026-03-27

- JobOrder.start / constraints / already started          → job-order.service.test.ts:193  ✅
- JobOrder.start / boundaries / startTime == now          → job-order.service.test.ts:164  ✅
- JobOrder.start / authorization / not in visibleIds      → job-order.service.test.ts:201  ✅
- ScrapEntry.create / constraints / amount <= 0           → scrap-entry.service.test.ts:89  ✅
- ScrapEntry.create / authorization / not in visibleIds   → ❌ MISSING (CRITICAL)
- ScrapEntry.create / boundaries / amount < 0             → ❌ MISSING
```

Coverage map severity:
- `❌ MISSING (CRITICAL)` — authorization or security scenarios with no test
- `❌ MISSING` — any other scenario with no test
- `✅` — scenario covered

**Step 5 — Bug handling**
If a test fails because the implementation does not satisfy the spec, the skill:
- Does NOT change the test expectation to pass
- Does NOT fix the implementation
- Adds a `// 🐛 BUG:` comment with spec reference
- Lists all bugs found at the end of its output

Example:
```typescript
it('rejects zero amount', async () => {
  // 🐛 BUG: service accepts amount=0, spec requires amount > 0
  // spec: docs/production-service-spec.md — ScrapEntry rules
  await expect(service.create({ amount: 0 })).rejects.toThrow('error.amount_not_positive')
})
```

**What the skill does NOT do:**
- Add tests not in the scenarios file
- Modify the scenarios file after implementation
- Fix the implementation to make tests pass
- Silently skip failing tests

---

## File Structure

```
aimes/
├── docs/
│   ├── skills/
│   │   ├── extract-test-scenarios.md    ← version-controlled skill source
│   │   └── write-scenario-tests.md      ← version-controlled skill source
│   └── test-scenarios/
│       ├── production-service.md        ← one file per service
│       ├── operations-service.md
│       ├── shift-service.md
│       └── ...
└── ~/.claude/skills/                    ← personal invocable copies (manual sync)
    ├── extract-test-scenarios.md
    └── write-scenario-tests.md
```

**Sync rule:** After any commit that modifies a file in `docs/skills/`, copy the updated file to `~/.claude/skills/`. One command: `cp docs/skills/<skill>.md ~/.claude/skills/`. Manual step; no automation needed at this scale.

---

## Full Workflow Per Service

```
1. Spec written to docs/<service>-spec.md
         ↓
2. /plan → docs/superpowers/plans/YYYY-MM-DD-<service>-plan.md
         ↓
3. /extract-test-scenarios
   → reads: spec + plan
   → writes: docs/test-scenarios/<service>.md
   → flags: any spec ambiguities
         ↓
4. Review docs/test-scenarios/<service>.md
   Resolve any ⚠️ AMBIGUITY items before proceeding
         ↓
5. /executing-plans (or subagent-driven-development)
   → implements code only
   → does NOT write tests
   → instruction: "Implement defensively. You will be tested against the spec.
                   Do not optimize for known inputs. Handle all edge cases the spec defines."
         ↓
6. /write-scenario-tests
   → reads: docs/test-scenarios/<service>.md (contract)
   → reads: src/modules/ (pattern reference)
   → writes: *.service.test.ts files
   → produces: coverage map + bug list
         ↓
7. Bug fix loop (repeat until clean):
   a. Fix each 🐛 BUG item in the implementation (service code only, not test files)
   b. Run: pnpm --filter <service> test
   c. Exit loop when: all tests pass and coverage map has no ❌ MISSING items
   Note: /write-scenario-tests is NOT re-run here. Tests stay as written.
         Only re-run the skill if the scenarios file itself changes.
         ↓
8. pnpm --filter <service> test  → all green
```

---

## Success Criteria

- Every spec rule has a corresponding scenario in the scenarios file
- Every scenario has exactly one test
- Tests written by `/write-scenario-tests` can find bugs the implementer didn't notice
- The scenarios file is readable by a human who hasn't seen the code
- Adding a new service takes < 15 minutes to extract scenarios from spec + plan
