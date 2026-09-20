import type { ReactNode } from 'react'

// The id of the hint, warnings and issues under a field, for the control's aria-describedby.
// It always exists, so a control can point at it before anything is written there.
export function fieldDescriptionId(htmlFor: string): string {
  return `${htmlFor}-description`
}

export interface FieldProps {
  label: string
  // The id of the control the label names.
  htmlFor: string
  hint?: string
  // Worth seeing, and the value is still accepted.
  warnings?: readonly string[]
  // The value is refused until these are fixed.
  issues?: readonly string[]
  required?: boolean
  // 'row' puts the label on the left. 'cell' is for a table cell, where the column header already
  // says it visually, so the label is for screen readers only.
  layout?: 'row' | 'cell'
  children: ReactNode
}

// One dense row: the label on the left, the control with anything said about it on the right.
export function Field({ label, htmlFor, hint, warnings = [], issues = [], required = false, layout = 'row', children }: FieldProps) {
  const labelText = (
    <>
      {label}
      {required ? <span aria-hidden="true"> *</span> : null}
    </>
  )
  const description = (
    <div id={fieldDescriptionId(htmlFor)} className="text-xs">
      {hint === undefined ? null : <p className="pt-0.5 text-muted">{hint}</p>}
      {warnings.map((warning) => (
        <p key={warning} className="pt-0.5 text-warn">
          {warning}
        </p>
      ))}
      {issues.length === 0 ? null : (
        <ul role="alert" className="pt-0.5 text-danger">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  )

  if (layout === 'cell') {
    return (
      // Relative, so the visually hidden label is positioned inside the cell: otherwise it escapes a
      // horizontally scrolling table and widens the whole page.
      <div className="relative min-w-0">
        <label htmlFor={htmlFor} className="sr-only">
          {labelText}
        </label>
        {children}
        {description}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <label htmlFor={htmlFor} className="pt-1 text-sm text-muted">
        {labelText}
      </label>
      <div className="min-w-0">
        {children}
        {description}
      </div>
    </div>
  )
}
