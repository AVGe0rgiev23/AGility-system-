# AGility OS — Project Constitution

Read this file fully before any task. It overrides your defaults.
Then read `docs/MODEL-ROUTING.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`,
`docs/ENGINES.md` and `docs/BUILD-PLAN.md`.

Document version: 2. Filenames use hyphens, never underscores.

## What this is

A private, single-user, local-first operating system for AGility, a one-person
custom software and AI automation agency run by Alex Georgiev.

The core concept: **one typed engagement record per company. Every artifact is a
deterministic render of that record.** Teardowns, proposals, SOWs, project plans
and handover docs are all views over the same data. Nothing is ever retyped.

Second concept: **a pattern library that learns.** Each automation pattern carries
estimated build hours. Closing a project writes actual hours back. Estimates get
calibrated against real delivery history.

The pipeline, end to end:

```
CLIENT → DISCOVERY → PROCESS → OPPORTUNITY → ROI → ESTIMATE → PRICE
  → PROPOSAL → ACCEPTANCE CRITERIA → SOW → PROJECT → DELIVERY
  → HANDOVER → CASE STUDY → HISTORICAL DATA → (feeds ESTIMATE)
```

The benchmark for success: a new inquiry reaches a fully calculated proposal and
SOW with zero duplicate data entry.

## Non-negotiables

1. **Zero recurring cost.** No paid API, no hosted database, no SaaS dependency,
   no service that bills monthly. If a feature can only work by paying someone
   every month, do not build it that way.
2. **No AI required.** Every feature must work with zero model calls. Scoring is
   arithmetic. Documents are templates. Diagrams are generated geometry. An
   `AIProvider` interface exists with a null implementation; that is the default
   and the app must be fully usable with it.
3. **Local-first.** All data lives on Alex's machine. There is no backend, no
   auth server, no sync service. The deployed bundle is static and stateless.
4. **Portable.** Every byte of data is exportable as plain JSON and Markdown.
   The app must be replaceable without data loss. No proprietary formats.
5. **Do not touch the marketing site.** This is a separate application in a
   separate repo. It has no relationship to the AGility website.
6. **Reason in EUR.** The agency currency is EUR. See DATA-MODEL, Currency.

## Stack

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS
- Zod for all schema definition, validation and version migration
- Dexie (IndexedDB wrapper)
- File System Access API for folder sync, with download/upload fallback
- Vitest for tests

## Banned dependencies

Do not add, and do not suggest: Next.js, any state management library (Redux,
Zustand, Jotai, MobX), any ORM, tRPC, any UI component library (MUI, Chakra,
Ant, shadcn), any charting library, any PDF library, any diagramming library,
any routing library, any AI SDK, any date library heavier than native `Intl`.

React state plus context is sufficient. Print-to-PDF uses the browser. Diagrams
are hand-generated SVG. Routing is a hash-based switch of roughly 40 lines.

**Never install a package without asking first.** State what it does, its
install size, and what it replaces.

## Code conventions

- TypeScript strict. No `any`. No non-null assertions except with a comment
  explaining why the invariant holds.
- **Engines are pure.** Everything in `src/engines/` takes plain data in and
  returns plain data out. No storage access, no React, no `Date.now()` except
  via an injected clock, no reads from the Library. Calibration data is passed
  in as an explicit `CalibrationLookup` argument.
- Every engine function has unit tests. Scoring, ROI, estimation and calibration
  also get property tests for the invariants listed in ENGINES.md.
- Components are dumb. Logic lives in engines and hooks.
- No barrel files, with one exception: `src/schema/index.ts` may re-export
  schemas.
- Comments explain why, never what.

## Data rules

- **One global schema version**, stored in the `meta` table and mirrored to
  `.schema-version` on disk. Individual records do not carry their own version.
  Migrations operate on the whole store atomically.
- Every schema change ships with a migration function and a test that migrates a
  fixture from the previous version.
- Zod-validate at every boundary: reading from IndexedDB, importing JSON,
  reading a synced file. Never trust stored data.
- **Never use `innerHTML`, `dangerouslySetInnerHTML`, or string-concatenated
  HTML with user data.** Rendered documents build DOM nodes or use React.
- No secrets in the bundle. If an AI provider key is ever added, it lives in
  IndexedDB only and is never logged, never included in exports by default, and
  never sent anywhere except the provider endpoint.
- Every write goes through `src/storage/repository.ts`. No other module imports
  Dexie. Enforced by an eslint `no-restricted-imports` rule.

## Design system

Dark, dense, technical. The reference points are Linear and a trading terminal,
not a SaaS dashboard template.

- One background, one elevated surface, one border colour. No gradients.
- Monospace (`ui-monospace`) for all numbers, identifiers, hours, currency and
  codes. Sans for prose.
- Information density over whitespace. Tables, not cards. If something is a list
  of records, render a table.
- One accent colour, used only for primary action and active state.
- No glow, no glass, no shadows beyond a 1px border, no decorative animation.
  Transitions max 120ms and only on interactive state.
- **Every number displayed alongside its confidence or source.** This is a hard
  rule, not a preference. It is what makes the tool trustworthy in front of a
  client.

## How to work

- **Plan before building.** Enter plan mode at the start of every task. Show the
  file list and the approach. Wait for approval.
- One stage per branch. One logical change per commit.
- Read `docs/BUILD-PLAN.md` for the current stage's tasks and acceptance
  criteria. Do not skip ahead to a later stage.
- `docs/DATA-MODEL.md` and `docs/ENGINES.md` are specifications, not
  suggestions. If you think one is wrong, say so and stop. Do not silently
  deviate.
- Run `npm run typecheck && npm run test` before declaring a task done.
- If a task is ambiguous, ask one question. Do not guess and build.
- When you propose an abstraction that was not asked for, expect to be refused.
  One person must be able to maintain this in three years.
