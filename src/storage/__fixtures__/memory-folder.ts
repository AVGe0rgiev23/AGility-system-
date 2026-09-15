import type { FolderFileHandle, FolderHandle, FolderWritable } from '../sync'

// An in-memory stand-in for a FileSystemDirectoryHandle, for the sync and restore tests. It
// behaves like the browser where it matters: a missing entry throws NotFoundError, a file in
// place of a folder throws TypeMismatchError, and a write lands only when the stream closes.

class MemoryFile implements FolderFileHandle {
  content = ''
  writes = 0

  constructor(private readonly root: MemoryFolder) {}

  createWritable(): Promise<FolderWritable> {
    let buffer = ''
    return Promise.resolve({
      write: (data: string) => {
        if (this.root.failure !== null) return Promise.reject(this.root.failure)
        buffer += data
        return Promise.resolve()
      },
      close: () => {
        this.content = buffer
        this.writes++
        return Promise.resolve()
      },
    })
  }

  getFile(): Promise<{ text(): Promise<string> }> {
    return Promise.resolve({ text: () => Promise.resolve(this.content) })
  }
}

export class MemoryFolder implements FolderHandle {
  readonly kind = 'directory'
  readonly entries = new Map<string, MemoryFolder | MemoryFile>()
  permission: PermissionState = 'granted'
  // What requestPermission grants when asked.
  grants: PermissionState = 'granted'
  // When set, every write through this tree fails with it.
  failure: Error | null = null

  constructor(
    readonly name: string,
    private readonly root: MemoryFolder | null = null,
  ) {}

  private get top(): MemoryFolder {
    return this.root ?? this
  }

  getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryFolder> {
    const entry = this.entries.get(name)
    if (entry instanceof MemoryFolder) return Promise.resolve(entry)
    if (entry !== undefined) return Promise.reject(new DOMException(`${name} is a file`, 'TypeMismatchError'))
    if (options.create !== true) return Promise.reject(new DOMException(`${name} not found`, 'NotFoundError'))
    const folder = new MemoryFolder(name, this.top)
    this.entries.set(name, folder)
    return Promise.resolve(folder)
  }

  getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryFile> {
    const entry = this.entries.get(name)
    if (entry instanceof MemoryFile) return Promise.resolve(entry)
    if (entry !== undefined) return Promise.reject(new DOMException(`${name} is a folder`, 'TypeMismatchError'))
    if (options.create !== true) return Promise.reject(new DOMException(`${name} not found`, 'NotFoundError'))
    const file = new MemoryFile(this.top)
    this.entries.set(name, file)
    return Promise.resolve(file)
  }

  keys(): AsyncIterable<string> {
    const names = [...this.entries.keys()]
    return {
      [Symbol.asyncIterator]: () => {
        let index = 0
        return {
          next: (): Promise<IteratorResult<string>> => {
            const name = names[index++]
            return Promise.resolve(name === undefined ? { done: true, value: undefined } : { done: false, value: name })
          },
        }
      },
    }
  }

  queryPermission(): Promise<PermissionState> {
    return Promise.resolve(this.permission)
  }

  requestPermission(): Promise<PermissionState> {
    this.permission = this.grants
    return Promise.resolve(this.permission)
  }

  // Every file path under this folder, sorted.
  paths(prefix = ''): string[] {
    return [...this.entries.entries()]
      .flatMap(([name, entry]) => (entry instanceof MemoryFolder ? entry.paths(`${prefix}${name}/`) : [`${prefix}${name}`]))
      .sort()
  }

  private file(path: string): MemoryFile | undefined {
    const [head = '', ...rest] = path.split('/')
    const entry = this.entries.get(head)
    if (rest.length === 0) return entry instanceof MemoryFile ? entry : undefined
    return entry instanceof MemoryFolder ? entry.file(rest.join('/')) : undefined
  }

  read(path: string): string | undefined {
    return this.file(path)?.content
  }

  writesTo(path: string): number {
    return this.file(path)?.writes ?? 0
  }

  // Puts a file in place directly, as if written by hand or by an earlier version of the app.
  async put(path: string, content: string): Promise<void> {
    const [head = '', ...rest] = path.split('/')
    if (rest.length === 0) {
      ;(await this.getFileHandle(head, { create: true })).content = content
      return
    }
    await (await this.getDirectoryHandle(head, { create: true })).put(rest.join('/'), content)
  }
}
