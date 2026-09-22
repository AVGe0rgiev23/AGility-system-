import { processUsage, type FigureField } from '../../../hooks/process-rules'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import { ProcessSchema } from '../../../schema/process'
import { Table } from '../../primitives/table'
import { hrefFor } from '../../shell/router'
import { ChoiceField, FlagField, FormList, FormSection, NumberField, RowActions, StringListEditor, TextAreaField, TextField } from '../form-controls'
import { FigureInput } from './figure-input'

const REVENUE_IMPACTS = ProcessSchema.shape.revenueImpact.options

export interface ProcessEditorProps {
  form: EngagementFormView
  // The process as addressed.
  processId: string
}

// One process, every field of it. It is edited in the engagement's one draft, so what is typed here is
// stored by the save bar above, like every other tab.
export function ProcessEditor({ form, processId }: ProcessEditorProps) {
  const index = form.draft.processes.findIndex((process) => process.id === processId)
  const process = form.draft.processes[index]
  const back = hrefFor({ name: 'engagement', id: form.saved.id, tab: 'processes' })

  if (process === undefined) {
    return (
      <p className="px-4 py-3 text-sm">
        This engagement has no process <span className="num">{processId}</span>.{' '}
        <a href={back} className="text-fg underline">
          Back to its processes
        </a>
        .
      </p>
    )
  }

  const at = (field: string) => `processes.${index}.${field}`
  const currency = form.draft.company.currency
  const used = processUsage(process.id, form.draft.opportunities).length
  const systems = `processes.${index}.systemsTouched` as const
  const painPoints = `processes.${index}.painPoints` as const

  // A figure carries its own path, so its issues are found where it is fixed, and its pending text
  // blocks Save like any other traced field.
  const figure = (field: FigureField, label: string, path: string, hint?: string) => {
    const shared = { field, label, hint, path, value: form.tracedAt(path), currency, onPendingChange: (pending: boolean) => form.setPending(path, pending) }
    return field === 'occurrencesPerMonth' || field === 'minutesPerOccurrence' || field === 'peopleInvolved' ? (
      <FigureInput {...shared} required onChange={(next) => form.setTraced(path, next)} />
    ) : (
      <FigureInput {...shared} onChange={(next) => form.setTraced(path, next)} />
    )
  }

  const steps = process.steps.map((step, stepIndex) => ({ step, stepIndex }))

  return (
    <section aria-label={`Process ${process.name === '' ? 'without a name' : process.name}`}>
      <header className="flex h-8 flex-wrap items-center gap-3 border-b px-4">
        <a href={back} className="text-sm text-muted underline hover:text-fg">
          ← Processes
        </a>
        <h2 className="text-sm font-medium">{process.name === '' ? 'Process without a name' : process.name}</h2>
        <span className="text-sm text-muted">
          {used === 0 ? 'No opportunity is about it yet' : `${String(used)} ${used === 1 ? 'opportunity is' : 'opportunities are'} about it`}
        </span>
      </header>

      <FormSection id="process-identity" title="Process">
        <TextField form={form} path={at('name')} label="Name" hint="What the client does today, such as 'Quote request to CRM entry'." />
        <TextAreaField form={form} path={at('description')} label="Description" hint="What happens, in a few sentences." />
        <TextField form={form} path={at('owner')} label="Owner" width="w-56" hint="Optional. A role, not a person." />
        <ChoiceField
          form={form}
          path={at('revenueImpact')}
          label="Revenue impact"
          options={REVENUE_IMPACTS}
          hint="Direct: it wins or loses sales. Indirect: it slows the people who do. None: back office only."
        />
        <FlagField form={form} path={at('customerFacing')} label="Customer facing" hint="A customer sees or feels the result." />
      </FormSection>

      <FormSection id="process-frequency" title="How often, how long, how many">
        {figure('occurrencesPerMonth', 'Runs per month', at('frequency.occurrencesPerMonth'))}
        {figure('minutesPerOccurrence', 'Minutes per run', at('frequency.minutesPerOccurrence'), 'Start to finish, for one run.')}
        {figure('peopleInvolved', 'People per run', at('frequency.peopleInvolved'))}
      </FormSection>

      <FormSection id="process-labour" title="Labour cost">
        {figure('roleHourlyCost', 'Role hourly cost', at('roleHourlyCost'), "Overrides the company's blended hourly cost for this process. A warehouse clerk and a finance manager do not cost the same.")}
      </FormSection>

      <FormSection id="process-errors" title="When it goes wrong">
        {figure('errorRatePercent', 'Error rate', at('errorProfile.errorRatePercent'), 'Out of every 100 runs, how many go wrong. Optional.')}
        {figure('costPerError', 'Cost per error', at('errorProfile.costPerError'), 'What one mistake costs to put right. Optional.')}
        <TextAreaField form={form} path={at('errorProfile.errorDescription')} label="What goes wrong" hint="Optional. The last time it went wrong." />
      </FormSection>

      <FormSection id="process-systems" title="Systems and pain points">
        <StringListEditor form={form} path={systems} title="Systems touched" itemLabel="System" hint="Each tool the process passes through." addLabel="Add system" />
        <StringListEditor form={form} path={painPoints} title="Pain points" itemLabel="Pain point" hint="In the client's words where possible." addLabel="Add pain point" />
      </FormSection>

      <FormSection id="process-steps" title="Steps">
        <FormList form={form} path={at('steps')} title="In order" hint="A bottleneck is a step where the work waits." addLabel="Add step" onAdd={() => form.addStep(index)}>
          <div className="overflow-x-auto">
            <Table
              caption="Steps"
              columns={[
                { id: 'number', header: '#', numeric: true, cell: ({ stepIndex }) => stepIndex + 1 },
                {
                  id: 'action',
                  header: 'Action',
                  cell: ({ step, stepIndex }) => (
                    <TextField form={form} path={at(`steps.${stepIndex}.action`)} label={`Action of ${stepName(step.action, stepIndex)}`} layout="cell" width="w-72" />
                  ),
                },
                {
                  id: 'system',
                  header: 'System',
                  cell: ({ step, stepIndex }) => (
                    <TextField form={form} path={at(`steps.${stepIndex}.system`)} label={`System of ${stepName(step.action, stepIndex)}`} layout="cell" width="w-36" />
                  ),
                },
                {
                  id: 'manual',
                  header: 'Manual',
                  cell: ({ step, stepIndex }) => <FlagField form={form} path={at(`steps.${stepIndex}.isManual`)} label={`${stepName(step.action, stepIndex)} is manual`} layout="cell" />,
                },
                {
                  id: 'bottleneck',
                  header: 'Bottleneck',
                  cell: ({ step, stepIndex }) => (
                    <FlagField form={form} path={at(`steps.${stepIndex}.isBottleneck`)} label={`${stepName(step.action, stepIndex)} is a bottleneck`} layout="cell" />
                  ),
                },
                {
                  id: 'wait',
                  header: 'Wait',
                  cell: ({ step, stepIndex }) => (
                    <NumberField form={form} path={at(`steps.${stepIndex}.waitTimeMinutes`)} label={`Wait before ${stepName(step.action, stepIndex)}`} unit="minutes" nullable layout="cell" />
                  ),
                },
                {
                  id: 'actions',
                  header: '',
                  cell: ({ step, stepIndex }) => (
                    <RowActions
                      name={stepName(step.action, stepIndex)}
                      index={stepIndex}
                      count={steps.length}
                      onMove={(offset) => form.moveStep(index, stepIndex, offset)}
                      onRemove={() => form.removeStep(index, stepIndex)}
                    />
                  ),
                },
              ]}
              rows={steps}
              rowKey={({ step }) => step.id}
              empty="No steps yet"
            />
          </div>
        </FormList>
      </FormSection>
    </section>
  )
}

function stepName(action: string, index: number): string {
  return action === '' ? `step ${index + 1}` : `'${action}'`
}
