import { useState } from 'react'
import { useStore, type BootedStore, type StoreHandle, type StoreRuntime } from './hooks/use-store'
import { AppShell } from './ui/shell/app-shell'
import { useRoute, type Route } from './ui/shell/router'
import { StoreLoading, StoreNotices, StoreRefusal } from './ui/shell/store-status'
import { DEFAULT_LIST_PREFS, EngagementListView, type EngagementListPrefs } from './ui/views/engagements/engagement-list-view'
import { EngagementView } from './ui/views/engagements/engagement-view'
import { PatternEditorView } from './ui/views/patterns/pattern-editor-view'
import { PatternListView } from './ui/views/patterns/pattern-list-view'
import { PlaceholderView } from './ui/views/placeholder-view'
import { PrimitivesView } from './ui/views/primitives-view'
import { QuestionSetEditorView } from './ui/views/question-sets/question-set-editor-view'
import { QuestionSetListView } from './ui/views/question-sets/question-set-list-view'
import { SettingsView } from './ui/views/settings/settings-view'

interface PageProps {
  route: Route
  loaded: Extract<BootedStore, { phase: 'loaded' }>
  handle: StoreHandle
  appVersion: string
  listPrefs: EngagementListPrefs
  onListPrefs: (prefs: EngagementListPrefs) => void
}

function Page({ route, loaded, handle, appVersion, listPrefs, onListPrefs }: PageProps) {
  switch (route.name) {
    case 'engagements':
      return (
        <EngagementListView
          engagements={loaded.load.store.engagements}
          industries={loaded.load.store.config?.industries ?? null}
          prefs={listPrefs}
          onPrefs={onListPrefs}
          createEngagement={handle.createEngagement}
        />
      )
    case 'engagement':
      return <EngagementView loaded={loaded} id={route.id} tab={route.tab} item={route.item ?? null} handle={handle} />
    case 'question-sets':
      return <QuestionSetListView loaded={loaded} saveLibrary={handle.saveLibrary} />
    case 'question-set':
      return <QuestionSetEditorView loaded={loaded} id={route.id} saveLibrary={handle.saveLibrary} />
    case 'patterns':
      return <PatternListView loaded={loaded} saveLibrary={handle.saveLibrary} />
    case 'pattern':
      return <PatternEditorView loaded={loaded} id={route.id} saveLibrary={handle.saveLibrary} />
    case 'settings':
      return <SettingsView loaded={loaded} handle={handle} appVersion={appVersion} />
    case 'primitives':
      return <PrimitivesView />
    case 'not-found':
      return <PlaceholderView title="Not found" detail={`Nothing lives at '${route.path}'.`} />
  }
}

export function App({ runtime }: { runtime: StoreRuntime }) {
  const route = useRoute()
  const handle = useStore(runtime)
  const { state, syncWarning, connect, reconnect } = handle
  const [listPrefs, setListPrefs] = useState(DEFAULT_LIST_PREFS)

  return (
    <AppShell
      route={route}
      sync={state.phase === 'loaded' ? state.sync : null}
      notices={
        state.phase === 'loaded' ? (
          <StoreNotices store={state} syncWarning={syncWarning} onConnect={() => void connect()} onReconnect={() => void reconnect()} />
        ) : null
      }
    >
      {state.phase === 'loading' ? (
        <StoreLoading />
      ) : state.phase === 'refused' ? (
        <StoreRefusal refusal={state.refusal} />
      ) : (
        <Page route={route} loaded={state} handle={handle} appVersion={runtime.appVersion} listPrefs={listPrefs} onListPrefs={setListPrefs} />
      )}
    </AppShell>
  )
}
