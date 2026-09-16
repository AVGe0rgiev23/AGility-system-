import { READ_ONLY_PATHS, type ConfigFormView } from '../../../hooks/use-config-form'
import { ConfigSchema, type Config } from '../../../schema/config'
import { Table } from '../../primitives/table'
import { BandsEditor } from './bands-editor'
import { ChoiceField, FlagField, FormList, FormSection, NumberField, ReadOnlyField, RowActions, TextField } from '../form-controls'
import { RunCostDefaultsEditor } from './run-cost-defaults-editor'

// Every Config field, grouped as DATA-MODEL lists them. Config values are definitions Alex sets,
// not figures from a client, so they carry no source badge. The rules are ConfigSchema's; this only
// places their messages.

const PROVIDERS = ConfigSchema.shape.ai.shape.provider.options

function IndustriesEditor({ form, industries }: { form: ConfigFormView; industries: readonly string[] }) {
  const rows = industries.map((industry, index) => ({ industry, index }))
  return (
    <FormList form={form} path="industries" title="Industries" hint="A company's industry is picked from this list." addLabel="Add industry" onAdd={form.addIndustry}>
      <Table
        caption="Industries"
        columns={[
          { id: 'name', header: 'Industry', cell: ({ index }) => <TextField form={form} path={`industries.${index}`} label={`Industry ${index + 1}`} layout="cell" /> },
          {
            id: 'actions',
            header: '',
            cell: ({ industry, index }) => (
              <RowActions
                name={industry === '' ? `industry ${index + 1}` : `industry '${industry}'`}
                index={index}
                count={industries.length}
                onMove={(offset) => form.moveIndustry(index, offset)}
                onRemove={() => form.removeIndustry(index)}
              />
            ),
          },
        ]}
        rows={rows}
        rowKey={({ index }) => String(index)}
        empty="No industries"
      />
    </FormList>
  )
}

export function ConfigSections({ form, draft }: { form: ConfigFormView; draft: Config }) {
  return (
    <>
      <FormSection id="settings-agency" title="Agency">
        <TextField form={form} path="agency.name" label="Agency name" />
        <TextField form={form} path="agency.email" label="Email" type="email" hint="Printed on proposals. Empty, or a valid address." />
        <TextField form={form} path="agency.website" label="Website" type="url" hint="Empty, or an https:// address." />
        <TextField form={form} path="agency.vatId" label="VAT id" hint="Optional." width="w-44" />
        <IndustriesEditor form={form} industries={draft.industries} />
      </FormSection>

      <FormSection id="settings-currency" title="Currency">
        <ReadOnlyField form={form} path="agencyCurrency" label="Agency currency" reason={READ_ONLY_PATHS['agencyCurrency']} />
        <TextField form={form} path="fxRates.lastUpdated" label="Rates last updated" type="date" width="w-40" hint="Shown next to every converted figure, so a stale rate is visible." />
        <ReadOnlyField form={form} path="fxRates.rates.EUR" label="EUR per 1 EUR" reason={READ_ONLY_PATHS['fxRates.rates.EUR']} />
        <NumberField form={form} path="fxRates.rates.GBP" label="GBP per 1 EUR" unit="GBP" hint="An approximation, updated by hand when it matters." />
        <NumberField form={form} path="fxRates.rates.USD" label="USD per 1 EUR" unit="USD" />
      </FormSection>

      <FormSection id="settings-pricing" title="Pricing">
        <NumberField form={form} path="pricing.targetHourlyRate" label="Target hourly rate" unit="EUR/hour" />
        <BandsEditor form={form} bands={draft.pricing.bands} />
        <NumberField form={form} path="pricing.supportMonthly.floor" label="Support retainer floor" unit="EUR/month" />
        <NumberField form={form} path="pricing.supportMonthly.ceiling" label="Support retainer ceiling" unit="EUR/month" />
      </FormSection>

      <FormSection id="settings-estimation" title="Estimation">
        <NumberField form={form} path="estimation.overheads.discovery" label="Discovery overhead" percent hint="Each overhead is a fraction of calibrated hours, added together." />
        <NumberField form={form} path="estimation.overheads.testing" label="Testing overhead" percent />
        <NumberField form={form} path="estimation.overheads.documentation" label="Documentation overhead" percent />
        <NumberField form={form} path="estimation.overheads.deployment" label="Deployment overhead" percent />
        <NumberField form={form} path="estimation.contingency" label="Contingency" percent hint="Applied after the overheads." />
        <NumberField form={form} path="estimation.fallbackPatternHours" label="Fallback pattern hours" unit="hours" hint="Used when an opportunity has no pattern linked." />
      </FormSection>

      <FormSection id="settings-scoring" title="Scoring">
        <NumberField form={form} path="scoring.valueCeiling" label="Value ceiling" unit="EUR/year" />
        <NumberField form={form} path="scoring.effortCeiling" label="Effort ceiling" unit="hours" />
        <NumberField form={form} path="scoring.hoursPerEffortPoint" label="Hours per effort point" unit="hours" />
        <NumberField form={form} path="scoring.strategicMultipliers.direct" label="Strategic: direct" unit="×" hint="The strategic multipliers rank opportunities only; client-facing figures stay unweighted." />
        <NumberField form={form} path="scoring.strategicMultipliers.indirect" label="Strategic: indirect" unit="×" />
        <NumberField form={form} path="scoring.strategicMultipliers.none" label="Strategic: none" unit="×" />
      </FormSection>

      <FormSection id="settings-roi" title="ROI">
        <NumberField form={form} path="roi.conservativeFactor" label="Conservative factor" unit="×" />
        <NumberField form={form} path="roi.optimisticFactor" label="Optimistic factor" unit="×" />
        <NumberField form={form} path="roi.discountRate" label="Discount rate" percent />
        <NumberField form={form} path="roi.horizonYears" label="Horizon" unit="years" />
        <NumberField form={form} path="roi.paybackWarningMonths" label="Payback warning" unit="months" hint="Warns when the conservative payback takes longer than this." />
      </FormSection>

      <FormSection id="settings-run-cost" title="Run costs">
        <RunCostDefaultsEditor form={form} items={draft.runCostDefaults} />
      </FormSection>

      <FormSection id="settings-storage" title="Storage">
        <FlagField form={form} path="storage.autoSyncOnWrite" label="Mirror every write" hint="When off, the folder is written only by Sync now." />
        <ReadOnlyField form={form} path="storage.syncFolderHandleId" label="Folder handle" reason={READ_ONLY_PATHS['storage.syncFolderHandleId']} />
        <ReadOnlyField form={form} path="storage.lastSyncAt" label="Last sync" reason={READ_ONLY_PATHS['storage.lastSyncAt']} />
      </FormSection>

      <FormSection id="settings-ai" title="AI">
        <ChoiceField form={form} path="ai.provider" label="Provider" options={PROVIDERS} />
        <FlagField form={form} path="ai.enabled" label="Enabled" hint="The app is fully usable with no provider." />
      </FormSection>
    </>
  )
}
