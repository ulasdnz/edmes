---
name: write-scenario-tests
description: Use after implementation is complete. Reads docs/test-scenarios/<service>.md as immutable contract, writes one test per scenario bullet. Reports bugs found without fixing them.
type: workflow
---

# write-scenario-tests

## Purpose

Write tests that verify the implementation against the spec — not against what the code happens to do.

The scenarios file was written before implementation, from the spec alone. It is the ground truth. Your job is to translate each scenario bullet into one test, then report any failures as bugs.

## When to Invoke

After implementation is complete (all service code written, types check, no compile errors). Before `pnpm test`.

Do NOT invoke this skill if `docs/test-scenarios/<service>.md` has `STATUS: BLOCKED`. Ambiguities must be resolved first.

## Inputs

You will be given (or will find):
- Scenarios contract: `docs/test-scenarios/<service>.md`
- Service source: `<service>/src/modules/`

## Process

### Step 1 — Load the contract first

Read `docs/test-scenarios/<service>.md` **completely** before opening any source file.

Count the total scenario bullets. This is your test count target.

**Red flag:** If you open implementation code before finishing the scenarios file, stop and restart Step 1.

### Step 2 — Learn test style (not logic)

Read the existing `*.test.ts` files in the service. Extract:
- How the test file is structured (`describe` nesting)
- How test database / mock setup works (`beforeEach`, seed helpers)
- How events are mocked (`vi.mock`)
- Assertion style (`expect(x).toBe()` vs `expect(x).toEqual()`)

**Rule: Copy style, not logic.**
- Do not copy test logic or assertion content from existing tests
- Do not assume an existing test is correct — the scenarios file is the authority
- If an existing test contradicts the scenarios file, follow the scenarios file

### Step 3 — Write one test per scenario bullet

Every bullet in the scenarios file produces exactly one `it()` block.

```typescript
// scenario: "endTime === startTime → allowed (boundary)"
it('allows endTime equal to startTime', async () => {
  const startTime = new Date('2026-03-01T10:00:00Z')
  const jo = await service.create(buildInput(), userId)
  await service.start(jo._id.toString(), { startTime }, userId)

  const ended = await service.end(jo._id.toString(), { endTime: startTime }, userId)
  expect(ended.endTime!.getTime()).toBe(startTime.getTime())
})
```

**One bullet = one `it()`.** A single bullet may generate multiple `expect()` calls (e.g., "returns doc with startTime=null, endTime=null, createdBy set" → three expects, one test).

**Do not add tests beyond the scenarios file.** If you think "this case should also be tested", it should have been in the scenarios file. Leave it out.

### Step 4 — Run the tests

```bash
pnpm --filter <service> test
```

### Step 5 — Handle failures

For each failing test:

**Case A — Implementation bug** (test expectation matches spec, implementation is wrong):
- Keep the test exactly as written
- Add a `// 🐛 BUG:` comment above the test body:

```typescript
it('rejects zero amount', async () => {
  // 🐛 BUG: service accepts amount=0, spec requires amount > 0
  // spec: docs/<service>-spec.md — <EntityName> rules
  await expect(service.create({ amount: 0 })).rejects.toThrow('error.amount_not_positive')
})
```

**Case B — Test setup error** (wrong mock, wrong data, unrelated failure):
- Fix the setup. This is your error, not an implementation bug.
- Re-run the test after fixing setup.

**Never change a test expectation to make it pass.** If the expectation matches the spec and the implementation fails it, that is a bug.

### Step 6 — Write the coverage map

Write `docs/test-scenarios/<service>-coverage.md`:

```markdown
# Coverage Map — <service-name>
Generated: <YYYY-MM-DD>

| Scenario | Test location | Status |
|----------|--------------|--------|
| JobOrder.start / constraints / already started | job-order.service.test.ts:193 | ✅ |
| JobOrder.start / authorization / not in visibleIds | job-order.service.test.ts:201 | ✅ |
| ScrapEntry.create / authorization / not in visibleIds | — | ❌ MISSING (CRITICAL) |
| ScrapEntry.create / boundaries / amount < 0 | — | ❌ MISSING |

## Summary
- Total scenarios: 42
- Covered: 40
- Missing (CRITICAL): 1
- Missing: 1
- Bugs found: 2
```

Coverage map severity:
- `✅` — scenario has a passing test
- `❌ MISSING (CRITICAL)` — authorization or security scenario with no test
- `❌ MISSING` — any other scenario with no test
- `🐛 BUG` — test written but implementation fails

### Step 7 — Report to user

End your output with a clear summary:

```
## Results

Tests written: 42
Tests passing: 40
Tests failing (bugs): 2
Missing coverage: 1

Bugs found:
1. ScrapEntry.create: service accepts amount=0, spec requires amount > 0
   → scrap-entry.service.ts: add `if (data.amount <= 0) throw new CustomError(400, 'error.amount_not_positive')`
   → spec reference: docs/<service>-spec.md — ScrapEntry rules

Missing scenarios (not in scenarios file — add to scenarios file if needed):
(none)

Next step: Fix the 2 bugs in the implementation, then run pnpm --filter <service> test
```

## What This Skill Does NOT Do

- Does not modify the scenarios file
- Does not fix implementation bugs
- Does not change test expectations to match broken implementations
- Does not add tests beyond what is in the scenarios file
- Does not re-run after bug fixes (just run `pnpm test` directly after fixing)

## When to Re-Run This Skill

Only if `docs/test-scenarios/<service>.md` is updated with new or changed scenarios. For normal bug fix cycles, run `pnpm test` directly.
