import { useId } from 'react'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import { DeliveryModelSchema } from '../../../schema/company'
import type { QuestionSet } from '../../../schema/discovery'
import { CurrencySchema } from '../../../schema/traced'
import { fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { TracedInput } from '../../primitives/traced-input'
import { ChoiceField, FlagField, FormSection, NumberField, RowActions, StringListEditor, TextField } from '../form-controls'
import type { PatternChoice } from './opportunity-editor'
import { SignalsPanel } from './signals-panel'

// What signal extraction suggested, with the evidence for each. Only whether a tool is confirmed is
// edited here: a suggestion counts once it is, and only a confirmed tool reaches a document.
function DetectedStack({ form }: { form: EngagementFormView }) {
  const id = useId()
  const path = 'company.detectedStack'
  const issues = form.issuesAt(path)
  const rows = form.draft.company.detectedStack.map((tool, index) => ({ tool, index }))
  const at = (index: number, field: string) => `${path}.${index}.${field}`

  // A read-only cell that carries its path, so a rule about it is written on its own row.
  const shown = (index: number, field: 'name' | 'category' | 'confidence' | 'evidence', text: string, className: string) => {
    const cellPath = at(index, field)
    const describedBy = `${id}-${index}-${field}`
    return (
      <>
        <output data-config-path={cellPath} aria-describedby={fieldDescriptionId(describedBy)} className={className}>
          {text}
        </output>
        <div id={fieldDescriptionId(describedBy)} className="text-xs text-danger">
          {form.issuesAt(cellPath).map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      </>
    )
  }

  return (
    <div role="group" aria-labelledby={`${id}-title`} aria-describedby={fieldDescriptionId(id)} data-config-path={path} className="py-2">
      <h3 id={`${id}-title`} className="h-7 text-sm leading-7 text-muted">
        Detected stack
      </h3>
      <div className="overflow-x-auto">
        <Table
          caption="Detected stack"
          columns={[
            { id: 'name', header: 'Tool', cell: ({ tool, index }) => shown(index, 'name', tool.name, 'num') },
            { id: 'category', header: 'Category', cell: ({ tool, index }) => shown(index, 'category', tool.category, 'num') },
            {
              id: 'confidence',
              header: 'Confidence',
              cell: ({ tool, index }) => shown(index, 'confidence', tool.confidence, `num ${tool.confidence === 'low' ? 'text-warn' : ''}`),
            },
            {
              id: 'confirmed',
              header: 'Confirmed',
              cell: ({ tool, index }) => <FlagField form={form} path={at(index, 'confirmed')} label={`${tool.name === '' ? `Tool ${index + 1}` : tool.name} is confirmed`} layout="cell" />,
            },
            { id: 'evidence', header: 'Evidence', cell: ({ tool, index }) => shown(index, 'evidence', tool.evidence, 'num text-muted') },
            {
              id: 'actions',
              header: '',
              cell: ({ tool, index }) => (
                <RowActions name={tool.name === '' ? `tool ${index + 1}` : `'${tool.name}'`} index={index} count={rows.length} onRemove={() => form.removeTool(index)} />
              ),
            },
          ]}
          rows={rows}
          rowKey={({ index }) => String(index)}
          empty="Nothing detected yet"
        />
      </div>
      <div id={fieldDescriptionId(id)} className="text-xs">
        <p className="pt-0.5 text-muted">A suggestion counts once it is confirmed, and only a confirmed tool reaches a document. Removing one takes effect on Save.</p>
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

export interface CompanyTabProps {
  form: EngagementFormView
  industries: readonly string[] | null
  // For naming what a pain signal points at; null when the stored Library is unusable.
  questionSets: readonly QuestionSet[] | null
  patterns: readonly PatternChoice[] | null
}

export function CompanyTab({ form, industries, questionSets, patterns }: CompanyTabProps) {
  const cost = 'company.blendedHourlyCost'
  return (
    <>
      <FormSection id="company-identity" title="Company">
        <TextField form={form} path="company.name" label="Name" />
        <TextField form={form} path="company.website" label="Website" type="url" hint="Optional. An http:// or https:// address." />
        {industries === null ? (
          <TextField form={form} path="company.industry" label="Industry" hint="The stored Config is unusable, so industries cannot be listed." />
        ) : (
          <ChoiceField form={form} path="company.industry" label="Industry" options={industries} hint="Industries are listed in Settings." />
        )}
        <NumberField form={form} path="company.employeeCount" label="Employees" unit="people" nullable hint="Optional. A whole number." />
        <TextField form={form} path="company.locationCountry" label="Country" width="w-40" hint="Optional, such as BG." />
        <ChoiceField form={form} path="company.currency" label="Currency" options={CurrencySchema.options} hint="New money figures for this company start in it." />
      </FormSection>

      <FormSection id="company-labour" title="Labour cost">
        <TracedInput
          label="Blended hourly cost"
          path={cost}
          value={form.tracedAt(cost)}
          currency={form.draft.company.currency}
          per="hour"
          hint="Blended cost, not salary. Every labour calculation uses it unless a process sets a role's own rate."
          onChange={(next) => form.setTraced(cost, next)}
          onPendingChange={(pending) => form.setPending(cost, pending)}
        />
      </FormSection>

      <FormSection id="company-systems" title="Systems">
        <StringListEditor form={form} path="company.statedTools" title="Stated tools" itemLabel="Tool" hint="The tools the client says they use." addLabel="Add tool" />
        <TextField form={form} path="company.sourceOfTruth" label="Source of truth" hint="Optional, such as 'HubSpot for contacts, Sheets for jobs'." />
        <DetectedStack form={form} />
        <SignalsPanel form={form} questionSets={questionSets} patterns={patterns} />
      </FormSection>

      <FormSection id="company-constraints" title="Constraints">
        <StringListEditor
          form={form}
          path="company.constraints.compliance"
          title="Compliance"
          itemLabel="Requirement"
          hint="Such as GDPR, PCI or HIPAA, or none."
          addLabel="Add requirement"
        />
        <TextField form={form} path="company.constraints.dataResidency" label="Data residency" hint="Optional, such as EU only." />
        <TextField form={form} path="company.constraints.securityNotes" label="Security notes" hint="Optional." />
      </FormSection>

      <FormSection id="company-delivery" title="Delivery">
        <ChoiceField form={form} path="company.preferredDeliveryModel" label="Preferred delivery model" options={DeliveryModelSchema.options} emptyLabel="not set" />
      </FormSection>
    </>
  )
}
