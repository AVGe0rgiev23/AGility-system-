import { useState } from 'react'
import { useEngagementForm, type EngagementFormView, type EngagementTab } from '../../../hooks/use-engagement-form'
import type { BootedStore, StoreHandle } from '../../../hooks/use-store'
import type { Engagement } from '../../../schema/engagement'
import { hrefFor, navigate } from '../../shell/router'
import { OtherProblems, SaveBar } from '../form-controls'
import { OverviewTab, type Deletion } from './overview-tab'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

interface TabDefinition {
  id: string
  label: string
  // Set on a section not built yet: which task builds it.
  placeholder?: string
}

// One tab per section of the engagement record, so each has an address before it is built.
export const ENGAGEMENT_TABS: readonly TabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'discovery', label: 'Discovery', placeholder: 'Question sets and discovery sessions are built in Stage 1, tasks 5 to 7.' },
  { id: 'processes', label: 'Processes', placeholder: 'Process mapping is built in Stage 1, task 8.' },
  { id: 'opportunities', label: 'Opportunities', placeholder: 'Opportunity capture is built in Stage 1, task 9, and scoring in Stage 2, task 10.' },
  { id: 'blueprints', label: 'Blueprints', placeholder: 'The blueprint editor and its diagram are built in Stage 4, tasks 1 and 2.' },
  { id: 'scope', label: 'Scope', placeholder: 'The scope builder is built in Stage 2, task 11.' },
  { id: 'documents', label: 'Documents', placeholder: 'Teardowns, proposals and SOWs are built in Stage 3, tasks 4 to 8.' },
  { id: 'project', label: 'Project', placeholder: 'The project plan, task board and time log are built in Stage 4, tasks 5 and 6.' },
  { id: 'notes', label: 'Notes', placeholder: 'Editing engagement notes is not yet in BUILD-PLAN.' },
]

function isFormTab(id: string): id is EngagementTab {
  return id === 'overview' || id === 'company' || id === 'contacts'
}

export interface EngagementScreenProps {
  form: EngagementFormView
  // As addressed; null is the default tab.
  tab: string | null
  saving: boolean
  saveError: string | null
  onSave: () => void
  deletion: Deletion
}

function TabNav({ form, active }: { form: EngagementFormView; active: string | undefined }) {
  return (
    <nav aria-label="Engagement sections" className="border-b px-4">
      <ul className="flex flex-wrap">
        {ENGAGEMENT_TABS.map((tab) => {
          const issues = isFormTab(tab.id) ? form.tabIssues[tab.id] : 0
          const current = tab.id === active
          return (
            <li key={tab.id}>
              <a
                href={hrefFor({ name: 'engagement', id: form.saved.id, tab: tab.id })}
                aria-current={current ? 'page' : undefined}
                className={`block h-8 border-b-2 px-3 text-sm leading-8 transition-colors ${current ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              >
                {tab.label}
                {issues === 0 ? null : (
                  <span className="num text-danger" title={`${issues} ${issues === 1 ? 'problem' : 'problems'} on this tab`}>
                    {' '}
                    {issues}
                  </span>
                )}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// The screen, given everything it shows. EngagementDetail holds the state; this only renders it.
export function EngagementScreen({ form, tab, saving, saveError, onSave, deletion }: EngagementScreenProps) {
  const { saved } = form
  const active = ENGAGEMENT_TABS.find((candidate) => candidate.id === (tab ?? 'overview'))

  return (
    <section aria-labelledby="page-heading">
      <SaveBar
        title={
          <>
            {saved.company.name} <span className="num text-xs text-muted">{saved.stage}</span>
          </>
        }
        changed={form.changed}
        problems={form.problems}
        canSave={form.canSave}
        saving={saving}
        onSave={onSave}
        onDiscard={form.discard}
      />
      {saveError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          The engagement was not saved: {saveError}
        </p>
      )}
      <OtherProblems problems={form.otherProblems} />
      <TabNav form={form} active={active?.id} />

      {/* Keyed by the form's generation, so every control, a TracedInput's own draft included, starts again after a discard or a reload. */}
      <div key={form.state.generation}>
        {active === undefined ? (
          <p className="px-4 py-3 text-sm text-muted">
            This engagement has no section <span className="num">{tab}</span>.{' '}
            <a href={hrefFor({ name: 'engagement', id: saved.id, tab: null })} className="text-fg underline">
              Open its overview
            </a>
            .
          </p>
        ) : active.placeholder !== undefined ? (
          <p className="px-4 py-3 text-sm text-muted">{active.placeholder}</p>
        ) : active.id === 'overview' ? (
          <OverviewTab form={form} deletion={deletion} />
        ) : null}
      </div>
    </section>
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface EngagementDetailProps {
  engagement: Engagement
  tab: string | null
  handle: Pick<StoreHandle, 'saveEngagement' | 'deleteEngagement'>
}

function EngagementDetail({ engagement, tab, handle }: EngagementDetailProps) {
  const form = useEngagementForm(engagement)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const save = async () => {
    if (!form.canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await handle.saveEngagement(form.merged())
      if (!result.ok) setSaveError(result.message)
    } catch (error) {
      setSaveError(describeError(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    setDeleteError(null)
    const result = await handle.deleteEngagement(engagement.id)
    setDeleting(false)
    if (result.ok) navigate({ name: 'engagements' })
    else setDeleteError(result.message)
  }

  return (
    <EngagementScreen
      form={form}
      tab={tab}
      saving={saving}
      saveError={saveError}
      onSave={() => void save()}
      deletion={{
        confirming,
        deleting,
        error: deleteError,
        onAsk: () => setConfirming(true),
        onConfirm: () => void remove(),
        onCancel: () => {
          setConfirming(false)
          setDeleteError(null)
        },
      }}
    />
  )
}

export function EngagementNotFound({ id, storedButInvalid }: { id: string; storedButInvalid: boolean }) {
  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          Engagement not found
        </h1>
      </header>
      <p className="px-4 py-3 text-sm">
        {storedButInvalid ? (
          <>
            The engagement <span className="num">{id}</span> is stored but does not validate, so it was left out. The store notice above lists why; it is
            still stored, unchanged.
          </>
        ) : (
          <>
            There is no engagement <span className="num">{id}</span>.
          </>
        )}{' '}
        <a href={hrefFor({ name: 'engagements' })} className="text-fg underline">
          Back to the engagement list
        </a>
        .
      </p>
    </section>
  )
}

export interface EngagementViewProps {
  loaded: LoadedStore
  id: string
  tab: string | null
  handle: Pick<StoreHandle, 'saveEngagement' | 'deleteEngagement'>
}

export function EngagementView({ loaded, id, tab, handle }: EngagementViewProps) {
  const engagement = loaded.load.store.engagements.find((candidate) => candidate.id === id)
  if (engagement === undefined) {
    const storedButInvalid = loaded.load.problems.some((problem) => problem.table === 'engagements' && problem.key === id)
    return <EngagementNotFound id={id} storedButInvalid={storedButInvalid} />
  }
  // Keyed by id, so moving to another engagement starts its own form and confirmation state.
  return <EngagementDetail key={id} engagement={engagement} tab={tab} handle={handle} />
}
