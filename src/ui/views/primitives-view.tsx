import { useState, type ReactNode } from 'react'
import type { TracedValue } from '../../schema/traced'
import { ConfidenceBadge } from '../primitives/confidence-badge'
import { Field, fieldDescriptionId } from '../primitives/field'
import { InlineStat } from '../primitives/inline-stat'
import { Stat } from '../primitives/stat'
import { Table } from '../primitives/table'
import { TracedInput } from '../primitives/traced-input'

// A reference page for the primitives, to check them by hand and in a browser. Local state only:
// nothing here reaches the store.

interface ProcessRow {
  id: string
  name: string
  occurrences: TracedValue
  minutes: TracedValue
  cost: TracedValue | null
  annualValue: number | null
  confidence: number
}

const PROCESS_ROWS: ProcessRow[] = [
  {
    id: 'p1',
    name: 'Quote request to CRM entry',
    occurrences: { value: 120, unit: 'count/month', source: 'client-stated' },
    minutes: { value: 12, unit: 'minutes', source: 'measured', note: 'Timed on the call, three samples' },
    cost: { value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated' },
    annualValue: 1612.8,
    confidence: 82,
  },
  {
    id: 'p2',
    name: 'Invoice matching',
    occurrences: { value: 45, unit: 'count/month', source: 'estimated' },
    minutes: { value: 7.333333, unit: 'minutes', source: 'default' },
    cost: null,
    annualValue: null,
    confidence: 31,
  },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h2 className="pb-2 text-sm text-muted">{title}</h2>
      {children}
    </section>
  )
}

export function PrimitivesView() {
  const [hourlyCost, setHourlyCost] = useState<TracedValue | null>({
    value: 32.5,
    unit: 'GBP/hour',
    currency: 'GBP',
    source: 'client-stated',
    note: '"about thirty quid an hour, all in"',
  })
  const [minutes, setMinutes] = useState<TracedValue>({ value: 12, unit: 'minutes', source: 'measured' })
  const [errorRate, setErrorRate] = useState<TracedValue | null>(null)
  const [mismatched, setMismatched] = useState<TracedValue>({ value: 2, unit: 'hours', source: 'estimated' })
  const [companyName, setCompanyName] = useState('')

  const emitted = [
    { id: 'hourly', field: 'Blended hourly cost', value: hourlyCost },
    { id: 'minutes', field: 'Minutes per occurrence', value: minutes },
    { id: 'error-rate', field: 'Error rate', value: errorRate },
    { id: 'mismatched', field: 'Minutes stored as hours', value: mismatched },
  ]

  return (
    <div>
      <header className="flex h-10 items-center gap-3 border-b px-4">
        <h1 className="text-base font-medium">Primitives</h1>
        <span className="text-sm text-muted">Reference only. Local state; nothing here is stored.</span>
      </header>

      <Section title="ConfidenceBadge">
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge source="client-stated" />
          <ConfidenceBadge source="client-stated" note="Marta: about 4 hours, most weeks" />
          <ConfidenceBadge source="measured" />
          <ConfidenceBadge source="estimated" />
          <ConfidenceBadge source="default" />
          <ConfidenceBadge confidence={82} />
          <ConfidenceBadge confidence={49} />
        </div>
      </Section>

      <Section title="Stat">
        <div className="flex flex-wrap gap-y-2">
          <Stat label="Blended hourly cost" traced={hourlyCost} />
          <Stat label="Annual value" value={18250.4} unit="EUR/year" currency="EUR" confidence={64} />
          <Stat label="Effective hourly rate" value={null} unit="EUR/hour" currency="EUR" confidence={64} />
          <Stat label="Error rate" traced={errorRate} />
        </div>
      </Section>

      <Section title="Table with InlineStat cells">
        <Table
          caption="Sample processes"
          columns={[
            { id: 'name', header: 'Process', cell: (row) => row.name },
            { id: 'occurrences', header: 'Occurrences', numeric: true, cell: (row) => <InlineStat traced={row.occurrences} /> },
            { id: 'minutes', header: 'Minutes each', numeric: true, cell: (row) => <InlineStat traced={row.minutes} /> },
            { id: 'cost', header: 'Hourly cost', numeric: true, cell: (row) => <InlineStat traced={row.cost} /> },
            {
              id: 'value',
              header: 'Annual value',
              numeric: true,
              cell: (row) => <InlineStat value={row.annualValue} unit="EUR/year" currency="EUR" confidence={row.confidence} />,
            },
          ]}
          rows={PROCESS_ROWS}
          rowKey={(row) => row.id}
          empty="No processes"
        />
        <div className="pt-3">
          <Table caption="An empty table" columns={[{ id: 'name', header: 'Engagement', cell: () => null }]} rows={[]} rowKey={() => ''} empty="No engagements yet" />
        </div>
      </Section>

      <Section title="Field">
        <Field
          label="Company name"
          htmlFor="primitives-company-name"
          hint="As it appears on the client's invoices"
          required
          issues={companyName.trim() === '' ? ['A company name is required'] : []}
        >
          <input
            id="primitives-company-name"
            type="text"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            aria-describedby={fieldDescriptionId('primitives-company-name')}
            className="h-6 w-72 rounded-sm border bg-bg px-1.5 text-sm text-fg"
          />
        </Field>
      </Section>

      <Section title="TracedInput">
        <TracedInput label="Blended hourly cost" value={hourlyCost} currency="EUR" per="hour" hint="Optional; a new value starts in EUR" onChange={setHourlyCost} />
        <TracedInput label="Minutes per occurrence" value={minutes} unit="minutes" required onChange={setMinutes} />
        <TracedInput label="Error rate" value={errorRate} unit="percent" onChange={setErrorRate} />
        <TracedInput label="Minutes stored as hours" value={mismatched} unit="minutes" required onChange={setMismatched} />
      </Section>

      <Section title="Latest emitted values">
        <Table
          caption="The value each TracedInput last emitted"
          columns={[
            { id: 'field', header: 'Field', cell: (row) => row.field },
            { id: 'figure', header: 'Figure', numeric: true, cell: (row) => <InlineStat traced={row.value} /> },
            { id: 'record', header: 'Stored record', cell: (row) => <code className="num text-xs">{JSON.stringify(row.value)}</code> },
          ]}
          rows={emitted}
          rowKey={(row) => row.id}
          empty="No inputs"
        />
      </Section>
    </div>
  )
}
