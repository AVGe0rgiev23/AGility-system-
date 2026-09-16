import { describe, expect, it } from 'vitest'
import { saveJsonFile, type DownloadAnchor, type DownloadEnvironment } from './save-file'

function fakeEnvironment() {
  const events: string[] = []
  const blobs: Blob[] = []
  const deferred: (() => void)[] = []
  const anchor: DownloadAnchor = {
    href: '',
    download: '',
    click: () => events.push(`click ${anchor.href} as ${anchor.download}`),
    remove: () => events.push('remove'),
  }
  const environment: DownloadEnvironment = {
    createObjectURL: (blob) => {
      blobs.push(blob)
      events.push('create')
      return 'blob:agility/1'
    },
    revokeObjectURL: (url) => events.push(`revoke ${url}`),
    appendAnchor: () => {
      events.push('append')
      return anchor
    },
    later: (task) => {
      deferred.push(task)
    },
  }
  return { environment, events, blobs, deferred }
}

describe('saveJsonFile', () => {
  it('clicks a download of the exact text under the filename, then revokes the URL once the click is done', async () => {
    const { environment, events, blobs, deferred } = fakeEnvironment()
    saveJsonFile('agility-os-export-2026-09-16.json', '{\n  "meta": {}\n}\n', environment)

    expect(events).toEqual(['create', 'append', 'click blob:agility/1 as agility-os-export-2026-09-16.json', 'remove'])
    expect(blobs).toHaveLength(1)
    expect(blobs[0]?.type).toBe('application/json')
    expect(await blobs[0]?.text()).toBe('{\n  "meta": {}\n}\n')

    expect(deferred).toHaveLength(1)
    for (const task of deferred) task()
    expect(events.at(-1)).toBe('revoke blob:agility/1')
  })
})
