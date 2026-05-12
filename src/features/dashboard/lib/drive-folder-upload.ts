type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
}

type FileSystemFileEntryLike = FileSystemEntryLike & {
  isFile: true
  file: (successCallback: (file: File) => void, errorCallback?: (error: unknown) => void) => void
}

type FileSystemDirectoryReaderLike = {
  readEntries: (successCallback: (entries: FileSystemEntryLike[]) => void, errorCallback?: (error: unknown) => void) => void
}

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  isDirectory: true
  createReader: () => FileSystemDirectoryReaderLike
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null
}

export type DriveUploadEntry = {
  file: File
  relativePath: string
  pathSegments: string[]
}

export type DriveUploadTreeNode = {
  pathKey: string
  name: string | null
  folders: Map<string, DriveUploadTreeNode>
  files: DriveUploadEntry[]
}

function normalizeRelativePath(relativePath: string, fallbackName: string) {
  const trimmed = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return fallbackName
  return trimmed
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
}

export function createDriveUploadEntry(file: File): DriveUploadEntry {
  const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name, file.name)
  return {
    file,
    relativePath,
    pathSegments: relativePath.split('/').filter(Boolean),
  }
}

export function createDriveUploadEntriesFromFiles(files: readonly File[]) {
  return files.map((file) => createDriveUploadEntry(file))
}

export function buildDriveUploadTree(entries: readonly DriveUploadEntry[]) {
  const root: DriveUploadTreeNode = {
    pathKey: '',
    name: null,
    folders: new Map(),
    files: [],
  }

  for (const entry of entries) {
    const segments = entry.pathSegments.length > 0 ? entry.pathSegments : [entry.file.name]
    let currentNode = root
    let currentPath = ''

    for (const segment of segments.slice(0, -1)) {
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment
      let childNode = currentNode.folders.get(segment)
      if (!childNode) {
        childNode = {
          pathKey: nextPath,
          name: segment,
          folders: new Map(),
          files: [],
        }
        currentNode.folders.set(segment, childNode)
      }
      currentNode = childNode
      currentPath = nextPath
    }

    currentNode.files.push(entry)
  }

  return root
}

async function readDirectoryEntries(reader: FileSystemDirectoryReaderLike) {
  const entries: FileSystemEntryLike[] = []

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })

    if (batch.length === 0) break
    entries.push(...batch)
  }

  return entries
}

async function collectEntryFiles(entry: FileSystemEntryLike, parentSegments: string[] = []): Promise<DriveUploadEntry[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntryLike
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
    const relativePath = [...parentSegments, entry.name].join('/')
    return [
      {
        file,
        relativePath,
        pathSegments: relativePath.split('/').filter(Boolean),
      },
    ]
  }

  if (!entry.isDirectory) {
    return []
  }

  const directoryEntry = entry as FileSystemDirectoryEntryLike
  const nextSegments = [...parentSegments, entry.name]
  const children = await readDirectoryEntries(directoryEntry.createReader())
  const nestedEntries = await Promise.all(children.map((child) => collectEntryFiles(child, nextSegments)))
  return nestedEntries.flat()
}

export async function collectDriveUploadEntriesFromDataTransfer(items: DataTransferItemList) {
  const collected: DriveUploadEntry[] = []
  const directorySupportMissing = typeof DataTransferItem === 'undefined' || !('webkitGetAsEntry' in DataTransferItem.prototype)

  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue

    if (!directorySupportMissing) {
      const getAsEntry = (item as DataTransferItemWithEntry).webkitGetAsEntry
      const entry = getAsEntry?.call(item)
      if (entry) {
        collected.push(...(await collectEntryFiles(entry)))
        continue
      }
    }

    const file = item.getAsFile()
    if (file) {
      collected.push(createDriveUploadEntry(file))
    }
  }

  return collected
}
