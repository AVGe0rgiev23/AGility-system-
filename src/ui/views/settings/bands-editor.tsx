import type { ConfigFormView } from '../../../hooks/use-config-form'
import type { Config } from '../../../schema/config'
import { Table } from '../../primitives/table'
import { FormList, NumberField, RowActions, TextField } from '../form-controls'

type Band = Config['pricing']['bands'][number]

function bandName(band: Band, index: number): string {
  return band.id === '' ? `band ${index + 1}` : `band '${band.id}'`
}

export function BandsEditor({ form, bands }: { form: ConfigFormView; bands: readonly Band[] }) {
  const rows = bands.map((band, index) => ({ band, index }))
  const at = (index: number, key: keyof Band) => `pricing.bands.${index}.${key}`
  return (
    <FormList
      form={form}
      path="pricing.bands"
      title="Pricing bands"
      hint="Estimation takes the first band whose max hours fit. Empty max hours means unbounded: only the last band, id custom, with no floor or ceiling, quoted by hand."
      addLabel="Add band"
      onAdd={form.addBand}
    >
      <div className="overflow-x-auto">
        <Table
          caption="Pricing bands"
          columns={[
            { id: 'id', header: 'Id', cell: ({ band, index }) => <TextField form={form} path={at(index, 'id')} label={`Id of ${bandName(band, index)}`} layout="cell" width="w-32" /> },
            { id: 'name', header: 'Name', cell: ({ band, index }) => <TextField form={form} path={at(index, 'name')} label={`Name of ${bandName(band, index)}`} layout="cell" width="w-40" /> },
            {
              id: 'maxHours',
              header: 'Max hours',
              cell: ({ band, index }) => <NumberField form={form} path={at(index, 'maxHours')} label={`Max hours of ${bandName(band, index)}`} unit="hours" nullable layout="cell" />,
            },
            {
              id: 'floor',
              header: 'Floor',
              cell: ({ band, index }) => <NumberField form={form} path={at(index, 'floor')} label={`Floor of ${bandName(band, index)}`} unit="EUR" nullable layout="cell" />,
            },
            {
              id: 'ceiling',
              header: 'Ceiling',
              cell: ({ band, index }) => <NumberField form={form} path={at(index, 'ceiling')} label={`Ceiling of ${bandName(band, index)}`} unit="EUR" nullable layout="cell" />,
            },
            {
              id: 'actions',
              header: '',
              cell: ({ band, index }) => (
                <RowActions
                  name={bandName(band, index)}
                  index={index}
                  count={bands.length}
                  onMove={(offset) => form.moveBand(index, offset)}
                  onRemove={() => form.removeBand(index)}
                />
              ),
            },
          ]}
          rows={rows}
          rowKey={({ index }) => String(index)}
          empty="No bands. Estimation needs at least the unbounded custom band."
        />
      </div>
    </FormList>
  )
}
