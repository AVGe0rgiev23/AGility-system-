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
    ↓ may import                    also engines/ and schema/, to recompute
  Dexie / IndexedDB / File System Access API     derived data on load
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
  storage/      db.ts, repository.ts, derived.ts, sync.ts, transfer.ts
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

The repository orchestrates this and `storage/derived.ts` does the work; the
engines stay pure. Each engine runs, and its result replaces the cached one only
when the hashes differ or nothing was cached. A matching cache stands with its
original `computedAt`. The write-back does **not** bump `updatedAt`: a recompute
is not an edit, `updatedAt` means when Alex last touched the record, and
`computedAt` already records the recompute. Recompute is skipped, and the skip
reported, while Config or Library fails validation, since the engines need both.

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
`config`, `meta`. Keys and the folder handle's place are in DATA-MODEL, Storage
layout.

**Every read is validated, and a bad record never takes the app down.**
`repository.load()` never throws.

- A corrupt engagement is reported and left out of the loaded store.
- A corrupt Config or Library loads as `null` and is reported. Defaults are
  never substituted: they would change every price, and a later save would
  overwrite the stored record without anyone asking. It comes back only through
  an explicit save, import or restore.
- Nothing corrupt is deleted or overwritten by the load itself.
- The load refuses, and writes nothing, when:
  - the data is from a newer schema version
  - data exists with no meta record, or with a meta record that does not validate
  - a migration fails
  - the database cannot be read

**Migration on load.** An older store is migrated as a whole with
`runMigrations`, stamped with `lastMigratedAt` and the app version, and written
back in one transaction before anything else runs.

**Writes** are validated with Zod before IndexedDB is touched, so an invalid
record is rejected and nothing is stored. `saveEngagement` bumps `updatedAt`. A
whole-store replace (import or restore) and a migration keep each record's own
`updatedAt`. Each committed write is announced to one listener, the mirror; a
failure in the listener never fails the write.

**Mirror:** when a directory handle is connected, every write also serialises to
disk. Layout in DATA-MODEL.md. Keep that folder as a private git repo. That is
the backup, the version history and the portability story, at zero cost.

- A per-write mirror writes only the record written.
- Connecting, reconnecting, "sync now", a migration and a store replace write
  everything, corrupt records included, so the folder is an exact copy that can
  be fixed by hand.
- Writes are queued so none interleave.
- A mirror failure shows in the sync status. The data is already safe in
  IndexedDB and is written on the next sync.
- Recording `lastSyncAt` is not itself mirrored, since that would loop.
- A folder handle whose permission lapsed comes back as needs-permission, and a
  user gesture reconnects it.

**Direction is one-way, and the mirror is strictly additive.** The app writes to
disk; it does not watch or read back during normal operation, and it never
deletes anything from the folder, which is the git-tracked backup.

- A renamed engagement is written to its new folder. The old folder keeps its
  last copy and is reported as stale.
- A deleted engagement's folder is reported as stale.
- A full mirror lists folder names under `engagements/` (it never reads their
  contents) and reports any it did not write.
- Alex deletes stale folders by hand.

Disk files are read only during an explicit "restore from folder" action, which is
a full-store replace behind a confirm dialog with a diff. A restore refuses a
folder where one engagement appears in two folders, rather than guessing which is
stale.

**Import and restore** share one path, and nothing is written until the diff is
confirmed:

1. Reject any `__proto__`, `constructor` or `prototype` key, naming its path.
2. Refuse a newer version.
3. Run `runMigrations`, which also refuses a `.schema-version` that disagrees
   with `meta.json`, and validates.
4. Refuse duplicate engagement ids.
5. Diff against what is stored: added, removed and changed records, and changed
   Config keys.

This machine's `Config.storage` block is kept, because an imported one would
point the mirror at a folder handle that does not exist here. Applying replaces
the whole store and reloads, which recomputes the caches. An export writes every
stored record, corrupt ones included.

**`rendered/` is export-only.** HTML snapshots of sent proposals live there for
your records. Nothing reads them. Deleting the folder loses no application data.

**Fallback:** browsers without the File System Access API (Safari, Firefox) get
manual export and import buttons and a persistent warning that no folder is
connected. `sync.ts` reports the status and the warning text for every state
short of a healthy connection; the banner itself is part of the app shell.

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
