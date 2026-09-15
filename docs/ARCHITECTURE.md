# Architecture

## Why a separate application

The AGility marketing site is a public Next.js app that must stay fast,
indexable and stable. AGility OS is a private single-user tool with no server, no
SEO surface, and a completely different dependency profile. Sharing a project
would ship internal-tool dependencies in the marketing bundle and let an internal
deploy break the shopfront. Separate repo, separate deploy, no shared code.

## Runtime shape

A static bundle. No server, no API routes, no database process. Alex opens it
either from `localhost` during `npm run dev` or from a static host. All state
lives in the browser's IndexedDB and, when the folder is connected, mirrored as
plain files on disk.

## Layers and dependency direction

```
  ui/          React components, no business logic
    ↓ may import
  hooks/       state orchestration, calls storage + engines
    ↓ may import
  engines/     pure functions, no side effects        schema/   Zod + types
    ↓ may import                                        ↑
  schema/                             everything may import schema
```

```
  storage/     repository.ts is the only module importing db.ts
    ↓
  Dexie / IndexedDB / File System Access API
```

Hard rules, enforced by lint, and for engines by lint plus a test:

- `engines/` may import only from `schema/` and other files in `engines/`. Never
  from `storage/`, `ui/`, `hooks/`, or any browser API. Lint is a denylist: it
  bans the other layers, React, Dexie, a list of browser globals, and the clock
  and random calls. `src/engines/import-allowlist.test.ts` is the allowlist: it
  fails on any import that resolves outside `engines/` and `schema/`. A browser
  global missing from lint's list is not caught automatically.
- Only `storage/repository.ts` imports `storage/db.ts`.
- `ui/` never imports `storage/db.ts` or Dexie.
- Nothing imports from `ui/` except `ui/` and `app.tsx`.

## Module map

```
src/
  schema/       Zod schemas, inferred types, migrations, fixtures
  storage/      db.ts, repository.ts, sync.ts, transfer.ts
  engines/      scoring, roi, estimate, run-cost, calibration, signals
  render/       template engine, view-model flattening, print layout (Stage 3)
  hooks/        useEngagement, useLibrary, useConfig, useDerived
  ui/           shell/, primitives/, views/
  app.tsx
```

## Derived data policy

Engine results (`ScoringResult`, `ROIResult`, `EstimateResult`, `RunCostResult`)
are **cached in the record but never authoritative**. Every one carries
`computedAt` and `inputsHash`. On load, the app recomputes and compares the hash;
a mismatch triggers a silent recompute and write-back.

This means: a stale cached score can never be shown to a client, and a Config
change (say, raising the hourly rate) correctly invalidates every engagement.

**The hash covers inputs, not engine behaviour.** When an engine changes what it
computes from the same inputs, every stored hash still matches, and the old
results would be served forever. Such a change therefore ships with a schema
migration that sets the affected cached results to `null`, as `v1-to-v2.ts` does.
They recompute on load, with the same hashes as before.

**Conflict detection compares hashes, never results.** Stage 3 decides whether an
override has drifted by comparing its `baseInputsHash` with the current
`inputsHash`. It never compares recomputed results with earlier ones. An
engine-behaviour migration recomputes results under unchanged hashes, so
comparing results would mark every existing override as conflicted after it.

## Persistence

**Working store:** IndexedDB via Dexie. Tables `engagements`, `library`,
`config`, `meta`.

**Mirror:** when a directory handle is connected, every write also serialises to
disk. Layout in DATA-MODEL.md. Keep that folder as a private git repo. That is
the backup, the version history and the portability story, at zero cost.

**Direction is one-way.** The app writes to disk; it does not watch or read back
during normal operation. Disk files are read only during an explicit
"restore from folder" action, which is a full-store replace behind a confirm
dialog with a diff.

**`rendered/` is export-only.** HTML snapshots of sent proposals live there for
your records. Nothing reads them. Deleting the folder loses no application data.

**Fallback:** browsers without the File System Access API (Safari, Firefox) get
manual export and import buttons and a persistent warning that no folder is
connected.

## Security model

There is no server, so there is no server-side attack surface. What remains:

| Risk | Mitigation |
|---|---|
| Stored XSS from client-supplied text | No `innerHTML` anywhere. Templates build DOM nodes. Rendered HTML export escapes all interpolations. |
| Malicious import file | Zod validation before anything is applied, dry-run diff shown, user confirms. |
| Prototype pollution via JSON import | Zod strips unknown keys. Reject `__proto__`, `constructor`, `prototype` keys explicitly. |
| Accidental client data exposure | Nothing leaves the machine. No analytics, no telemetry, no error reporting service, no external fonts or CDN. |
| Data loss | Folder sync on by default, plus a startup warning when no folder is connected. |
| Laptop theft | Optional WebCrypto encryption at rest with a passphrase (Stage 5, not required earlier). |
| Future AI key leakage | Key in IndexedDB only, excluded from exports by default, never logged, redacted in any error output. |

## What is deliberately not built

- Drag-and-drop workflow canvas. Structured node lists plus generated SVG give
  90% of the value at 10% of the cost. Revisit only after a month of real use.
- Multi-user, collaboration, sharing, comments. Single operator by design.
- Any server component. The moment one exists, so does a recurring bill.
- Cloud sync. Git on the data folder covers it for free.
