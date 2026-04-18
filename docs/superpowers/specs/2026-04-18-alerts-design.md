# Alerts Design

## 1. Purpose

This document makes a narrow product and naming decision for the future `alerts`
module/service.

The goal is to lock the name and scope direction early without prematurely designing API
contracts, entity details, or workflows before the core MES foundation is stable.

The current priority remains a solid, production-ready core application with minimal
ambiguity and minimal architecture churn.

## 2. Naming Decision

The unified name is:

`alerts`

This name is intentionally used as a product-facing and technical umbrella term.

`alerts` is chosen because it is:

- short,
- easy to remember,
- clean in navigation and module naming,
- usable in future UI labels such as `Alerts`, `Open Alerts`, `Alert Rules`, and
  `Alert History`,
- broad enough to cover both telemetry-driven alarms and operational problems.

The team explicitly accepts that some alerts will not be simple threshold alarms. In this
product, an `alert` can represent any important condition that requires attention.

## 3. Scope Decision

`alerts` is a single future problem center for the factory.

It is intended to cover two families of conditions:

### 3.1 Rule-Based Alerts

These are conditions evaluated from tag and time rules, such as:

- a tag value exceeding a threshold,
- a tag value staying below a threshold for a duration,
- a machine run tag staying stopped for too long,
- missing telemetry or stale telemetry conditions.

### 3.2 Domain-Based Alerts

These are conditions derived from MES business context, such as:

- machine running without an active job order,
- machine running without an operator,
- downtime remaining without a reason for too long,
- other future cross-service operational problems.

## 4. Core Boundary

The future `alerts` module is intended to be the unified place where users see active
problems.

The system direction is:

- users should not need separate mental models for "alarm", "attention", and "issue",
- the product should present a single alert center,
- different source systems may still detect different conditions,
- lifecycle and product language should converge under `alerts`.

This decision does **not** mean that the future `alerts` module must calculate every
business condition by itself. Detection may remain distributed across domain services
where that is the cleaner design.

## 5. Current Non-Goals

This document does not decide:

- API design,
- database schema,
- event contracts,
- alert lifecycle state model,
- rule engine implementation,
- notification channels,
- web UI flows,
- productivity-to-alert migration details,
- removal strategy for current attention-related concepts.

## 6. Deferred Topics

These topics are intentionally postponed, but must not be forgotten:

- `ack / silence / assign` workflow,
- notification and escalation behavior,
- ownership and responsibility model for open alerts,
- alert inbox / alert center UX,
- domain event contracts between `productivity` and `alerts`,
- migration away from attention-oriented concepts in existing specs,
- whether alert detection is centralized, distributed, or hybrid.

## 7. Future Product Opportunities

These are product opportunities, not current implementation scope:

- **Executive Alert Digest**: daily or shift-based summary for owners and production
  managers,
- **Alert Cost Visibility**: estimated loss impact in time, output, or money,
- **Recurring Alert Detection**: highlight repeated chronic problems instead of isolated
  events,
- **Factory Heatmap**: show which work centers or lines generate the highest alert load,
- **Alert Timeline**: show how an alert started, changed, and closed,
- **Alert-to-Action Flow**: later turn alerts into assigned operational follow-up,
- **Shift Comparison**: compare alert density and patterns across shifts or days.

These ideas are valuable because they strengthen the sales story for factory owners and
production managers without forcing premature implementation in the core phase.

## 8. Impact On Future Specs

This decision affects upcoming specs in the following way:

- future alert-related work should use the name `alerts`,
- future product language should prefer `alert` over fragmented naming such as separate
  "attention" and "alarm" concepts,
- `productivity` should later be reviewed with this decision in mind,
- any current attention-state or attention-tag design should be revisited later against
  the unified `alerts` direction,
- future web and module naming should be built around `alerts`.

## 9. Final Decision

The project adopts `alerts` as the future unified name for factory conditions that require
attention, including both rule-based telemetry alarms and domain-derived operational
problems.

This is currently a naming and scope decision only.
