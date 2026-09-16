import { useStore, type BootedStore, type StoreHandle, type StoreRuntime } from './hooks/use-store'
import { AppShell } from './ui/shell/app-shell'
import { useRoute, type Route } from './ui/shell/router'
import { StoreLoading, StoreNotices, StoreRefusal } from './ui/shell/store-status'
import { PlaceholderView } from './ui/views/placeholder-view'
import { PrimitivesView } from './ui/views/primitives-view'
import { SettingsView } from './ui/views/settings/settings-view'

interface PageProps {
  route: Route
  loaded: Extract<BootedStore, { phase: 'loaded' }>
  handle: StoreHandle
  appVersion: string
}

function Page({ route, loaded, handle, appVersion }: PageProps) {
  switch (route.name) {
    case 'engagements':
      return <PlaceholderView title="Engagements" detail="The engagement list is built in Stage 1, task 1." />
    case 'engagement':
      return <PlaceholderView title={`Engagement ${route.id}`} detail="Engagement detail is built in Stage 1, task 2." />
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
        <Page route={route} loaded={state} handle={handle} appVersion={runtime.appVersion} />
      )}
    </AppShell>
  )
}
