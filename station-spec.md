# Station-Service Specification

Decision-complete specification for a new on-prem MES `station-service`, following the same structural conventions as `user-service`.

## Summary

- `station-service` is a new app under `apps/station` using the same conventions as `user/`: Express 5, Mongoose 9, Zod 4, shared `@mes/*` packages, `/api/v1` and `/internal/v1`, Redis Streams, OpenAPI, health routes, and audit logging.
- It owns station master data, hierarchy/topology, predecessor flow, calendars and shift overrides, operator presence sessions, tool/instrument data plus station-tool activity, typed operational configuration, and durable station-state history queries.
- It does not own raw tags/time-series, department/business hierarchy, job orders, maintenance workflow, or raw runtime/OEE detection. It stores validated tag bindings and projects canonical station state from trusted upstream/runtime events plus its own schedule, presence, and configuration data.
- Public access requires station permissions plus row-level visibility. Visible stations are the user's `user-service.stationIds` plus all descendants. Internal routes follow the same system-bypass convention as `user-service`.

## Bounded Context And Domain Model

- Service modules: `station`, `schedule`, `presence`, `tools`, and `state`.
- `Station` is the core aggregate with `id`, immutable globally unique `code`, `name`, optional `parentStationId`, `kind: leaf|aggregate`, `metricSource: tag_driven|derived`, `status: active|archived`, `externalBindings[]`, and computed hierarchy path.
- Naming rules: `code` is globally unique and immutable; `name` is unique among siblings; hierarchy cycles are forbidden.
- Hierarchy is a single-parent tree. Only aggregate stations may have children. Leaf stations cannot own children.
- Allowed station shapes in v1: `leaf+tag_driven`, `aggregate+derived`, `aggregate+tag_driven`. `leaf+derived` is out of scope.
- `StationFlowEdge` is a separate directed predecessor/production-flow relationship independent from hierarchy and must remain acyclic.
- Aggregate metric composition is explicit and typed per family: `availability`, `productivity`, and `quality`. Each family stores `contributors[]`, `strategy`, and `constraints`. No free-form formulas.
- Availability strategies: `all_required_running`, `any_running`, `worst_child_wins`.
- Productivity strategies: `sum_output`, `minimum_ratio`, `weighted_ratio_by_expected_rate`.
- Quality strategies: `weighted_by_good_count`, `minimum_quality`, `primary_station`.
- `StationScheduleConfig` contains default shifts. `StationCalendar` contains `validFrom`, `validTo`, `status`, and `weeklyPattern`. `DateException` overrides a specific local date with either `closedAllDay` or explicit working intervals.
- `OperatorPresenceSession` is session-based with `stationId`, `operatorId`, `startedAt`, `endedAt?`, `source: manual|badge|system`, and optional `shiftContext`.
- `Tool` owns station-local tool/instrument master data with unique `code`, `type: tool|instrument`, `status`, and `externalBindings[]`.
- `StationToolLink` owns the allowed relation between a station and a tool plus `allowedActivityTypes[]`.
- `ToolActivity` is append-only and only valid for an active station-tool link. Allowed types in v1: `usage_start`, `usage_end`, `inspection_recorded`, `calibration_check_recorded`, `fault_reported`, `fault_cleared`.
- `DowntimeCase` stores externally detected stop intervals plus follow-up status: `causeStatus: pending|entered|auto_assigned`, `confirmationStatus: not_required|pending|confirmed`.
- `SpeedLossCase` stores externally detected below-threshold running intervals plus threshold snapshot and follow-up status.
- `StationStateInterval` is the durable reporting model with `stationId`, `stateType`, `stateCode`, `startedAt`, `endedAt?`, `sourceService`, `sourceEventId`, and a small payload snapshot.
- `stateType=production_state` means the station's main operational state. It is exclusive per station, so only one production-state interval may be active at a time. Codes are `unscheduled`, `planned_stop`, `running_nominal`, `speed_loss`, `downtime`, `unknown`.
- `stateType=attention_flag` means an attention or follow-up condition layered on top of the main state. It is concurrent by `stateCode`, so multiple attention flags may be active at the same time. Codes in v1 are `missing_operator`, `downtime_cause_overdue`, `downtime_confirmation_overdue`, `speed_loss_cause_overdue`, `speed_loss_confirmation_overdue`, `service_response_overdue`, `service_ongoing_overdue`.

## Hierarchy And Station Shapes

- **Leaf station** means an operational endpoint. It does the actual work capture for a machine-like unit such as a press, filler, tester, robot, packer, or CNC. In v1 a leaf must be `tag_driven`, because it is the lowest station that owns direct runtime interpretation inputs.
- **Aggregate station** means a structural or reporting node above other stations. It may represent a line, cell, area, island, packaging block, or transfer section. It can derive metrics from child stations and may optionally also have its own tags.
- Supported shapes in v1 are:
- `leaf + tag_driven`: normal machine station with mandatory runtime tags.
- `aggregate + derived`: pure structural node whose metrics come from configured contributing stations.
- `aggregate + tag_driven`: upper node that has both child stations and local tags, for example a conveyorized line segment or a production line with its own line counter or line run signal.
- `leaf + derived` is intentionally not allowed. A leaf should stay as the lowest operational anchor. If something is computed from other stations, it behaves like an aggregate even if it has only one contributor today.

```text
Example hierarchy

Production Line L1                      aggregate + derived or aggregate + tag_driven
|- Filling Block                        aggregate + derived
|  |- Filler 01                         leaf + tag_driven
|  |- Capper 01                         leaf + tag_driven
|  '- Vision Check 01                   leaf + tag_driven
|- Packaging Block                      aggregate + derived
|  |- Labeler 01                        leaf + tag_driven
|  '- Case Packer 01                    leaf + tag_driven
'- Line Conveyor                        aggregate + tag_driven
```

```text
State model example

Station: Filler 01
stateType=production_state  stateCode=running_nominal
stateType=attention_flag    stateCode=missing_operator
stateType=attention_flag    stateCode=service_response_overdue

Meaning:
- one main operational state
- zero or many simultaneous attention flags
```

- A parent station may have many children because that matches real manufacturing structures such as line -> cell -> machine or line -> machine. This is standard in ISA-95 style equipment models and common MES/OEE implementations.
- A leaf station may not have two parent stations in the core hierarchy. The core hierarchy is for ownership, visibility, schedule inheritance, and default roll-up context. Those responsibilities need one unambiguous parent path.
- If one leaf had two parents, several production-critical questions become ambiguous: which parent path determines visibility, which parent calendar or shift context applies, which aggregate receives the same downtime or output first, and how deletion or movement should behave without double counting.
- Multi-parent core hierarchy would turn the model from a tree into a DAG. That increases traversal complexity, descendant caching complexity, cycle validation cost, authorization ambiguity, and reporting error risk. The hardest production risk is accidental double counting in aggregate availability, productivity, and quality rollups.
- The production-grade rule is therefore: keep the core station hierarchy as a tree, and model any extra relationship explicitly elsewhere. Use `StationFlowEdge` for predecessor/sequence, use aggregate metric contributors for non-parent rollups, and use typed external/integration bindings for other cross-cutting references.
- If the business later needs one machine to appear under multiple logical views, add separate view/group projections instead of adding a second parent to the station itself. This preserves deterministic rollups and simpler operational queries.

## Typed Operational Configuration

- `tagBindings` are strict subdocuments, not a property bag. For tag-driven leaf stations, `productionCounterTag` and `runStateTag` are mandatory. `speedTag` is mandatory when `productivityMode=speed_based`. Additional counters are explicit typed entries such as `good`, `scrap`, `reserved_product`, or `product_specific`.
- These tags are field tags read from PLCs by Fledge south plugins, published by Fledge north plugins to an MQTT broker, then consumed by tag-service, which subscribes to MQTT and persists changed values in MongoDB. Station-service stores only validated tag identifiers from tag-service.
- Aggregate stations may have tag bindings, but they are optional. If aggregate metrics are derived, composition must be configured explicitly for every derived metric family the station exposes.
- `schedulingConfig` includes default shifts, calendar validity windows, weekly patterns, and date exceptions. Effective schedule precedence is fixed: `date exception > active calendar weekly pattern > default shifts`.
- `downtimeSettings` include `minimumMeaningfulStopMs`, `causeExpectedWithinMs`, `causeAttentionAfterMs`, `confirmationExpectedWithinMs?`, `confirmationAttentionAfterMs?`, and optional `autoCausePolicy` with `defaultAutoCauseCode`.
- `operatorSettings` include `presenceTrackingEnabled`, `operatorRequiredWhileScheduled`, `missingOperatorAttentionAfterMs`, and `autoCloseOnShiftEnd=true`.
- `serviceResponseSettings` include `serviceResponseRequired`, `responseExpectedWithinMs`, and `ongoingServiceAttentionAfterMs`.
- `speedLossSettings` include `minimumPerformanceRatio` or `minimumExpectedSpeed`, `minimumDurationMs`, `causeExpectedWithinMs?`, `confirmationExpectedWithinMs?`, `attentionAfterMs`, and `confirmationRequired`.
- `integrationBindings` are typed external bindings `{system, key, value}` used for event routing, validation, or projection. They are not a generic property map.

## Commands And Queries

- Public commands: create/update/archive/delete station, move station, set flow edges, set aggregate metric composition, update typed station config, set default shifts, create/update/activate/retire calendar, upsert date exception, start/end operator presence session, create/update/archive tool, link/unlink tool, record tool activity.
- Trusted internal commands: handle shift-ended event, open/update/close downtime case, open/update/close speed-loss case, ingest service-request lifecycle events, and project production-state changes from trusted upstream services.
- Public queries: get station, list stations, get station tree, get lineage/descendants, get predecessor flow, get station config, resolve effective schedule for a date or range, list active presence, list presence history, list station tools, list tool activities, query station-state intervals by time range, and query state summaries grouped by day/week/month.
- Internal queries: existence/basic context by station id/code, station visibility-safe lookup for other services, and reporting/state queries without external auth. Canonical station events are always published by `station-service` on `events.station`.

## Invariants, Lifecycle, And Failure Rules

- External ids, bindings, and tags are validated before commit. User/operator ids come from `user-service`; station tag identifiers come from `tag-service`; later business bindings come from their owning service. If the owner service cannot validate, the write fails closed.
- Duplicate active operator assignment for the same `stationId + operatorId` is forbidden. In v1, the same operator may still have active sessions on different stations.
- Automatic operator-session closure occurs only when a trusted shift-ended event is received and the station is effectively scheduled for that shift window.
- Schedule validity windows may not overlap for the same station. Date exceptions are unique per local date. Resolved working intervals may never overlap.
- Tool activity is rejected unless the station-tool pair is explicitly linked and active at the activity time.
- Speed loss is distinct from downtime. A speed-loss case is created only when the station is effectively scheduled, is not in downtime, is considered running by authoritative upstream state, and actual productivity stays below the configured threshold for at least `minimumDurationMs`.
- Downtime means meaningful non-running stop. Speed loss means the station is still running but below expected productivity. A station cannot have overlapping `stateType=production_state, stateCode=downtime` and `stateType=production_state, stateCode=speed_loss` intervals.
- Overdue follow-up and service/operator attention flags are created and closed by local projection rules from open cases, service events, schedule resolution, and operator sessions.
- Hard delete is strongly guarded and only allowed when the station has no children, no inbound flow/composition references, no active calendars, no active sessions, no tool links, no open cases, no state history, and no external dependencies. At minimum it must pass `user-service` dependency checks for `stationIds`. Otherwise only archive is allowed.
- Historical station state is stored durably in MongoDB, queryable by time range, and must survive restart. No in-memory-only state is authoritative.
- Consumed upstream/runtime events must be idempotent by `sourceEventId` because Redis Streams are at-least-once.
- Event publication follows current monorepo convention: persist first, then publish canonical domain events; publish failure does not roll back the write, but it is logged and auditable.
- All mutable aggregates use the shared audit log plugin. Runtime/state records also keep actor/source/trace metadata.

## Events And External Dependencies

- Publish on `events.station`: `station.created`, `station.updated`, `station.archived`, `station.deleted`, `station.hierarchy.changed`, `station.flow.changed`, `station.metric_composition.changed`, `station.schedule.changed`, `station.operator_presence.started`, `station.operator_presence.ended`, `station.operator_presence.auto_closed`, `station.tool.linked`, `station.tool.unlinked`, `station.tool.activity.recorded`, `station.downtime.opened`, `station.downtime.updated`, `station.downtime.closed`, `station.speed_loss.opened`, `station.speed_loss.updated`, `station.speed_loss.closed`, `station.state_interval.opened`, `station.state_interval.closed`.
- Every emitted event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant station/runtime ids.
- Depend on `user-service` for operator validation, visibility roots, and delete dependency checks.
- Depend on `tag-service` for validating station tag bindings. Fledge reads PLC data with south plugins, publishes through north plugins to MQTT, and tag-service subscribes to MQTT and persists changed tag values to MongoDB. Raw tags and time-series stay outside this service.
- Consume trusted normalized runtime/service/shift events from their owning services; those services keep ownership of detection and workflow logic.

## Acceptance Scenarios

- Creating a tag-driven leaf station without `runStateTag` or `productionCounterTag` is rejected.
- Creating a speed-based tag-driven leaf station without `speedTag` is rejected.
- Creating or updating an aggregate station without explicit metric composition for derived metrics is rejected.
- An effective schedule for a date uses date exception first, then active calendar weekly pattern, then default shifts, with no overlap.
- Starting the same operator on the same station twice while the first session is still open is rejected.
- Receiving a shift-ended event auto-closes only those open operator sessions whose station is scheduled for that shift.
- Recording tool activity for an unlinked tool-station pair is rejected.
- Opening a speed-loss case produces `stateType=production_state` with `stateCode=speed_loss` and later overdue attention flags if cause or confirmation thresholds expire.
- Hard deleting a station that is referenced by users, has children, or has historical state is rejected; archiving remains allowed.
- Querying station state by time range after a restart returns the same persisted intervals and day/week/month summaries.
- A user with `readStations` but visibility only to an aggregate station sees that station plus descendants, not unrelated stations.

## Assumptions

- Single factory timezone from deployment config; no per-station timezone in v1.
- Departments/business hierarchy are owned by a separate future service and are out of this spec.
- No separate pre-aggregated reporting cube in v1; day/week/month summaries are computed from durable state intervals.
