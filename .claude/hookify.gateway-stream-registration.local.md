---
name: gateway-stream-registration
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: jobs/events\.ts$
  - field: old_text
    operator: not_contains
    pattern: emit
---

## New Service Event Stream Detected

You are creating a new `jobs/events.ts` file — this looks like a new service.

**Checklist before proceeding:**

- [ ] Add the new stream to `realtime/src/config/streams.ts` (the gateway's stream list)
  - Stream name convention: `events.{service-name}` (e.g. `events.media`, `events.maintenance`)
  - Without this, the `realtime` gateway will never consume this service's events
  - Frontend will never receive these events via Socket.io

- [ ] Decide which events carry `workCenterId` (routing key)
  - Those events must include `previousWorkCenterId?: string` on update/move/reassign emit functions
  - See CLAUDE.md → Event Design for the full routing key rule

The `realtime` gateway is the single WebSocket door to the frontend.
Every service's stream must be explicitly registered there.
