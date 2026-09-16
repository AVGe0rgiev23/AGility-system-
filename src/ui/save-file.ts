// A file download with no library: the text as a Blob behind an object URL, clicked through an anchor.
// The browser pieces are passed in so a test can stand in for them.

export interface DownloadAnchor {
  href: string
  download: string
  click(): void
  remove(): void
}

export interface DownloadEnvironment {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  // An anchor already in the document, since some browsers ignore a click on a detached one.
  appendAnchor(): DownloadAnchor
  later(task: () => void): void
}

export function browserDownloads(): DownloadEnvironment {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    appendAnchor: () => {
      const anchor = document.createElement('a')
      anchor.hidden = true
      document.body.append(anchor)
      return anchor
    },
    later: (task) => {
      setTimeout(task, 0)
    },
  }
}

export function saveJsonFile(filename: string, text: string, environment: DownloadEnvironment = browserDownloads()): void {
  const url = environment.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = environment.appendAnchor()
  anchor.href = url
  anchor.download = filename
  anchor.click()
  anchor.remove()
  // Revoked only after the click has handed the file over: revoking at once can cancel the download.
  environment.later(() => environment.revokeObjectURL(url))
}
