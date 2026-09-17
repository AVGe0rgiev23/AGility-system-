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
  hooks/       state orchestration, calls storage + engines + render
    ↓ may import
  render/      pure: view model, template engine, overrides
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
- `render/` is held to the same purity as `engines/`, one layer up: it may
  import only `render/`, `engines/` and `schema/`. Same lint rule set, and
  `src/render/import-allowlist.test.ts` is its allowlist. It takes plain data
  in and returns a node tree; the DOM adapter takes the document as an argument.
- Only `storage/repository.ts` imports `storage/db.ts`.
- `ui/` never imports `storage/db.ts` or Dexie.
- Nothing imports from `ui/` except `ui/` and `app.tsx`.

## Module map

```
src/
  schema/       Zod schemas, inferred types, migrations, fixtures
  storage/      db.ts, repository.ts, derived.ts, sync.ts, transfer.ts
  engines/      scoring, roi, estimate, run-cost, calibration, signals
  render/       view-model, resolve, template, overrides, nodes; print layout (Stage 3)
  hooks/        useStore, useTracedDraft, useConfigForm, useTransferFlow, useEngagementForm, useQuestionSetForm; discovery rules; useEngagement, useLibrary, useConfig, useDerived
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

## Rendering

Every document is a render of the engagement record through a template
(DATA-MODEL, `DocumentTemplate`), in three pure steps in `src/render/`:

1. **View model.** `buildViewModel` flattens one Engagement, the Config and the
   Library into plain data with every cross-reference followed. Optionals become
   `null`, so a missing key is always a template typo. Client-facing by default:
   breakdown rows with `audience: 'internal'` are dropped by their flag and the
   ranking fields are left out entirely, so a client template that names one
   fails to resolve rather than leaking it.
2. **Template engine.** `renderTemplate` resolves `{{path}}`, `showIf` and
   `repeatOver` per section into a node tree of text and elements. There is no
   HTML string anywhere; `toDom` builds real nodes through `createTextNode` and
   `createElement` only. A path that does not exist is a `RenderError` naming the
   path and the section, never an empty string. A null on the way is an error
   that points at `showIf`; in `showIf` itself a null, `false`, `0`, `''` or an
   empty list hides the section. Each section records every value it read,
   keyed by absolute view-model path (repeat items by index), and hashes exactly
   those reads with `hashInputs`. A hidden section records its `showIf` as
   `false`, so visibility is part of the hash.
3. **Overrides.** A section edit is pinned to that hash and carries the read
   values as `baseInputs` (DATA-MODEL, `SectionOverride`). On regeneration an
   override whose hash still matches is reapplied; one whose hash drifted is
   returned as a conflict with the edit, the freshly generated section and
   every drifted path with old and new value, while the fresh body renders.
   Nothing is dropped, and no stale edit is written over fresh data. Keeping
   the edit rebases it onto the fresh render and records the hash it was kept
   over in `rebasedFrom`.

Because the hash covers what a section read and nothing else, an unrelated
edit to the engagement never puts a section into conflict, and an edit to a
value it shows always does.

**Number formatting in prose rounds.** Interpolation prints a number through
`fmt`, two decimals at most, which is right for a sentence and wrong for a money
column: a stored 1234.567 prints as 1234.57 while the total is summed from the
unrounded figures. The investment and run-cost tables (Stage 3, task 4) need a
dedicated currency formatter that does not silently round, and every printed
line item must reconcile against its printed total.

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

## User interface

**Entry and shell.** `main.tsx` creates the store runtime once, outside React
(`hooks/use-store.ts`), and renders `app.tsx`, the only module outside `ui/` that
imports from it. `useStore` boots the runtime once, even under StrictMode. It loads
the store, then restores the folder from the loaded Config, and a folder that
cannot be restored never hides a store that loaded. Every screen has a hash
address (`ui/shell/router.ts`). Above every page the shell shows:

- the sync banner, from `warningFor`, with Connect or Reconnect when a user
  gesture can fix it
- a restore failure, a migration, or a skipped recompute
- a table of the stored records that do not validate

A refused load replaces the page with its reason, message and issue paths.

**Tokens.** `src/styles.css` resets Tailwind's palette, shadows, blurs and
animations, so only the tokens exist: `bg`, `surface`, `border`, `fg`, `muted`,
`accent`, `warn`, `danger`.

- **Accent** marks only the primary action, the active nav item and the focus
  ring.
- **Warn** and **danger** are status colours, never decoration. Warn: flags, low
  confidence, a `default` source, a stored-unit mismatch. Danger: invalid input,
  refused data.

**Numbers.** A figure renders through `InlineStat` or `Stat`. Their props require
a source (for a TracedValue) or a confidence (for a computed figure), so a bare
number cannot be rendered. Display uses a fixed `en-GB` locale with grouping, so
it rounds and prints `1,200.50`. When it rounds, the exact value is in the
element's title.

**TracedInput** is every numeric input. Its rules live in
`hooks/use-traced-draft.ts` as pure functions:

- **The field fixes the unit.** Engines never parse units, so letting the user
  pick one would let a minutes field carry hours. A money field builds its unit
  from the chosen currency, `EUR` or `EUR/hour`; no other field has a currency.
- **There is no default source.** Nothing is emitted until one is chosen: a
  silent `client-stated` would inflate confidence, and a silent `default` would
  raise `DEFAULT_COST`.
- **Only values that pass `TracedValueSchema` are emitted.** Its messages are the
  ones shown, so the UI decides text syntax only.
- **Typed numbers:**
  - The dot form, including the exponent form `String(value)` produces, is
    accepted.
  - **A dot before exactly three digits** (`1.200`, `12.345`) is German
    thousands notation as often as it is a decimal.
    - What counts: one to three whole digits, not starting with zero, then the
      dot and three digits. `0.125` and `1234.567` cannot be thousands groups and
      never warn.
    - It is read as the decimal and accepted, with an inline warning in the warn
      colour naming the other reading: "Read as 1.2, not 1200. Use 1200 or
      1200.00 if the dot was a thousands separator." The warning never blocks the
      value.
    - The warning depends on the text alone, never on whether the field was
      pre-filled. Deciding by context would make the same keystrokes mean
      different numbers, and the wrong one would surface in a proposal on exactly
      the edit that feels trivial.
    - Accepted knowingly: a stored `1.125` warns every time its field is opened,
      exactly as if it had been typed. If a field turns out to hold three-decimal
      values routinely, the fix is a per-field opt-out, never a change to this
      rule.
  - A single comma is accepted as the decimal point when unambiguous:
    `1200,50` is 1200.5.
  - Refused as ambiguous, because a guess risks a thousandfold error: more than
    one comma, a comma with a dot, or a comma followed by exactly three digits
    (`1,200`).
  - Parsing keeps the exact number. The editable text is `String(value)`, never
    display output, so any stored value can be edited and read back unchanged.
- **A stored unit the field does not record** is shown as a warning, in the same
  place as the dot warning. The next edit replaces it with the field's unit.
- **The draft is replaced only when the parent's value changes** to something
  the draft does not stand for, so an echoed value keeps the typed text and an
  invalid draft is never overwritten. The parent must apply `onChange` before the
  next keystroke, as synchronous React state does.
- **A pending draft is reported.** After every edit, `onPendingChange` says
  whether the text on screen is invalid and so has not reached the parent, which
  still holds the last valid value. A form with a Save button blocks saving while
  any traced field is pending, so it never stores a figure other than the one on
  screen. A box that unmounts reports itself unpending: its half-typed text goes
  with it, so leaving the tab, or answering a question that hides another, cannot
  leave a form refusing to save with no field on screen to fix.

**Tables sort** when the screen passes a sort state and `onSort`. A sortable
column gives a `sortValue`; its header becomes a button and carries `aria-sort`.
Sorting is pure (`ui/table-sort.ts`): missing values sort last in either
direction, text sorts by `en-GB` collation ignoring case and reading digits as
numbers, and equal rows keep their order. The screen owns the state, so its
choice can outlive the table.

**Path-addressed forms.** Settings, the engagement detail and the question-set
editor edit a record by path. They share the path helpers (`hooks/form-paths.ts`) and the controls and
save bar (`ui/views/form-controls.tsx`), which read a small `PathForm` interface.
A table cell's control keeps its label for screen readers only, inside a
positioned wrapper, so a hidden label cannot escape a horizontally scrolling table
and widen the page.

**Settings** edits every Config field on one screen (`ui/views/settings/`). Its
rules live in `hooks/use-config-form.ts` as pure functions; the rules about the
data stay in `ConfigSchema`, and the screen only places their messages.

- **Every field is addressed by its path**, such as `pricing.bands.1.floor`. The
  control carries the path as `data-config-path`, and it is the path
  `ConfigSchema` reports an issue at, so each issue shows under the control that
  fixes it.
  - A rule about a whole list shows under that list's table.
  - An issue with no field of its own is listed under "Other problems" at the
    top, so none is hidden.
  - A test breaks each rule in DATA-MODEL's Validation table and finds every
    issue under its control. It also holds the rendered paths to exactly the set
    the form model places issues at.
- **Numbers** are plain `NumberInput`s. Config values are definitions, not
  client figures, so they have no source. The typed text is kept and parsed by
  `parseNumberText`, with TracedInput's refusals and dot warning.
  - Text that does not parse never reaches the draft, so the schema's rules
    always run on valid types. At such a field only the text's own issue shows.
  - Empty text is `null` on a band's max hours, floor or ceiling and on a
    run-cost item's monthly cost. Where `null` is not allowed the schema says so
    at the field.
  - Nothing new starts as a silent zero. A new run-cost item has no monthly
    cost, which the schema refuses until one is typed or the item is made
    usage-based. The monthly cost is marked required only while the item is not
    usage-based. Each of the five fields of a new usage formula starts as empty
    text, a blocking "value required". Turning usage pricing off removes the
    formula and leaves the cost as it was, so an empty cost must then be chosen.
  - Adding, removing or moving an item in a list drops typed text under that
    list, since its indices shift.
- **Fractions are edited as stored**, `0.2`, with the percent in the label:
  "Testing overhead (20%)". The percent is read from the text now, and is absent
  while the text does not parse. A typed percent is never converted; `20` reads
  as 2,000% and the rule refuses it.
- **Four leaves are read-only**, each shown with its reason: `agencyCurrency`,
  `fxRates.rates.EUR`, `storage.syncFolderHandleId` and `storage.lastSyncAt`.
  Saving takes the last two from storage rather than the form, because a connect
  or a mirror write after the screen was opened changes them there.
- **Save** is enabled only for a change with no issues. It saves, then reloads the
  store, which recomputes every cache that reads Config, and resets the form.
  There is no navigation guard; the save bar says when changes are unsaved.
- **A stored Config that does not validate** shows why and offers "Start from
  defaults", which only fills the form. Nothing is written until Save.
- **Import and restore from folder** are one flow, `hooks/use-transfer-flow.ts`:
  idle, preparing, then prepared or refused, then applying, then loaded.
  - The diff shows the schema versions and any migration, the changed Config
    keys, that this machine's storage block is kept, and each record added,
    removed or changed.
  - The confirm button names the counts: "Replace the whole store: 1 added, 1
    removed, 1 changed". The Config counts as one record.
  - When anything is removed or changed, an acknowledgement must be ticked first.
    "Export the current store first" sits beside the button, and unsaved Settings
    edits are named as discarded.
  - A refusal shows its reason and its paths, issues, file errors or ids.
  - A preparation that finishes after being cancelled or superseded is dropped.
    A store being replaced cannot be cancelled.
  - Restore picks a mirrored folder with the same picker as connecting, and is
    offered only where the browser has one.
- **The folder panel** shows the folder's state, last sync and stale folders to
  delete by hand. It offers connect, reconnect, disconnect and sync now; sync now
  is the only way to write the folder when mirroring on every write is off.
  Without the File System Access API it points to export and import.
- **The store panel** shows the stored and supported schema versions, the running
  app version and the one that created or last migrated the store, and the
  store's times. Export downloads every stored record through a Blob URL.

**The engagement list** (`ui/views/engagements/`) is a sortable table of every
engagement that loaded, with its rules in `hooks/use-engagement-list.ts`.

- **Columns:** company (linking to the detail), stage, source, industry, tags,
  next action, due date and last update, shown as the local date. Stage sorts in
  pipeline order. The default sort is newest update first.
- **Filters:** stage, a tag in use, and next action (any, has one, has none, or
  due today or earlier). Today is the local calendar date, so "due today" does
  not flip over at midnight UTC; the schema holds due dates to `YYYY-MM-DD`, so
  they compare as strings. A due date of today or earlier shows in the warn
  colour.
- **Filters and sort are held by `App`**, so they survive opening an engagement
  and coming back. They are not in the address.
- **New engagement** is an inline panel: company name, industry, currency, source
  and stage.
  - Currency starts as EUR and stage as LEAD, both visible. Source has no default
    and is refused until chosen.
  - Industry is picked from `Config.industries`, or typed when the stored Config
    is unusable, and may be left empty, as the schema allows.
  - Issues show under each field once creating has been tried. Creating gives the
    engagement a UUID and the current time, starts its stage history at the chosen
    stage, saves, reloads, and opens it.

**The engagement detail** opens at `#/engagements/<id>/<tab>`, overview by
default. Its editing model is `hooks/use-engagement-form.ts`.

- **Every section of the record has a tab**, each with its own address. A section
  not built yet names the task that builds it. An unknown section offers the
  overview. An unknown id says whether the engagement does not exist or is stored
  but was left out for not validating.
- **One draft per engagement** covers the slices this screen edits: company,
  contacts, source, tags, next action and discovery sessions.
  - Nothing else from the record is copied into the draft. Save writes the latest
    loaded engagement with the draft on top, then reloads, which recomputes its
    caches, so a stale copy of the rest can never be written back.
  - The draft is replaced only when the stored slices change from what it started
    from. A reload that only recomputes cached results keeps the edit.
  - The draft survives switching tabs and is lost on leaving; there is no
    navigation guard. A tab with problems shows their count.
  - Discard and a reset advance a generation that keys the tab content, so every
    control remounts. Otherwise a TracedInput holding invalid text would keep
    showing it over the value it was reset to.
- **Issues are placed by path**, exactly as in Settings, against the engagement's
  own paths (`company.name`, `contacts.0.email`). The capture rules are
  `EngagementSchema`'s (DATA-MODEL, Company, Validation). Each tab's render test
  holds it to exactly the paths the form model places issues at.
- **Fields:**
  - Clearing an optional text or choice removes its key, since absent is the
    empty value.
  - The employee count is a plain `NumberInput`: DATA-MODEL types it `number`,
    and it feeds no client-facing figure. The blended hourly cost is a
    `TracedInput`, and its pending text blocks Save.
  - A next action exists while it has text or a due date; clearing both makes it
    `null`.
  - New tags, stated tools, compliance entries and contacts start blank. The
    schema refuses a blank tag or contact name.
- **Overview:** source, next action and tags are edited here. Stage, created and
  updated times, the id and the stage history are shown. The stage is chosen at
  creation and moves with the pipeline view (Stage 1, task 4).
- **Company:** every Company field. The detected stack is shown read-only, since
  signal extraction fills and confirms it (Stage 1, task 10).
- **Contacts:** one table, with add and remove. A removal takes effect on Save, so
  Discard brings a contact back.
- **Discovery:** a table of the sessions held, each opening in its own runner. A
  row shows the set, kind, when it was held, completeness, the answer count and
  how many problems are fixed inside it. A new session picks its set from the
  Library, listing first the sets whose `appliesTo` the company matches, defaults
  to now, and ticks its attendees from the contacts. Removal works like a
  contact's.
- **Deleting** asks first, naming the company and saying that a connected folder
  keeps its copy, listed as stale. It then returns to the list.

**The discovery runner** opens at `#/engagements/<id>/discovery/<sessionId>`. Its
rules are pure (`hooks/discovery-rules.ts`); the screen renders them.

- **One row per visible question**, in the order they are asked: the text, help
  text, kind, required marker, the control its kind needs, the four flags, and a
  Clear that unsays the answer entirely rather than leaving a half-answer.
- **Controls by kind.** Text and choice are an input and a select whose empty
  option clears; boolean is a yes/no pair with no default; multi is a checkbox per
  choice; number and duration are a `TracedInput`, whose pending text blocks Save
  like any other.
- **Visibility runs in question order.** A condition sees only answers to
  questions that are visible and earlier, so what is on screen can always be read
  top to bottom. An answer to a question that is later hidden is kept, counts
  towards nothing, and is listed under the hidden count.
- **Completeness is stored and recomputed on every answer,** shown with its
  basis: "40% complete · 4 of 10 required answered". A session with no required
  question showing is complete.
- **A mapped answer lands on the engagement as it is given,** so the Company tab
  shows it before the session ends, and one Save stores both. Beside the control a
  note names the path and what is stored there now. A figure lands whole, keeping
  its source and note, linked back to the answer and dated to the session. A multi
  answer adds what is missing and never removes. Clearing an answer leaves the
  path as it was: a figure already given is not unsaid by an empty box. A
  `process.*` answer is recorded and lands nowhere until process mapping exists
  (Stage 1, task 8), which the note says.
- **Raw notes** sit alongside the answers, kept as typed.
- **An answer's issues show on its own row**, matched by the
  `discovery.<i>.answers.<j>` prefix, so a rule about any part of an answer is
  fixed where the answer is given. The sessions table counts them per session.
- **A question set that has gone** leaves the session readable: the answers are
  listed by question id with a notice, and nothing further can be answered.

**Question sets** are edited in the Library at `#/question-sets`, one set at
`#/question-sets/<id>`, with the form model in `hooks/use-question-set-form.ts`.

- **The list** shows each set's kind, what it applies to, its question count and
  how many sessions use it. A set a session uses cannot be deleted, and the row
  says how many. "Add the standard question sets" appears only while a seeded id
  is missing.
- **The editor** is path-addressed like Settings: set fields, then a table of
  questions with their kind, required flag, unit, mapping, choices, help text,
  order and removal. Ids are generated and shown but never edited, because
  conditions name them.
  - The `mapsTo` picker offers only the paths the question's kind can fill, so no
    answer can land as the wrong type. Changing a kind drops what the new kind
    cannot carry and keeps the mapping if it still fits.
  - The condition builder nests all-of and any-of groups over equals, greater
    than and includes, and a leaf picks only an earlier question, with the value
    control following that question's kind.
  - A condition naming a question the set does not have is refused here, although
    the schema tolerates it, so none is ever written from the app.

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
