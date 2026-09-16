import { useId } from 'react'
import type { ConfigFormView } from '../../../hooks/use-config-form'
import { DeliveryModelSchema } from '../../../schema/company'
import { RunCostLineItemSchema, type RunCostLineItem } from '../../../schema/run-cost'
import { fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { BUTTON, ChoiceField, ConfigList, FlagField, NumberField, RowActions, TextField } from './config-controls'

// One record across three tables, each row led by the item's name: the item itself, who pays for it
// under each delivery model, and the usage formula of each usage-based item. One table with every
// field would be too wide to read.

const CATEGORIES = RunCostLineItemSchema.shape.category.options
const PAYERS = RunCostLineItemSchema.shape.paidBy.valueType.options

const FORMULA_FIELDS = [
  { key: 'callsPerMonth', header: 'Calls', unit: 'calls/month' },
  { key: 'avgInputTokens', header: 'Avg input', unit: 'tokens' },
  { key: 'avgOutputTokens', header: 'Avg output', unit: 'tokens' },
  { key: 'inputPricePerMTok', header: 'Input price', unit: 'EUR/M tokens' },
  { key: 'outputPricePerMTok', header: 'Output price', unit: 'EUR/M tokens' },
] as const

interface Row {
  item: RunCostLineItem
  index: number
  name: string
}

function nameOf(item: RunCostLineItem, index: number): string {
  return item.label !== '' ? item.label : item.id !== '' ? item.id : `item ${index + 1}`
}

// The formula as a whole: its own issues (a usage-based item with none) are written under the name.
function FormulaCell({ form, row }: { form: ConfigFormView; row: Row }) {
  const id = useId()
  const issues = form.issuesAt(`runCostDefaults.${row.index}.usageFormula`)
  return (
    <div>
      <span id={id} data-config-path={`runCostDefaults.${row.index}.usageFormula`} aria-describedby={fieldDescriptionId(id)} className="text-sm">
        {row.name}
      </span>
      {row.item.usageFormula === undefined ? (
        <button type="button" className={`${BUTTON} ml-2`} onClick={() => form.setUsageBased(row.index, true)}>
          Add formula
        </button>
      ) : null}
      <div id={fieldDescriptionId(id)} className="text-xs">
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

export function RunCostDefaultsEditor({ form, items }: { form: ConfigFormView; items: readonly RunCostLineItem[] }) {
  const rows: Row[] = items.map((item, index) => ({ item, index, name: nameOf(item, index) }))
  const usageRows = rows.filter(({ item }) => item.usageBased || item.usageFormula !== undefined)
  const at = (index: number, key: string) => `runCostDefaults.${index}.${key}`

  return (
    <ConfigList
      form={form}
      path="runCostDefaults"
      title="Run-cost defaults"
      hint="Costs are in EUR. A usage-based item is priced from its formula, and its monthly cost is ignored."
      addLabel="Add item"
      onAdd={form.addRunCostItem}
    >
      <div className="overflow-x-auto">
        <Table
          caption="Run-cost default items"
          columns={[
            { id: 'id', header: 'Id', cell: ({ index, name }) => <TextField form={form} path={at(index, 'id')} label={`Id of ${name}`} layout="cell" width="w-28" /> },
            { id: 'label', header: 'Label', cell: ({ index, name }) => <TextField form={form} path={at(index, 'label')} label={`Label of ${name}`} layout="cell" width="w-44" /> },
            { id: 'category', header: 'Category', cell: ({ index, name }) => <ChoiceField form={form} path={at(index, 'category')} label={`Category of ${name}`} options={CATEGORIES} layout="cell" /> },
            {
              id: 'monthlyCost',
              header: 'Monthly cost',
              cell: ({ index, name }) => <NumberField form={form} path={at(index, 'monthlyCost')} label={`Monthly cost of ${name}`} unit="EUR/month" layout="cell" />,
            },
            {
              id: 'usageBased',
              header: 'Usage-based',
              cell: ({ index, name }) => (
                <FlagField form={form} path={at(index, 'usageBased')} label={`${name} is usage-based`} layout="cell" onChange={(on) => form.setUsageBased(index, on)} />
              ),
            },
            { id: 'notes', header: 'Notes', cell: ({ index, name }) => <TextField form={form} path={at(index, 'notes')} label={`Notes on ${name}`} layout="cell" width="w-44" /> },
            {
              id: 'actions',
              header: '',
              cell: ({ index, name }) => (
                <RowActions name={name} index={index} count={items.length} onMove={(offset) => form.moveRunCostItem(index, offset)} onRemove={() => form.removeRunCostItem(index)} />
              ),
            },
          ]}
          rows={rows}
          rowKey={({ index }) => String(index)}
          empty="No run-cost defaults"
        />
      </div>

      {rows.length === 0 ? null : (
        <div className="overflow-x-auto pt-3">
          <h4 className="pb-1 text-xs text-muted">Who pays, by delivery model</h4>
          <Table
            caption="Who pays for each run-cost item, by delivery model"
            columns={[
              { id: 'item', header: 'Item', cell: ({ name }) => <span className="text-sm">{name}</span> },
              ...DeliveryModelSchema.options.map((model) => ({
                id: model,
                header: model,
                cell: ({ index, name }: Row) => <ChoiceField form={form} path={at(index, `paidBy.${model}`)} label={`Who pays for ${name} when ${model}`} options={PAYERS} layout="cell" />,
              })),
            ]}
            rows={rows}
            rowKey={({ index }) => String(index)}
            empty="No run-cost defaults"
          />
        </div>
      )}

      {usageRows.length === 0 ? null : (
        <div className="overflow-x-auto pt-3">
          <h4 className="pb-1 text-xs text-muted">Usage formulas</h4>
          <Table
            caption="Usage formula of each usage-based run-cost item"
            columns={[
              { id: 'item', header: 'Item', cell: (row) => <FormulaCell form={form} row={row} /> },
              ...FORMULA_FIELDS.map(({ key, header, unit }) => ({
                id: key,
                header,
                cell: ({ item, index, name }: Row) =>
                  item.usageFormula === undefined ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <NumberField form={form} path={at(index, `usageFormula.${key}`)} label={`${header} for ${name}`} unit={unit} layout="cell" />
                  ),
              })),
            ]}
            rows={usageRows}
            rowKey={({ index }) => String(index)}
            empty="No usage-based items"
          />
        </div>
      )}
    </ConfigList>
  )
}
