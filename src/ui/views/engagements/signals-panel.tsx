import { useId, useState } from 'react'
import { readSignals, type SignalReading } from '../../../hooks/signal-reading'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import type { QuestionSet } from '../../../schema/discovery'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { hrefFor } from '../../shell/router'
import { BUTTON, PRIMARY } from '../form-controls'
import type { PatternChoice } from './opportunity-editor'

export interface SignalsPanelScreenProps {
  engagementId: string
  text: string
  // Null until Find signals has been pressed.
  reading: SignalReading | null
  // For naming what a pain signal points at. Null when the stored Library is unusable.
  questionSets: readonly QuestionSet[] | null
  patterns: readonly PatternChoice[] | null
  onText: (text: string) => void
  onFind: () => void
  onClear: () => void
}

function summary(reading: SignalReading): string {
  const { tools, added, alreadyListed, pains } = reading
  if (tools.length === 0 && pains.length === 0) return 'Nothing recognised in that text.'
  const found = tools.length === 0 ? 'No tool recognised' : `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} recognised`
  const listed =
    tools.length === 0 ? '' : added === 0 ? ', all of them already in the stack' : `, ${added} added to the stack below unconfirmed${alreadyListed === 0 ? '' : ` and ${alreadyListed} already there`}`
  return `${found}${listed}. ${pains.length} ${pains.length === 1 ? 'pain signal' : 'pain signals'}.`
}

// The paste box and what it found. Extraction is matched on this page against a fixed table: nothing is
// fetched, nothing is sent, and the pasted text is not stored, only what it suggests.
export function SignalsPanelScreen({ engagementId, text, reading, questionSets, patterns, onText, onFind, onClear }: SignalsPanelScreenProps) {
  const id = useId()
  const setName = (setId: string) => questionSets?.find((set) => set.id === setId)?.name ?? setId
  const patternName = (patternId: string) => patterns?.find((pattern) => pattern.id === patternId)?.name

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="py-2">
      <h3 id={`${id}-title`} className="h-7 text-sm leading-7 text-muted">
        Find signals
      </h3>
      <Field
        label="Website text"
        htmlFor={id}
        hint="Paste text from the client's website. It is matched on this page against a table of known tools and pain phrases. Nothing is fetched or sent anywhere, and a tool counts only once you confirm it."
      >
        <textarea
          id={id}
          rows={5}
          spellCheck={false}
          value={text}
          onChange={(event) => onText(event.target.value)}
          aria-describedby={fieldDescriptionId(id)}
          className="w-[32rem] max-w-full rounded-sm border bg-bg px-1.5 py-1 text-sm text-fg"
        />
      </Field>
      <div className="flex gap-2 pl-[11.75rem]">
        <button type="button" className={PRIMARY} disabled={text.trim() === ''} onClick={onFind}>
          Find signals
        </button>
        <button type="button" className={BUTTON} disabled={text === '' && reading === null} onClick={onClear}>
          Clear
        </button>
      </div>

      {reading === null ? null : (
        <div className="pl-[11.75rem]">
          <p role="status" className="pt-2 text-sm">
            {summary(reading)}
          </p>
          {reading.pains.length === 0 ? null : (
            <ul className="pt-1 text-sm">
              {reading.pains.map((pain) => (
                <li key={pain.id} className="border-b py-1 last:border-b-0">
                  <span>{pain.label}</span> <span className="num text-xs text-muted">“{pain.evidence}”</span>
                  <p className="text-xs text-muted">
                    Worth running: {pain.questionSetIds.map(setName).join(', ')}, from the{' '}
                    <a href={hrefFor({ name: 'engagement', id: engagementId, tab: 'discovery' })} className="text-fg underline">
                      Discovery tab
                    </a>
                    . Candidate patterns:{' '}
                    {pain.patternIds.map((patternId, at) => (
                      <span key={patternId}>
                        {at === 0 ? '' : ', '}
                        {patternName(patternId) ?? (
                          <>
                            <span className="num">{patternId}</span> (not in the Library yet)
                          </>
                        )}
                      </span>
                    ))}
                    .
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export interface SignalsPanelProps {
  form: EngagementFormView
  questionSets: readonly QuestionSet[] | null
  patterns: readonly PatternChoice[] | null
}

// Holds the pasted text and the last reading; the tools themselves go straight into the engagement's
// draft, unconfirmed, so they survive a change of tab and are stored by the one Save.
export function SignalsPanel({ form, questionSets, patterns }: SignalsPanelProps) {
  const [text, setText] = useState('')
  const [reading, setReading] = useState<SignalReading | null>(null)

  const find = () => {
    const found = readSignals(text, form.draft.company.detectedStack)
    form.applySignals(found.tools)
    setReading(found)
  }

  return (
    <SignalsPanelScreen
      engagementId={form.saved.id}
      text={text}
      reading={reading}
      questionSets={questionSets}
      patterns={patterns}
      onText={setText}
      onFind={find}
      onClear={() => {
        setText('')
        setReading(null)
      }}
    />
  )
}
