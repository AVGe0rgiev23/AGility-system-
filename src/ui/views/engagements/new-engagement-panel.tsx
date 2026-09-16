import { useId, useState } from 'react'
import { issuesByPath, type FormIssue } from '../../../hooks/form-paths'
import { buildNewEngagement, initialNewEngagement, type NewEngagementDraft } from '../../../hooks/use-engagement-list'
import type { CreateResult } from '../../../hooks/use-store'
import { LeadSourceSchema, StageSchema } from '../../../schema/engagement'
import { CurrencySchema } from '../../../schema/traced'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { BUTTON, CONTROL, PRIMARY } from '../form-controls'

export interface NewEngagementFormProps {
  draft: NewEngagementDraft
  // Null when the stored Config is unusable, so industry is typed rather than picked.
  industries: readonly string[] | null
  // Shown once creating has been tried, so an empty form does not open full of complaints.
  issues: readonly FormIssue[]
  message: string | null
  creating: boolean
  onDraft: (draft: NewEngagementDraft) => void
  onCreate: () => void
  onCancel: () => void
}

function Choice({ label, path, value, options, placeholder, issues, onChange }: { label: string; path: string; value: string; options: readonly string[]; placeholder?: string; issues: readonly string[]; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} issues={issues} required>
      <select
        id={id}
        data-config-path={path}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={issues.length > 0}
        aria-required="true"
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} num ${value === '' ? 'text-muted' : ''} ${issues.length > 0 ? 'border-danger' : ''}`}
      >
        {placeholder === undefined ? null : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.includes(value) || value === '' ? null : <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}

function Text({ label, path, value, issues, onChange }: { label: string; path: string; value: string; issues: readonly string[]; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} issues={issues} required>
      <input
        id={id}
        type="text"
        autoComplete="off"
        data-config-path={path}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={issues.length > 0}
        aria-required="true"
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} w-72 max-w-full ${issues.length > 0 ? 'border-danger' : ''}`}
      />
    </Field>
  )
}

export function NewEngagementForm({ draft, industries, issues, message, creating, onDraft, onCreate, onCancel }: NewEngagementFormProps) {
  const byPath = issuesByPath(issues)
  const at = (path: string) => byPath.get(path) ?? []
  const parse = <T extends string>(options: readonly T[], value: string): T | undefined => options.find((option) => option === value)

  return (
    <section aria-labelledby="new-engagement-heading" className="border-b px-4 py-3">
      <h2 id="new-engagement-heading" className="pb-1 text-sm font-medium">
        New engagement
      </h2>
      <Text label="Company name" path="company.name" value={draft.name} issues={at('company.name')} onChange={(name) => onDraft({ ...draft, name })} />
      {industries === null ? (
        <Text label="Industry" path="company.industry" value={draft.industry} issues={at('company.industry')} onChange={(industry) => onDraft({ ...draft, industry })} />
      ) : (
        <Choice
          label="Industry"
          path="company.industry"
          value={draft.industry}
          options={industries}
          placeholder="choose an industry"
          issues={at('company.industry')}
          onChange={(industry) => onDraft({ ...draft, industry })}
        />
      )}
      <Choice
        label="Currency"
        path="company.currency"
        value={draft.currency}
        options={CurrencySchema.options}
        issues={at('company.currency')}
        onChange={(value) => onDraft({ ...draft, currency: parse(CurrencySchema.options, value) ?? draft.currency })}
      />
      <Choice
        label="Source"
        path="source"
        value={draft.source ?? ''}
        options={LeadSourceSchema.options}
        placeholder="where it came from"
        issues={at('source')}
        onChange={(value) => onDraft({ ...draft, source: parse(LeadSourceSchema.options, value) ?? draft.source })}
      />
      <Choice
        label="Stage"
        path="stage"
        value={draft.stage}
        options={StageSchema.options}
        issues={at('stage')}
        onChange={(value) => onDraft({ ...draft, stage: parse(StageSchema.options, value) ?? draft.stage })}
      />
      {message === null ? null : (
        <p role="alert" className="py-1 text-sm text-danger">
          {message}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} disabled={creating} onClick={onCreate}>
          {creating ? 'Creating…' : 'Create engagement'}
        </button>
        <button type="button" className={BUTTON} disabled={creating} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export interface NewEngagementPanelProps {
  industries: readonly string[] | null
  createEngagement: (draft: NewEngagementDraft) => Promise<CreateResult>
  onCreated: (id: string) => void
  onCancel: () => void
}

export function NewEngagementPanel({ industries, createEngagement, onCreated, onCancel }: NewEngagementPanelProps) {
  const [draft, setDraft] = useState(initialNewEngagement)
  const [attempted, setAttempted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // The id and time are stand-ins: only the field issues are wanted here.
  const built = buildNewEngagement(draft, 'preview', '')
  const issues = attempted && !built.ok ? built.issues : []

  const create = async () => {
    setAttempted(true)
    setMessage(null)
    if (!built.ok) return
    setCreating(true)
    const result = await createEngagement(draft)
    setCreating(false)
    if (result.ok) onCreated(result.id)
    else setMessage(result.message)
  }

  return (
    <NewEngagementForm
      draft={draft}
      industries={industries}
      issues={issues}
      message={message}
      creating={creating}
      onDraft={setDraft}
      onCreate={() => void create()}
      onCancel={onCancel}
    />
  )
}
