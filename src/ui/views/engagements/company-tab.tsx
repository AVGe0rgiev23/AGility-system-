import { useId } from 'react'
import { NOT_EDITED, type EngagementFormView } from '../../../hooks/use-engagement-form'
import { DeliveryModelSchema } from '../../../schema/company'
import { CurrencySchema } from '../../../schema/traced'
import { fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { TracedInput } from '../../primitives/traced-input'
import { ChoiceField, FormList, FormSection, NumberField, RowActions, TextField } from '../form-controls'

type StringList = 'company.statedTools' | 'company.constraints.compliance'

function StringListEditor({ form, path, title, itemLabel, hint, addLabel }: { form: EngagementFormView; path: StringList; title: string; itemLabel: string; hint: string; addLabel: string }) {
  const list = form.valueAt(path)
  const rows = (Array.isArray(list) ? (list as unknown[]) : []).map((item, index) => ({ item: typeof item === 'string' ? item : '', index }))
  return (
    <FormList form={form} path={path} title={title} hint={hint} addLabel={addLabel} onAdd={() => form.addToList(path)}>
      <Table
        caption={title}
        columns={[
          { id: 'item', header: itemLabel, cell: ({ index }) => <TextField form={form} path={`${path}.${index}`} label={`${itemLabel} ${index + 1}`} layout="cell" width="w-56" /> },
          {
            id: 'actions',
            header: '',
            cell: ({ item, index }) => (
              <RowActions name={item === '' ? `${itemLabel.toLowerCase()} ${index + 1}` : `'${item}'`} index={index} count={rows.length} onRemove={() => form.removeFromList(path, index)} />
            ),
          },
        ]}
        rows={rows}
        rowKey={({ index }) => String(index)}
        empty={`No ${title.toLowerCase()}`}
      />
    </FormList>
  )
}

// Shown, not edited here: signal extraction fills it and confirms each tool.
function DetectedStack({ form }: { form: EngagementFormView }) {
  const id = useId()
  const path = 'company.detectedStack'
  const issues = form.issuesAt(path)
  const reason = NOT_EDITED.find((entry) => entry.prefix === path)?.reason
  const rows = form.draft.company.detectedStack.map((tool, index) => ({ tool, index }))
  return (
    <div role="group" aria-labelledby={`${id}-title`} aria-describedby={fieldDescriptionId(id)} data-config-path={path} className="py-2">
      <h3 id={`${id}-title`} className="h-7 text-sm leading-7 text-muted">
        Detected stack
      </h3>
      <Table
        caption="Detected stack"
        columns={[
          { id: 'name', header: 'Tool', cell: ({ tool }) => tool.name },
          { id: 'category', header: 'Category', cell: ({ tool }) => <span className="num">{tool.category}</span> },
          { id: 'confidence', header: 'Confidence', cell: ({ tool }) => <span className={`num ${tool.confidence === 'low' ? 'text-warn' : ''}`}>{tool.confidence}</span> },
          { id: 'confirmed', header: 'Confirmed', cell: ({ tool }) => <span className={`num ${tool.confirmed ? '' : 'text-warn'}`}>{tool.confirmed ? 'yes' : 'no'}</span> },
          { id: 'evidence', header: 'Evidence', cell: ({ tool }) => <span className="num text-muted">{tool.evidence}</span> },
        ]}
        rows={rows}
        rowKey={({ index }) => String(index)}
        empty="Nothing detected yet"
      />
      <div id={fieldDescriptionId(id)} className="text-xs">
        {reason === undefined ? null : <p className="pt-0.5 text-muted">{reason}</p>}
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

export function CompanyTab({ form, industries }: { form: EngagementFormView; industries: readonly string[] | null }) {
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
