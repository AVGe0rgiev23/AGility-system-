import { useId, type ReactNode } from 'react'
import { READ_ONLY_PATHS, type ConfigFormView } from '../../../hooks/use-config-form'
import { formatNumber } from '../../format'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { NumberInput } from '../../primitives/number-input'

// The controls every Settings section is built from. Each writes its Config path as data-config-path
// and points aria-describedby at the block its issues are written in, so a test can check that every
// issue lands at the control that fixes it.

export const CONTROL = 'h-6 rounded-sm border bg-bg px-1.5 text-sm text-fg'
export const BUTTON =
  'h-6 shrink-0 rounded-sm border px-2 text-sm text-fg transition-colors hover:bg-surface disabled:text-muted disabled:hover:bg-transparent'

interface ControlProps {
  form: ConfigFormView
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
  // Empty text means null: no limit, or no price.
  nullable?: boolean
}

export function NumberField({ form, path, label, hint, layout, unit, percent = false, nullable = false }: NumberFieldProps) {
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
      required={!nullable}
      layout={layout}
      onText={(text) => form.setNumberText(path, text)}
    />
  )
}

export function TextField({ form, path, label, hint, layout, type = 'text', width = 'w-72' }: ControlProps & { type?: 'text' | 'email' | 'url' | 'date'; width?: string }) {
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

export function ChoiceField({ form, path, label, hint, layout, options }: ControlProps & { options: readonly string[] }) {
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
        {/* A stored value outside the options is shown as it is, and its issue says why it cannot be saved. */}
        {options.includes(value) ? null : <option value={value}>{value}</option>}
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

// A leaf Settings shows but never edits, with the reason from READ_ONLY_PATHS beside it.
export function ReadOnlyField({ form, path, label }: { form: ConfigFormView; path: string; label: string }) {
  const id = useId()
  const value = form.valueAt(path)
  // Every read-only leaf is a string, a number or null.
  const shown = typeof value === 'string' || typeof value === 'number' ? String(value) : null
  return (
    <Field label={label} htmlFor={id} hint={READ_ONLY_PATHS[path]} issues={form.issuesAt(path)}>
      <output id={id} data-config-path={path} aria-describedby={fieldDescriptionId(id)} className={`num block pt-1 text-sm ${shown === null ? 'text-muted' : ''}`}>
        {shown ?? 'none'}
      </output>
    </Field>
  )
}

// A list edited as a table, with the issues about the list as a whole under it.
export function ConfigList({ form, path, title, hint, addLabel, onAdd, children }: { form: ConfigFormView; path: string; title: string; hint?: string; addLabel: string; onAdd: () => void; children: ReactNode }) {
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

export function RowActions({ name, index, count, onMove, onRemove }: { name: string; index: number; count: number; onMove: (offset: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="flex gap-1">
      <button type="button" className={BUTTON} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>
        ↑
      </button>
      <button type="button" className={BUTTON} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${name} down`}>
        ↓
      </button>
      <button type="button" className={BUTTON} onClick={onRemove} aria-label={`Remove ${name}`}>
        Remove
      </button>
    </span>
  )
}

export function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b px-4 py-3">
      <h2 id={id} className="pb-1 text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}
