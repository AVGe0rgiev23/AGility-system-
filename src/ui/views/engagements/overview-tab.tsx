import type { ReactNode } from 'react'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import { LeadSourceSchema } from '../../../schema/engagement'
import { Table } from '../../primitives/table'
import { BUTTON, ChoiceField, FormList, FormSection, RowActions, TextField } from '../form-controls'

export interface Deletion {
  confirming: boolean
  deleting: boolean
  error: string | null
  onAsk: () => void
  onConfirm: () => void
  onCancel: () => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

export function OverviewTab({ form, deletion }: { form: EngagementFormView; deletion: Deletion }) {
  const { saved, draft } = form
  const tags = draft.tags.map((tag, index) => ({ tag, index }))
  const history = saved.stageHistory.map((entry, index) => ({ entry, index }))

  return (
    <>
      <FormSection id="engagement-overview" title="Engagement">
        <dl>
          <Row label="Stage">
            <span className="num">{saved.stage}</span>
            <span className="text-xs text-muted"> — set when the engagement was created; moving it comes with the pipeline view (Stage 1, task 4).</span>
          </Row>
        </dl>
        <ChoiceField form={form} path="source" label="Source" options={LeadSourceSchema.options} />
        <dl>
          <Row label="Created">
            <span className="num">{saved.createdAt}</span>
          </Row>
          <Row label="Updated">
            <span className="num">{saved.updatedAt}</span>
          </Row>
          <Row label="Id">
            <span className="num text-muted">{saved.id}</span>
          </Row>
        </dl>
      </FormSection>

      <FormSection id="engagement-next-action" title="Next action">
        <TextField form={form} path="nextAction.text" label="Next action" hint="Clear both fields for no next action." />
        <TextField form={form} path="nextAction.due" label="Due" type="date" width="w-40" />
      </FormSection>

      <FormSection id="engagement-tags" title="Tags">
        <FormList form={form} path="tags" title="Tags" hint="The engagement list filters by tag." addLabel="Add tag" onAdd={() => form.addToList('tags')}>
          <Table
            caption="Tags"
            columns={[
              { id: 'tag', header: 'Tag', cell: ({ index }) => <TextField form={form} path={`tags.${index}`} label={`Tag ${index + 1}`} layout="cell" width="w-56" /> },
              {
                id: 'actions',
                header: '',
                cell: ({ tag, index }) => <RowActions name={tag === '' ? `tag ${index + 1}` : `tag '${tag}'`} index={index} count={tags.length} onRemove={() => form.removeFromList('tags', index)} />,
              },
            ]}
            rows={tags}
            rowKey={({ index }) => String(index)}
            empty="No tags"
          />
        </FormList>
      </FormSection>

      <FormSection id="engagement-stage-history" title="Stage history">
        <Table
          caption="Stage history"
          columns={[
            { id: 'stage', header: 'Stage', cell: ({ entry }) => <span className="num">{entry.stage}</span> },
            { id: 'at', header: 'At', cell: ({ entry }) => <span className="num">{entry.at}</span> },
            { id: 'note', header: 'Note', cell: ({ entry }) => entry.note ?? '' },
          ]}
          rows={history}
          rowKey={({ index }) => String(index)}
          empty="No stage history"
        />
      </FormSection>

      <FormSection id="engagement-delete" title="Delete engagement">
        {deletion.confirming ? (
          <div role="group" aria-label="Confirm deletion" className="border px-3 py-2">
            <p className="text-sm">
              Delete {saved.company.name}? The engagement is removed from this browser, along with any unsaved changes. A connected folder keeps its copy,
              which is then listed as a stale folder for you to delete by hand.
            </p>
            {deletion.error === null ? null : (
              <p role="alert" className="pt-1 text-sm text-danger">
                The engagement was not deleted: {deletion.error}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onConfirm}>
                {deletion.deleting ? 'Deleting…' : `Delete ${saved.company.name}`}
              </button>
              <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onCancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={BUTTON} onClick={deletion.onAsk}>
            Delete engagement…
          </button>
        )}
      </FormSection>
    </>
  )
}
