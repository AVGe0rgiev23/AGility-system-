# Build Plan

Version 2. Six stages. Stages 0–3 are the usable product; ship and start using it
there. Stages 4–5 are upside. Do not start a stage before the previous one's
acceptance criteria all pass.

One branch per stage: `stage-0-foundation`, `stage-1-capture`, and so on.

## Model assignment

The €85 Fable promo expires **19 September 2026**. It is use-it-or-lose-it, so it
is front-loaded onto the two stages that are expensive to get wrong.

| Stage | Design | Implementation | Rationale |
|---|---|---|---|
| Doc audit | **Fable** | — | Macro pass across all five documents |
| 0 Foundation | **Fable** | **Fable** | Schema and migrations propagate everywhere |
| 1 Capture | Sonnet | Sonnet + Haiku subagents | Volume CRUD, low ambiguity |
| 2 Engines | **Fable** | **Fable** | Correctness-critical arithmetic and property tests |
| 3 Output | Opus (override-diff design) | Sonnet | Templating is mechanical |
| 4 Delivery | Opus (SVG layout) | Sonnet | Graph layout is fiddly |
| 5 Compounding | Opus | Sonnet | Statistics that drive pricing |

After 19 September, Fable rows fall back to Opus. See `docs/MODEL-ROUTING.md`
for switching mechanics and the escalation protocol.

---

## Stage 0 — Foundation

Nothing works without this and retrofitting it is painful.

### Tasks

1. Scaffold Vite + React + TS strict + Tailwind + Vitest. Scripts: `dev`,
   `build`, `typecheck`, `test`, `lint`.
2. Add the eslint `no-restricted-imports` rules from `docs/ARCHITECTURE.md`
   (nothing outside `storage/repository.ts` imports `storage/db.ts`; `engines/`
   imports only `schema/` and other engine files, enforced by lint plus
   `src/engines/import-allowlist.test.ts`).
3. Implement every schema in `docs/DATA-MODEL.md` as Zod schemas in
   `src/schema/`. Infer types; never hand-write them. Build order:
   `traced` → `process` → `opportunity` → `blueprint` → `discovery` →
   `scope` → `engagement` → `library` → `config` → `meta`.
4. `MAPPABLE_PATHS` const array plus derived Zod enum and type. Question-set
   saves validate every `mapsTo` against it.
5. Migration framework in `src/schema/migrations/`: `runMigrations(store, from)`
   operating on the whole store, a single global version in `Meta`, a v1 whole-
   store fixture, and a passing migration test. Build this before any real data
   exists.
6. `src/storage/db.ts` declares the Dexie instance, with tables `engagements`,
   `library`, `config`, `meta`. `src/storage/repository.ts` is its only consumer.
   Zod-validate on every read. Bump `updatedAt` on every write. Nothing else in
   the codebase imports Dexie or `db.ts`.
7. `src/storage/sync.ts`. Persist the directory handle. Mirror writes to the
   layout in DATA-MODEL.md, including `.schema-version`. Feature-detect and fall
   back to manual export/import with a persistent warning banner.
8. `src/storage/transfer.ts`. Full export to one JSON file. Import with Zod
   validation, prototype-pollution key rejection, and a dry-run diff before
   applying.
9. Seed Config with every default from DATA-MODEL.md, including the `estimation`
   block, `agencyCurrency`, `fxRates` and the three pricing bands. Settings
   screen to edit all of it.
10. Design tokens and app shell per CLAUDE.md. Hash router of roughly 40 lines,
    hand-written. Primitives: `Table`, `Field`, `Stat`, `ConfidenceBadge`,
    `TracedInput`. Build `TracedInput` last and most carefully; Stage 1 leans on
    it constantly.
11. `src/engines/` created empty with a README stating the purity rules.

### Acceptance criteria

- [ ] `npm run typecheck && npm run test && npm run lint` all clean
- [ ] Create an engagement, hard refresh, it persists
- [ ] Connect a folder, make an edit, watch the JSON change on disk
- [ ] Export, wipe IndexedDB entirely, import, full restore with diff shown
- [ ] Hand-corrupt a stored record; the app reports it and keeps running
- [ ] An import containing a `__proto__` key is rejected
- [ ] A v1 whole-store fixture migrates to current and validates
- [ ] The lint rule fails a deliberate `import Dexie` in a component

---

## Stage 1 — Capture

### Tasks

1. Engagement list: dense table, sortable, filter by stage, tag, next action.
2. Engagement detail with tabbed sections, URL-addressable via the hash router.
3. Company and contact forms. Every numeric field uses `TracedInput` with source
   selector, note field and currency where relevant.
4. Pipeline view by stage. Transitions append to `stageHistory`.
5. Question set editor with `showIf` builder and `mapsTo` picker restricted to
   `MAPPABLE_PATHS`.
6. Discovery session runner: conditional display, answers mapped to engagement
   paths, live completeness.
7. Seed two question sets: teardown (roughly 12 questions) and full discovery
   (roughly 35, branching).
8. Process mapping: steps, systems, frequency, `roleHourlyCost`, error profile,
   bottleneck flags.
9. Opportunity capture linked to processes, with `effortInputs` and
   `primaryPatternId` selection.
10. Signal extraction per ENGINES §6, with a paste box and per-suggestion confirm.

### Acceptance criteria

- [ ] Run a full discovery session end to end using only the app
- [ ] A branching answer changes which questions appear
- [ ] An answer mapped to `company.blendedHourlyCost` lands there with its source
      and note intact
- [ ] Saving a question set with an invalid `mapsTo` is refused with a clear error
- [ ] Every screen usable by keyboard
- [ ] No number anywhere is shown without its source visible or one hover away

---

## Stage 2 — Engines

The stage that makes the tool worth building. Fable throughout, or Opus after
19 September.

### Tasks

1. `scoring.ts` per ENGINES §1, including the full `breakdown` and `assumptions`
   arrays and `inputsHash`.
2. `estimate.ts` per §2. Calibration applied here and nowhere else.
3. `runCost.ts` per §3, all three delivery models, both retainer warnings.
4. `roi.ts` per §4, three scenarios, conservative first.
5. `calibration.ts` per §5.
6. `buildCalibrationLookup` and the `inputsHash` utility.
7. Unit tests for every function plus property tests for every invariant listed
   in ENGINES.md. Include the explicit test that **calibration data does not
   affect scoring output**.
8. Derived-data recompute: on load, compare `inputsHash`, recompute on mismatch,
   write back.
9. Pattern library CRUD, seeded with: lead enrichment, email triage, document
   extraction, CRM sync, webhook processing, approval workflow, reporting
   automation, invoice processing.
10. Opportunity scoring UI: ranked table, quadrant view, expandable working panel
    showing every term.
11. Scope builder: select opportunities, pick delivery model, set support
    retainer, see estimate, price, band, effective hourly rate, run cost and ROI
    update live.

### Acceptance criteria

- [ ] All property tests pass, including the calibration-isolation test
- [ ] With every multiplier at 1.0, `totalHours === rawHours × 1.702`
- [ ] Enter a real past project; compare the estimate to what it actually took
      and write down the gap
- [ ] Changing any single input moves exactly the right downstream numbers
- [ ] Every client-facing figure traces to a TracedValue in two clicks
- [ ] `UNDERPRICED` fires on a scope exceeding its band and blocks proposal render
- [ ] Changing `targetHourlyRate` in Config invalidates and recomputes every
      cached estimate

---

## Stage 3 — Output

### Tasks

1. Template engine: mustache-style resolution against a flattened view model,
   `showIf` and `repeatOver`. Builds DOM nodes; never `innerHTML`.
2. Override-diff system: section-level edits stored with `baseInputsHash`.
   On regeneration, reapply; when the hash has drifted, show a conflict and let
   Alex keep either version.
3. Print stylesheet: A4, page breaks that never split a table row, running header
   with company name, page numbers, no browser chrome.
4. Proposal template: executive summary, current situation, identified problems,
   proposed automation, workflow overview, expected outcomes, ROI (conservative
   first), implementation phases, timeline, assumptions table, exclusions,
   deliverables with acceptance criteria, investment, run-cost table per delivery
   model, next steps.
5. Acceptance criteria editor: each deliverable prompts for observable, binary
   criteria. **Proposal render is refused when any deliverable has none.** This is
   what protects the guarantee.
6. SOW template derived from the proposal, adding change process, payment
   schedule and delivery-model terms.
7. Teardown template: short, includes the honest "buy an existing tool" outcome
   as a first-class option.
8. Artifact versioning, `sentAt` marker, HTML snapshot written to
   `rendered/` on send.

### Acceptance criteria

- [ ] Generate a proposal, print to PDF, and it looks like something a
      consultancy sends
- [ ] Edit a section, change an upstream number, regenerate: the edit survives
      and a conflict is shown
- [ ] Every figure in the proposal appears in the assumptions table with its
      source
- [ ] A deliverable with no acceptance criteria blocks the render
- [ ] Interpolating a company name containing `<script>` produces visible text,
      not markup

**Ship here.** Use it on three real teardowns before building Stage 4.

---

## Stage 4 — Delivery

1. Blueprint node editor: structured list, node kinds, reorder, branch.
2. Deterministic SVG renderer: layered top-to-bottom layout, branch handling,
   node-kind colour coding, print-friendly.
3. Mermaid text export.
4. `advisoryHours` per node, displayed as a cross-check beside the estimate,
   never summed into price.
5. Project plan expansion: scope phases and pattern blueprints become tasks with
   estimated hours and `patternId` attached.
6. Task board and time logging.
7. Handover documentation template generated from the blueprint.

No drag-and-drop canvas. Revisit only if the list version genuinely annoys you
after a month of real use.

---

## Stage 5 — Compounding

1. Calibration write-back on project close, with the completeness gate.
2. Estimate accuracy dashboard: per-pattern multipliers, sample counts, drift.
3. Effective-hourly-rate trend across all closed projects.
4. Win-rate analysis by source, industry, band and quadrant.
5. Case study generator from closed engagements.
6. Optional WebCrypto encryption at rest.
7. `AIProvider` interface with a null default, one optional adapter behind a
   settings toggle and a bring-your-own-key field.

---

## Working rules for every stage

- Enter plan mode first. Approve the plan before code.
- Never install a dependency without asking.
- `npm run typecheck && npm run test && npm run lint` before any task is done.
- Commit per logical change, not per session.
- After each stage, commit the data folder repo too.
- Refuse abstractions nobody asked for.
