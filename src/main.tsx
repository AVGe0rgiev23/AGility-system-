import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { version } from '../package.json'
import { App } from './app'
import { createStoreRuntime } from './hooks/use-store'
import { browserFolderPicker } from './storage/sync'
import './styles.css'

// Created once, outside React, so a re-render or StrictMode's double effects never open a second database.
const runtime = createStoreRuntime({
  clock: () => new Date().toISOString(),
  appVersion: version,
  pickFolder: browserFolderPicker(),
})

const container = document.getElementById('root')
if (container === null) throw new Error('index.html has no #root element to render the app into')

createRoot(container).render(
  <StrictMode>
    <App runtime={runtime} />
  </StrictMode>,
)
