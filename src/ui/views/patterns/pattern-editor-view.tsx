import { useState } from 'react'
import { patternUsage, withPattern } from '../../../hooks/pattern-library'
import { usePatternForm, type PatternFormView } from '../../../hooks/use-pattern-form'
import type { ActionResult, BootedStore } from '../../../hooks/use-store'
import type { Engagement } from '../../../schema/engagement'
import { PatternSchema, type Library, type Pattern } from '../../../schema/library'
import { hrefFor } from '../../shell/router'
import { ChoiceField, FormSection, NumberField, OtherProblems, SaveBar, StringListEditor, TextAreaField, TextField } from '../form-controls'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

const COMPLEXITIES = PatternSchema.shape.complexity.options

export interface PatternEditorScreenProps {
  form: PatternFormView
  used: number
  saving: boolean
  saveError: string | null
  onSave: () => void
}

export function PatternEditorScreen({ form, used, saving, saveError, onSave }: PatternEditorScreenProps) {
  const saved = form.state.saved

  return (
    <section aria-labelledby="page-heading">
      <SaveBar
        title={
          <>
            {saved.name} <span className="num text-xs text-muted">{saved.complexity}</span>
          </>
        }
        changed={form.changed}
        problems={form.issues.length}
        canSave={form.canSave}
        saving={saving}
        onSave={onSave}
        onDiscard={form.discard}
      />
      {saveError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          The pattern was not saved: {saveError}
        </p>
      )}
      <OtherProblems problems={form.otherProblems} />

      <div key={form.state.generation}>
        <FormSection id="pattern-identity" title="Pattern">
          <TextField form={form} path="name" label="Name" hint="Such as 'Invoice extraction to accounting sync'." />
          <TextField form={form} path="category" label="Category" width="w-56" hint="A short grouping, such as finance or sales." />
          <ChoiceField form={form} path="complexity" label="Complexity" options={COMPLEXITIES} />
          <NumberField form={form} path="baseHours" label="Base hours" unit="hours" hint="Uncalibrated. Calibration is applied in estimation only." />
          <p className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1 text-sm text-muted">
            <span className="pt-1">Used by</span>
            <span className="pt-1">
              <span className="num">{used}</span> {used === 1 ? 'opportunity' : 'opportunities'}
            </span>
          </p>
        </FormSection>

        <FormSection id="pattern-client" title="Client-facing">
          <TextAreaField form={form} path="problem" label="Problem" hint="What the client sees today, in their words." />
          <TextAreaField form={form} path="solution" label="Solution" hint="What replaces it." />
          <TextAreaField form={form} path="clientExplanation" label="Client explanation" hint="Drops straight into proposals." />
        </FormSection>

        <FormSection id="pattern-technical" title="Technical">
          <TextAreaField form={form} path="architecture" label="Architecture" hint="Technical. The trigger, the steps, the write-back." />
          <StringListEditor form={form} path="requiredIntegrations" title="Required integrations" itemLabel="Integration" hint="Systems this pattern needs to reach." addLabel="Add integration" />
          <StringListEditor form={form} path="risks" title="Risks" itemLabel="Risk" hint="What can go wrong, in short." addLabel="Add risk" />
          <TextAreaField form={form} path="codeNotes" label="Code notes" hint="For whoever builds it next time." />
        </FormSection>
      </div>
    </section>
  )
}

function PatternEditor({ library, pattern, engagements, saveLibrary }: { library: Library; pattern: Pattern; engagements: readonly Engagement[]; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const form = usePatternForm(pattern)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = async () => {
    if (!form.canSave) return
    setSaving(true)
    setSaveError(null)
    const result = await saveLibrary(withPattern(library, form.draft))
    setSaving(false)
    if (!result.ok) setSaveError(result.message)
  }

  return <PatternEditorScreen form={form} used={patternUsage(engagements, pattern.id)} saving={saving} saveError={saveError} onSave={() => void save()} />
}

export function PatternMissing({ title, detail }: { title: string; detail: string }) {
  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          {title}
        </h1>
      </header>
      <p className="px-4 py-3 text-sm">
        {detail}{' '}
        <a href={hrefFor({ name: 'patterns' })} className="text-fg underline">
          Back to the patterns
        </a>
        .
      </p>
    </section>
  )
}

export function PatternEditorView({ loaded, id, saveLibrary }: { loaded: LoadedStore; id: string; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const { library, engagements } = loaded.load.store
  if (library === null) {
    return <PatternMissing title="The Library is unusable" detail="The stored Library does not validate, so no pattern can be edited. The store notice above lists why." />
  }
  const pattern = library.patterns.find((candidate) => candidate.id === id)
  if (pattern === undefined) return <PatternMissing title="Pattern not found" detail={`There is no pattern '${id}'.`} />
  // Keyed by id, so opening another pattern starts its own form.
  return <PatternEditor key={id} library={library} pattern={pattern} engagements={engagements} saveLibrary={saveLibrary} />
}
