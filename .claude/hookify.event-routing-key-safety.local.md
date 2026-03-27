---
name: event-routing-key-safety
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: jobs/events\.ts$
  - field: new_text
    operator: regex_match
    pattern: emit\w*(Updated|Moved|Reassigned|Transferred)\s*=
---

## Event Routing Key Safety Check

You are writing an update/move/reassign emit function in an events.ts file.

**Check before proceeding:**

Does this function include a field that the `realtime` gateway uses for Socket.io room routing?
Currently: `workCenterId`. Future examples: `departmentId`, `lineId`, any ownership/location field.

**If YES — the entity can be reassigned to a different owner:**

The emit function MUST include a `previous{FieldName}?: string` parameter:

```typescript
export const emitJobOrderUpdated = (
  jobOrderId: string,
  workCenterId: string,
  previousWorkCenterId?: string,  // ← required for routing key fields
) => emit('job_order.updated', { jobOrderId, workCenterId, previousWorkCenterId })
```

**Why this matters:**
Without `previousWorkCenterId`, the old room never receives the event.
The operator panel that previously owned this entity will show stale data — it won't know the entity was moved away from it.

**Rule:** The service emitting the event always knows both old and new values at write time.
Never rely on consumers fetching previous state. See CLAUDE.md → Event Design for the full rule.
