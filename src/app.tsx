import { useStore, type StoreRuntime } from './hooks/use-store'
import { AppShell } from './ui/shell/app-shell'
import { useRoute, type Route } from './ui/shell/router'
import { StoreLoading, StoreNotices, StoreRefusal } from './ui/shell/store-status'
import { PlaceholderView } from './ui/views/placeholder-view'

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'engagements':
      return <PlaceholderView title="Engagements" detail="The engagement list is built in Stage 1, task 1." />
    case 'engagement':
      return <PlaceholderView title={`Engagement ${route.id}`} detail="Engagement detail is built in Stage 1, task 2." />
    case 'settings':
      return <PlaceholderView title="Settings" detail="The Settings screen is built in Stage 0, task 9." />
    case 'primitives':
      return <PlaceholderView title="Primitives" detail="The primitives reference is not built yet." />
    case 'not-found':
      return <PlaceholderView title="Not found" detail={`Nothing lives at '${route.path}'.`} />
  }
}

export function App({ runtime }: { runtime: StoreRuntime }) {
  const route = useRoute()
  const { state, syncWarning, connect, reconnect } = useStore(runtime)

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
      {state.phase === 'loading' ? <StoreLoading /> : state.phase === 'refused' ? <StoreRefusal refusal={state.refusal} /> : <Page route={route} />}
    </AppShell>
  )
}
