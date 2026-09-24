import { useId } from 'react'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import type { Pattern } from '../../../schema/library'
import { EffortInputsSchema } from '../../../schema/opportunity'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { hrefFor } from '../../shell/router'
import { CheckboxGroup, ChoiceField, CONTROL, FlagField, FormList, FormSection, NumberField, RowActions, StringListEditor, TextAreaField, TextField } from '../form-controls'
import { FigureInput } from './figure-input'

const DATA_READINESS = EffortInputsSchema.shape.dataReadiness.options
const VOLUME_TIERS = EffortInputsSchema.shape.volumeTier.options
const NOVELTIES = EffortInputsSchema.shape.novelty.options

export type PatternChoice = Pick<Pattern, 'id' | 'name'>

// A pattern is shown by its name, or by its id where the Library no longer has it, so a stale link is
// visible rather than dropped.
function patternLabel(patterns: readonly PatternChoice[], id: string): string {
  return patterns.find((pattern) => pattern.id === id)?.name ?? `missing: ${id}`
}

// The primary pattern is one of the linked ones, since estimation calibrates by it alone. Its issues
// show here, at the control that fixes them.
function PrimaryPatternField({ form, path, linked, patterns }: { form: EngagementFormView; path: string; linked: readonly string[]; patterns: readonly PatternChoice[] }) {
  const id = useId()
  const issues = form.issuesAt(path)
  const value = form.textAt(path)
  return (
    <Field label="Primary pattern" htmlFor={id} issues={issues} hint="Estimation calibrates the hours by this one pattern alone, so it is one of the linked ones.">
      <select
        id={id}
        data-config-path={path}
        value={value}
        onChange={(event) => form.setChoice(path, event.target.value)}
        aria-invalid={issues.length > 0}
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} num max-w-full ${issues.length > 0 ? 'border-danger' : ''}`}
      >
        <option value="">none</option>
        {/* A stored primary that is not linked is shown as it is, and its issue says why it cannot be saved. */}
        {value === '' || linked.includes(value) ? null : <option value={value}>{patternLabel(patterns, value)}</option>}
        {linked.map((patternId) => (
          <option key={patternId} value={patternId}>
            {patternLabel(patterns, patternId)}
          </option>
        ))}
      </select>
    </Field>
  )
}

export interface OpportunityEditorProps {
  form: EngagementFormView
  // The opportunity as addressed.
  opportunityId: string
  // Null when the stored Library is unusable, so no pattern can be listed.
  patterns: readonly PatternChoice[] | null
}

// One opportunity, every field of it. It is edited in the engagement's one draft, so what is typed here
// is stored by the save bar above, like every other tab. Its score and working are on the tab's ranking.
export function OpportunityEditor({ form, opportunityId, patterns }: OpportunityEditorProps) {
  const index = form.draft.opportunities.findIndex((opportunity) => opportunity.id === opportunityId)
  const opportunity = form.draft.opportunities[index]
  const back = hrefFor({ name: 'engagement', id: form.saved.id, tab: 'opportunities' })

  if (opportunity === undefined) {
    return (
      <p className="px-4 py-3 text-sm">
        This engagement has no opportunity <span className="num">{opportunityId}</span>.{' '}
        <a href={back} className="text-fg underline">
          Back to its opportunities
        </a>
        .
      </p>
    )
  }

  const at = (field: string) => `opportunities.${index}.${field}`
  const currency = form.draft.company.currency
  const known = patterns ?? []
  const processes = form.draft.processes
  const { effortInputs } = opportunity
  const compliance = `opportunities.${index}.effortInputs.complianceFlags` as const

  const processOptions = [
    ...processes.map((process) => ({ value: process.id, label: process.name === '' ? process.id : process.name, checked: opportunity.processIds.includes(process.id) })),
    ...opportunity.processIds.filter((id) => !processes.some((process) => process.id === id)).map((id) => ({ value: id, label: `missing: ${id}`, checked: true })),
  ]
  const patternOptions = [
    ...known.map((pattern) => ({ value: pattern.id, label: pattern.name, checked: opportunity.patternIds.includes(pattern.id) })),
    ...opportunity.patternIds.filter((id) => !known.some((pattern) => pattern.id === id)).map((id) => ({ value: id, label: `missing: ${id}`, checked: true })),
  ]
  const integrations = effortInputs.integrations.map((integration, integrationIndex) => ({ integration, integrationIndex }))
  const integrationName = (name: string, integrationIndex: number) => (name === '' ? `integration ${integrationIndex + 1}` : `'${name}'`)

  const share = (field: 'automatablePercent' | 'errorReductionPercent', label: string, hint: string) => {
    const path = at(field)
    return (
      <FigureInput
        field={field}
        label={label}
        hint={hint}
        path={path}
        value={form.tracedAt(path)}
        currency={currency}
        required
        onChange={(next) => form.setTraced(path, next)}
        onPendingChange={(pending) => form.setPending(path, pending)}
      />
    )
  }

  return (
    <section aria-label={`Opportunity ${opportunity.title === '' ? 'without a title' : opportunity.title}`}>
      <header className="flex h-8 flex-wrap items-center gap-3 border-b px-4">
        <a href={back} className="text-sm text-muted underline hover:text-fg">
          ← Opportunities
        </a>
        <h2 className="text-sm font-medium">{opportunity.title === '' ? 'Opportunity without a title' : opportunity.title}</h2>
      </header>

      <FormSection id="opportunity-identity" title="Opportunity">
        <TextField form={form} path={at('title')} label="Title" hint="What it would be called on a proposal, such as 'Automatic quote intake'." />
        <TextAreaField form={form} path={at('summary')} label="Summary" rows={4} hint="Client-facing, one paragraph." />
      </FormSection>

      <FormSection id="opportunity-scope" title="What it is about">
        <CheckboxGroup
          form={form}
          path={at('processIds')}
          label="Processes"
          hint={
            processes.length === 0
              ? 'This engagement has no processes yet. Map one on the Processes tab first.'
              : 'The processes this automates. Its value is the sum of theirs, so each is linked once.'
          }
          options={processOptions}
          onToggle={(processId, on) => form.toggleProcessLink(index, processId, on)}
        />
        <CheckboxGroup
          form={form}
          path={at('patternIds')}
          label="Patterns"
          hint={
            patterns === null
              ? 'The stored Library is unusable, so patterns cannot be listed. The store notice above lists why.'
              : known.length === 0
                ? 'The Library has no patterns yet. Add the standard ones, or create one, from the Patterns screen.'
                : 'Candidate patterns for this build. Their base hours feed scoring and the estimate.'
          }
          options={patternOptions}
          onToggle={(patternId, on) => form.togglePatternLink(index, patternId, on)}
        />
        <PrimaryPatternField form={form} path={at('primaryPatternId')} linked={opportunity.patternIds} patterns={known} />
      </FormSection>

      <FormSection id="opportunity-value" title="Value">
        {share('automatablePercent', 'Automatable share', 'How much of the work in those processes can be automated.')}
        {share('errorReductionPercent', 'Error reduction', 'How much of the error rate it removes. Counts only where a process has both error figures.')}
      </FormSection>

      <FormSection id="opportunity-effort" title="Effort">
        <ChoiceField form={form} path={at('effortInputs.dataReadiness')} label="Data readiness" options={DATA_READINESS} hint="How ready the data the build reads is." />
        <NumberField form={form} path={at('effortInputs.approvalSteps')} label="Approval steps" unit="steps" hint="A whole number. Each adds effort." />
        <ChoiceField form={form} path={at('effortInputs.volumeTier')} label="Volume tier" options={VOLUME_TIERS} />
        <ChoiceField form={form} path={at('effortInputs.novelty')} label="Novelty" options={NOVELTIES} hint="How new this build is to us." />
        <FlagField form={form} path={at('effortInputs.requiresHumanInLoop')} label="Human in the loop" hint="A person must check the result before it acts." />

        <FormList
          form={form}
          path={at('effortInputs.integrations')}
          title="Integrations"
          hint="Each adds effort, and more where there is no public API or no way to authenticate."
          addLabel="Add integration"
          onAdd={() => form.addIntegration(index)}
        >
          <div className="overflow-x-auto">
            <Table
              caption="Integrations"
              columns={[
                {
                  id: 'name',
                  header: 'System',
                  cell: ({ integration, integrationIndex }) => (
                    <TextField form={form} path={at(`effortInputs.integrations.${integrationIndex}.name`)} label={`Name of ${integrationName(integration.name, integrationIndex)}`} layout="cell" width="w-44" />
                  ),
                },
                {
                  id: 'api',
                  header: 'Public API',
                  cell: ({ integration, integrationIndex }) => (
                    <FlagField form={form} path={at(`effortInputs.integrations.${integrationIndex}.hasPublicApi`)} label={`${integrationName(integration.name, integrationIndex)} has a public API`} layout="cell" />
                  ),
                },
                {
                  id: 'auth',
                  header: 'Auth available',
                  cell: ({ integration, integrationIndex }) => (
                    <FlagField form={form} path={at(`effortInputs.integrations.${integrationIndex}.authAvailable`)} label={`${integrationName(integration.name, integrationIndex)} can be authenticated`} layout="cell" />
                  ),
                },
                {
                  id: 'notes',
                  header: 'Notes',
                  cell: ({ integration, integrationIndex }) => (
                    <TextField form={form} path={at(`effortInputs.integrations.${integrationIndex}.notes`)} label={`Notes on ${integrationName(integration.name, integrationIndex)}`} layout="cell" width="w-56" />
                  ),
                },
                {
                  id: 'actions',
                  header: '',
                  cell: ({ integration, integrationIndex }) => (
                    <RowActions
                      name={integrationName(integration.name, integrationIndex)}
                      index={integrationIndex}
                      count={integrations.length}
                      onRemove={() => form.removeIntegration(index, integrationIndex)}
                    />
                  ),
                },
              ]}
              rows={integrations}
              rowKey={({ integrationIndex }) => String(integrationIndex)}
              empty="No integrations yet"
            />
          </div>
        </FormList>

        <StringListEditor form={form} path={compliance} title="Compliance flags" itemLabel="Flag" hint="Each adds effort, so each is listed once." addLabel="Add flag" />
      </FormSection>
    </section>
  )
}
