# Model Routing

Claude Code cannot change its own model. Alex changes it with `/model`. Your job
is to **recognise when the current model is wrong for the task and say so before
starting**, then wait.

## The four models

| Model | Cost to Alex | Use for |
|---|---|---|
| **Fable 5** | €85 promo credit, **expires 19 Sep 2026** | Whole-system macro passes, Stage 0 and Stage 2 design and implementation, deep multi-step autonomous runs |
| **Opus 5** | Included in Pro | Default heavy reasoning: architecture, schema, engine logic, pricing and ROI formulas, security, migrations, multi-file debugging when Sonnet is stuck |
| **Sonnet 5** | Included in Pro | Implementation engine: React components, forms, CRUD, styling, TypeScript types, unit tests, glue code |
| **Haiku 4.5** | Included in Pro | File search, renames, inline formatting, trivial edits, minor docs. Also the subagent model. |

## Fable spend plan (time-boxed)

The promo credit is use-it-or-lose-it and dies on 19 September. It is worth
roughly six to twelve hours of heavy agentic work. Spend it on the stages that
are expensive to get wrong:

| When | What | Model |
|---|---|---|
| Before Stage 0 | Whole-document consistency audit | Fable |
| Stage 0, all of it | Schema, migrations, storage, sync | Fable |
| Stage 2, all of it | Engines, formulas, property tests | Fable |
| After 19 Sep | Everything else | Opus / Sonnet |

Stage 1 and Stage 3 are volume work. Sonnet handles them and Pro covers them for
free. **Never spend Fable on React forms.**

## Escalation protocol

Before starting any task, classify it. If the current model does not match, stop
and say exactly this shape of thing:

> This is engine logic with correctness requirements. Recommend switching to
> Opus before I start: `/model opus`, press `s` for session-only. Waiting.

Then wait. Do not proceed on the wrong model because it seems easier.

Escalate **up** when:
- the task changes a schema, a migration, or the storage boundary
- the task touches any formula in `docs/ENGINES.md`
- the task spans more than four files
- Sonnet has failed the same test twice
- the task is a security, privacy or data-loss question

Escalate **down** when:
- the task is a rename, a search, a formatting pass, or a docs typo
- you are on Opus and about to write a plain form component

The test for Fable specifically: **"Is this a macro-level, high-stakes system
evaluation, or an entire foundational stage?"** If no, do not use it.

## Mechanics for Alex

```jsonc
// ~/.claude/settings.json
{
  "model": "sonnet",
  "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "haiku" }
}
```

- `/model` opens the picker. **Enter** saves it as your new default;
  **`s`** switches for this session only, which is what you want for a one-off
  escalation.
- `/model opus`, `/model sonnet`, `/model haiku` switch directly.
- `/model claude-fable-5` selects Fable by model ID. If the alias resolves to
  something else on your gateway, use the full ID.
- `claude --model opus` sets it at launch.
- `/effort low|medium|high|xhigh` tunes reasoning depth. Use `high` for schema
  and engine work, default for everything else.
- `/status` confirms what is currently active.

Precedence, highest first: `/model` in session, `--model` flag,
`ANTHROPIC_MODEL` env var, the `model` field in settings.

## Session hygiene

- Opus and Fable stages burn limits fastest. Start a session with them, do not
  save them for the tail end when you are already close to a cap.
- One stage per session where possible. Context resets are cheaper than
  compaction mid-stage.
- Set subagents to Haiku once and leave it. Most subagent work is file search.
