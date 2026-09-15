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
  children: ReactNode
}

// One dense row: the label on the left, the control with anything said about it on the right.
export function Field({ label, htmlFor, hint, warnings = [], issues = [], required = false, children }: FieldProps) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <label htmlFor={htmlFor} className="pt-1 text-sm text-muted">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="min-w-0">
        {children}
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
      </div>
    </div>
  )
}
