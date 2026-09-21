import { useId, type ReactNode } from 'react'
import { formatNumber } from '../format'
import { Field, fieldDescriptionId } from '../primitives/field'
import { NumberInput } from '../primitives/number-input'

// The controls every path-addressed form is built from: Settings and the engagement detail. Each
// writes its path as data-config-path and points aria-describedby at the block its issues are written
// in, so a test can check that every issue lands at the control that fixes it.

export const CONTROL = 'h-6 rounded-sm border bg-bg px-1.5 text-sm text-fg'
export const BUTTON =
  'h-6 shrink-0 rounded-sm border px-2 text-sm text-fg transition-colors hover:bg-surface disabled:text-muted disabled:hover:bg-transparent'
// The one primary action on a screen.
export const PRIMARY = 'h-6 shrink-0 rounded-sm bg-accent px-2 text-sm text-fg transition-colors hover:bg-accent/80 disabled:bg-surface disabled:text-muted'

// What the controls read and call. The Settings form view and the engagement form view both provide it.
export interface PathForm {
  issuesAt: (path: string) => readonly string[]
  numberText: (path: string) => string
  numberReading: (path: string) => number | null
  numberWarnings: (path: string) => string[]
  setNumberText: (path: string, text: string) => void
  textAt: (path: string) => string
  setText: (path: string, text: string) => void
  setChoice: (path: string, value: string) => void
  flagAt: (path: string) => boolean
  setFlag: (path: string, on: boolean) => void
  valueAt: (path: string) => unknown
}

interface ControlProps {
  form: PathForm
  path: string
  label: string
  hint?: string
  layout?: 'row' | 'cell'
}

export interface NumberFieldProps extends ControlProps {
  unit?: string
  // A fraction stored as 0.20: the label reads 'Testing overhead (20%)' from what is typed now, so it
  // is never taken for a tenth of a percent, and shows no percent while the text does not parse.
  percent?: boolean
  // Empty text means null or no value: no limit, no price, or no monthly cost.
  nullable?: boolean
  // Marked required unless nullable; a field that is required only sometimes says when.
  required?: boolean
}

export function NumberField({ form, path, label, hint, layout, unit, percent = false, nullable = false, required = !nullable }: NumberFieldProps) {
  const reading = form.numberReading(path)
  return (
    <NumberInput
      label={percent && reading !== null ? `${label} (${formatNumber(reading * 100)}%)` : label}
      path={path}
      text={form.numberText(path)}
      unit={unit}
      hint={hint}
      warnings={form.numberWarnings(path)}
      issues={form.issuesAt(path)}
      required={required}
      layout={layout}
      onText={(text) => form.setNumberText(path, text)}
    />
  )
}

export function TextField({ form, path, label, hint, layout, type = 'text', width = 'w-72' }: ControlProps & { type?: 'text' | 'email' | 'url' | 'date' | 'tel'; width?: string }) {
  const id = useId()
  const issues = form.issuesAt(path)
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} layout={layout}>
      <input
        id={id}
        type={type}
        autoComplete="off"
        spellCheck={false}
        data-config-path={path}
        value={form.textAt(path)}
        onChange={(event) => form.setText(path, event.target.value)}
        aria-invalid={issues.length > 0}
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} ${width} max-w-full ${issues.length > 0 ? 'border-danger' : ''}`}
      />
    </Field>
  )
}

export interface ChoiceFieldProps extends ControlProps {
  options: readonly string[]
  // Shown for an empty value, which the setter stores as no value; offered only on an optional choice.
  emptyLabel?: string
}

export function ChoiceField({ form, path, label, hint, layout, options, emptyLabel }: ChoiceFieldProps) {
  const id = useId()
  const issues = form.issuesAt(path)
  const value = form.textAt(path)
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} layout={layout}>
      <select
        id={id}
        data-config-path={path}
        value={value}
        onChange={(event) => form.setChoice(path, event.target.value)}
        aria-invalid={issues.length > 0}
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} num ${issues.length > 0 ? 'border-danger' : ''}`}
      >
        {emptyLabel === undefined ? null : <option value="">{emptyLabel}</option>}
        {/* A stored value outside the options is shown as it is, and its issue says why it cannot be saved. */}
        {options.includes(value) || (value === '' && emptyLabel !== undefined) ? null : <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function FlagField({ form, path, label, hint, layout, onChange }: ControlProps & { onChange?: (on: boolean) => void }) {
  const id = useId()
  const issues = form.issuesAt(path)
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} layout={layout}>
      <input
        id={id}
        type="checkbox"
        data-config-path={path}
        checked={form.flagAt(path)}
        onChange={(event) => (onChange === undefined ? form.setFlag(path, event.target.checked) : onChange(event.target.checked))}
        aria-describedby={fieldDescriptionId(id)}
        className="mt-1.5"
      />
    </Field>
  )
}

// A group of checkboxes picked from a list, carrying the list's path so its issues show under it.
export function CheckboxGroup({
  form,
  path,
  label,
  hint,
  options,
  onToggle,
}: {
  form: PathForm
  path: string
  label: string
  hint: string
  options: readonly { value: string; label: string; checked: boolean }[]
  onToggle: (value: string, on: boolean) => void
}) {
  const id = useId()
  const issues = form.issuesAt(path)
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span id={`${id}-label`} className="pt-1 text-sm text-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={`${id}-label`} aria-describedby={fieldDescriptionId(id)} data-config-path={path} className="min-w-0">
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={option.checked} onChange={(event) => onToggle(option.value, event.target.checked)} />
              {option.label}
            </label>
          ))}
        </div>
        <div id={fieldDescriptionId(id)} className="text-xs">
          <p className="pt-0.5 text-muted">{hint}</p>
          {issues.length === 0 ? null : (
            <ul role="alert" className="pt-0.5 text-danger">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// A leaf the form shows but never edits, with the reason beside it.
export function ReadOnlyField({ form, path, label, reason }: { form: PathForm; path: string; label: string; reason: string | undefined }) {
  const id = useId()
  const value = form.valueAt(path)
  // Every read-only leaf is a string, a number or null.
  const shown = typeof value === 'string' || typeof value === 'number' ? String(value) : null
  return (
    <Field label={label} htmlFor={id} hint={reason} issues={form.issuesAt(path)}>
      <output id={id} data-config-path={path} aria-describedby={fieldDescriptionId(id)} className={`num block pt-1 text-sm ${shown === null ? 'text-muted' : ''}`}>
        {shown ?? 'none'}
      </output>
    </Field>
  )
}

// A list edited as a table, with the issues about the list as a whole under it.
export function FormList({ form, path, title, hint, addLabel, onAdd, children }: { form: PathForm; path: string; title: string; hint?: string; addLabel: string; onAdd: () => void; children: ReactNode }) {
  const id = useId()
  const issues = form.issuesAt(path)
  return (
    <div role="group" aria-labelledby={`${id}-title`} aria-describedby={fieldDescriptionId(id)} data-config-path={path} className="py-2">
      <div className="flex h-7 items-center gap-3">
        <h3 id={`${id}-title`} className="text-sm text-muted">
          {title}
        </h3>
        <button type="button" className={BUTTON} onClick={onAdd}>
          {addLabel}
        </button>
      </div>
      {children}
      <div id={fieldDescriptionId(id)} className="text-xs">
        {hint === undefined ? null : <p className="pt-0.5 text-muted">{hint}</p>}
        {issues.length === 0 ? null : (
          <ul role="alert" className="pt-0.5 text-danger">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function RowActions({ name, index, count, onMove, onRemove }: { name: string; index: number; count: number; onMove?: (offset: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="flex gap-1">
      {onMove === undefined ? null : (
        <>
          <button type="button" className={BUTTON} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>
            ↑
          </button>
          <button type="button" className={BUTTON} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${name} down`}>
            ↓
          </button>
        </>
      )}
      <button type="button" className={BUTTON} onClick={onRemove} aria-label={`Remove ${name}`}>
        Remove
      </button>
    </span>
  )
}

export function FormSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b px-4 py-3">
      <h2 id={id} className="pb-1 text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function saveStatus(changed: boolean, problems: number, saving: boolean): { text: string; tone: string } {
  if (saving) return { text: 'Saving…', tone: 'text-muted' }
  if (!changed) return { text: 'No unsaved changes', tone: 'text-muted' }
  if (problems > 0) return { text: `Unsaved changes: ${problems} ${problems === 1 ? 'problem' : 'problems'} to fix before saving`, tone: 'text-danger' }
  return { text: 'Unsaved changes', tone: 'text-warn' }
}

export interface SaveBarProps {
  title: ReactNode
  changed: boolean
  // Everything that blocks saving, counted.
  problems: number
  canSave: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

// The page header of an edited record, kept in view while scrolling, since Save is the one action every
// edit below it leads to.
export function SaveBar({ title, changed, problems, canSave, saving, onSave, onDiscard }: SaveBarProps) {
  const status = saveStatus(changed, problems, saving)
  return (
    <header className="sticky top-0 z-10 flex h-10 items-center gap-3 border-b bg-bg px-4">
      <h1 id="page-heading" className="min-w-0 truncate text-base font-medium">
        {title}
      </h1>
      <span role="status" className={`ml-auto shrink-0 text-sm ${status.tone}`}>
        {status.text}
      </span>
      <button type="button" className={BUTTON} disabled={!changed || saving} onClick={onDiscard}>
        Discard changes
      </button>
      <button type="button" className={PRIMARY} disabled={!canSave || saving} onClick={onSave}>
        Save
      </button>
    </header>
  )
}

// Issues that block saving and have no field of their own on the screen, listed so none is hidden.
export function OtherProblems({ problems }: { problems: readonly { path: string; message: string }[] }) {
  if (problems.length === 0) return null
  return (
    <section aria-labelledby="other-problems" className="border-b px-4 py-3">
      <h2 id="other-problems" className="pb-1 text-sm font-medium text-danger">
        Other problems
      </h2>
      <p className="pb-1 text-xs text-muted">These block saving and have no field of their own on this screen.</p>
      <ul role="alert" className="text-sm">
        {problems.map((problem) => (
          <li key={`${problem.path}-${problem.message}`}>
            <span className="num">{problem.path === '' ? '(root)' : problem.path}</span>: {problem.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
