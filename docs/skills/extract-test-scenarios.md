---
name: extract-test-scenarios
description: Use after a plan is written and before implementation starts. Reads spec + plan, extracts structured test scenarios into docs/test-scenarios/<service>.md. Never looks at implementation code.
type: workflow
---

# extract-test-scenarios

## Purpose

Extract every testable behavior from the spec and plan into a structured contract file **before any implementation begins**. This file becomes the immutable input for the `write-scenario-tests` skill later.

The goal: tests answer "what should this code do?" (from spec), not "what does this code do?" (from implementation).

## When to Invoke

After `/plan` is complete, before `/executing-plans`. Never after implementation has started.

## Inputs

You will be given (or will find):
- Spec file: `docs/<service>-spec.md`
- Plan file: `docs/superpowers/plans/YYYY-MM-DD-<service>-plan.md`

**Do not open any file under `<service>/src/`.** If you find yourself reading implementation code, stop and re-read this instruction.

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
| `authorization` | visibleIds scoping. Permission checks. Caller identity fields (createdBy, startedBy populated from authenticated user). |

**One bullet = one testable behavior.** Write it as: `<condition> → <expected result>`

Example bullets:
```
- valid data → returns doc with startTime=null, endTime=null, createdBy set from caller
- productId not in DB → error.not_found
- endTime === startTime → allowed (boundary: spec says endTime >= startTime)
- pending → start → start again → error.job_order_already_started
- workCenterId not in caller's visibleIds → 404
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
> ⚠️ Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

---

## <Entity>.<operation>

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
- <production failure mode> → <expected behavior>

### authorization
- <auth condition> → <expected>
```

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
