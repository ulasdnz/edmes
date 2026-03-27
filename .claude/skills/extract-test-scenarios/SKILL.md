---
name: extract-test-scenarios
description: Use after a plan is written and before implementation starts. Reads spec + plan, extracts structured test scenarios with test file mapping and priority markers into docs/test-scenarios/<service>.md. Never looks at implementation code.
---

# extract-test-scenarios

## Purpose

Extract every testable behavior from the spec and plan into a structured contract file **before any implementation begins**. This file becomes the immutable input for the `write-scenario-tests` skill later.

The goal: tests answer "what should this code do?" (from spec), not "what does this code do?" (from implementation).

## When to Invoke

After `/plan` is complete, before `/executing-plans`. Never after implementation has started.

## Inputs

You will be given (or will find):
- Spec file: provided by user or found in `docs/` (e.g. `docs/superpowers/specs/YYYY-MM-DD-<name>.md`, `docs/<service>-spec.md`)
- Plan file: provided by user or found in `docs/superpowers/plans/YYYY-MM-DD-<name>.md`

If the user passes file paths via `@` references or arguments, use those directly. Do not assume a fixed path pattern.

**Do not open any file under `<service>/src/`.** If you find yourself reading implementation code, stop and re-read this instruction.

**New service with no existing code?** If the service doesn't exist yet, examine sibling services (`user/`, `production/`) for test structure conventions (describe nesting, seed helpers, mock patterns). Use their patterns as the basis for test file mapping.

## Process

### Step 1 — Read spec and plan fully

Read both files completely before writing any scenario. Build a mental model of every entity, every operation, every validation rule, every state transition.

### Step 2 — Extract scenarios by entity + operation

For each entity + operation pair in the spec, write scenarios grouped into these categories:

| Category | What to extract |
|----------|----------------|
| `happy path` | Valid input → expected output. Which fields get populated? Which actor fields (createdBy, startedBy) get set from the caller? |
| `constraints` | Every validation rule. Every referential integrity check. Every "X must exist" or "X must be Y" rule from the spec. |
| `boundaries` | Exact equality cases (≥ vs >, == vs !=). Off-by-one. Min/max values where the spec defines them. |
| `state transitions` | Multi-step sequences for stateful entities only (e.g. JobOrder: pending→running→finished). Skip this section if the entity has no lifecycle states. |
| `edge cases` | Production failure modes explicitly described in spec: backdating, overlaps, concurrent operations on same resource, "finished state does not freeze" rules. |
| `authorization` | Permission checks, scoping rules, caller identity fields. |

**One bullet = one testable behavior.** Write it as: `<condition> → <expected result>`

**Priority markers** — prefix bullets that are more critical:
- `[CRITICAL]` — authorization, security, data integrity violations
- `[HIGH]` — edge cases that would cause production failures
- No prefix — happy paths, standard constraints, boundaries

Example bullets:
```
- valid data → returns doc with startTime=null, endTime=null, createdBy set from caller
- productId not in DB → error.not_found
- endTime === startTime → allowed (boundary: spec says endTime >= startTime)
- pending → start → start again → error.job_order_already_started
- [CRITICAL] workCenterId not in caller's visibleIds → 404
- [HIGH] both workCenterId and previousWorkCenterId present → emits to three rooms
```

### Step 3 — Flag ambiguities

If you encounter a spec rule that is genuinely ambiguous (two valid interpretations, or missing information), write it as:

```
⚠️ AMBIGUITY: <describe the ambiguity and the two possible interpretations>
```

Do not guess. Do not pick one silently. Flag it.

### Step 4 — Check for BLOCKED state

If any `⚠️ AMBIGUITY` items remain after writing all scenarios:
- Add `STATUS: BLOCKED` to the file header
- Stop
- Tell the user which ambiguities must be resolved before proceeding

If no ambiguities: add `STATUS: READY` to the file header.

### Step 5 — Write the output file

Write to `docs/test-scenarios/<service-name>.md` using this exact format:

```markdown
# Test Scenarios: <service-name>

> Generated: <YYYY-MM-DD> | Spec: <path> | Plan: <path>
> Status: READY  (or: BLOCKED — resolve ⚠️ AMBIGUITY items before implementing)
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

---

## <Entity>.<operation>
> target: <path/to/test-file.test.ts>
> plan-task: <task number from plan>

### happy path
- <condition> → <expected>

### constraints
- <condition> → error.<code>

### boundaries
- <condition> → <allowed or error>

### state transitions
(omit section if entity has no lifecycle states)
- <sequence> → <expected state>

### edge cases
- [HIGH] <production failure mode> → <expected behavior>

### authorization
- [CRITICAL] <auth condition> → <expected>
```

**Test file mapping rules:**
- Each scenario group MUST have a `> target:` line pointing to the test file where these tests should be written
- If the scenario targets a shared package (`packages/*`), the target is the package's own test file (e.g. `packages/events/src/consumer.test.ts`)
- If the scenario targets service code, the target is in the service's test directory (e.g. `realtime/src/gateway/router.test.ts`)
- The `> plan-task:` line references which task number from the implementation plan this group relates to

Omit any category section that has no items. Do not write empty sections.

## Resolving Ambiguities

When the user resolves a `⚠️ AMBIGUITY` item, it becomes:
```
RESOLVED: <the decision made> (reason: <brief justification>)
```
Once all `⚠️ AMBIGUITY` lines are gone, change `STATUS: BLOCKED` to `STATUS: READY`.

## What This Skill Does NOT Do

- Does not read implementation code
- Does not write test code
- Does not resolve ambiguities on its own — flags them for the human
- Does not add "nice to have" scenarios beyond what the spec defines
- Does not create the plan or spec files

## Output

Single file: `docs/test-scenarios/<service-name>.md`

Tell the user:
1. How many scenarios were extracted (total bullet count)
2. How many `⚠️ AMBIGUITY` items were found (if any)
3. Whether the file is READY or BLOCKED
4. If BLOCKED: list the ambiguities that need resolution
