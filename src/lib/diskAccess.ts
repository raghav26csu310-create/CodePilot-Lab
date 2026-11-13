/**
 * Honest wrappers around the File System Access API.
 *
 * Nothing here fabricates a save. Every function returns the real outcome and
 * a reason the UI can show: a picker that was cancelled, a permission that was
 * denied, a browser without the API, or a genuine write failure are all kept
 * distinct from success.
 */

export type DiskAccessStatus = 'granted' | 'prompt' | 'denied' | 'unsupported'

export type PermissionResult = {
  status: DiskAccessStatus
  reason?: string
}

export type DiskWriteOutcome =
  | { status: 'written' }
  | { status: 'skipped'; reason: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'denied'; reason: string }
  | { status: 'failed'; reason: string }

export type DiskReadOutcome =
  | { status: 'ready'; content: string }
  | { status: 'unavailable'; reason: string }

export type PickedFile = {
  name: string
  bytes: Uint8Array
  handle?: FileSystemFileHandle
}

export type PickFileResult =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

export type SaveFileResult =
  | { status: 'saved'; fileName: string }
  | { status: 'downloaded'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

export type PickedDirectoryResult =
  | { status: 'picked'; handle: FileSystemDirectoryHandle }
  | { status: 'cancelled' }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

type PermittedHandle = FileSystemDirectoryHandle

export function supportsDeviceFolders(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function supportsFilePickers(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function'
  )
}

function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError') {
      return 'The browser denied permission for this device action.'
    }
    if (cause.name === 'NotFoundError') {
      return 'The file or folder no longer exists at that path.'
    }
    if (cause.name === 'QuotaExceededError') {
      return 'The device reported that it is out of space for this write.'
    }
    if (cause.name === 'NoModificationAllowedError') {
      return 'The file is locked or read-only, so it could not be written.'
    }
    if (cause.message) {
      return cause.message
    }
  }

  if (cause instanceof Error && cause.message) {
    return cause.message
  }

  return fallback
}

/** Reads the current permission without prompting. */
export async function queryHandlePermission(
  handle: PermittedHandle,
  mode: 'read' | 'readwrite',
): Promise<PermissionResult> {
  if (typeof handle.queryPermission !== 'function') {
    return {
      status: 'unsupported',
      reason: 'This browser does not expose folder permissions to the page.',
    }
  }

  try {
    const state = await handle.queryPermission({ mode })
    return {
      status: state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt',
    }
  } catch (cause) {
    return { status: 'denied', reason: describeError(cause, 'Permission could not be read.') }
  }
}

/**
 * Ensures a permission. Pass `request: true` only from a user gesture — the
 * browser needs one to show its prompt.
 */
export async function ensureHandlePermission(
  handle: PermittedHandle,
  mode: 'read' | 'readwrite',
  request: boolean,
): Promise<PermissionResult> {
  const current = await queryHandlePermission(handle, mode)
  if (current.status !== 'prompt') {
    return current
  }

  if (!request || typeof handle.requestPermission !== 'function') {
    return {
      status: 'prompt',
      reason:
        mode === 'readwrite'
          ? 'Write access to the linked folder has not been granted yet.'
          : 'Read access to the linked folder has not been granted yet.',
    }
  }

  try {
    const state = await handle.requestPermission({ mode })
    if (state === 'granted') {
      return { status: 'granted' }
    }
    return {
      status: state === 'denied' ? 'denied' : 'prompt',
      reason:
        mode === 'readwrite'
          ? 'Write access to the linked folder was not granted, so only the browser copy was saved.'
          : 'Read access to the linked folder was not granted.',
    }
  } catch (cause) {
    return {
      status: 'denied',
      reason: describeError(
        cause,
        mode === 'readwrite'
          ? 'The browser refused the write-permission request.'
          : 'The browser refused the read-permission request.',
      ),
    }
  }
}

function splitPath(path: string): { directories: string[]; fileName: string } {
  const segments = path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  const fileName = segments.pop() ?? ''
  return { directories: segments, fileName }
}

/** Resolves every directory segment, creating missing folders. */
async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let directory = root
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  return directory
}

/**
 * Writes real text to a linked directory. The caller must already hold a user
 * gesture when write permission is still `prompt`.
 */
export async function writeTextToDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<DiskWriteOutcome> {
  const permission = await ensureHandlePermission(root, 'readwrite', true)
  if (permission.status !== 'granted') {
    if (permission.status === 'unsupported') {
      return {
        status: 'unsupported',
        reason:
          permission.reason ??
          'This browser cannot request write permission for a device folder. The browser copy was saved.',
      }
    }
    return {
      status: permission.status === 'denied' ? 'denied' : 'failed',
      reason:
        permission.reason ??
        'The linked folder did not grant write access, so only the browser copy was saved.',
    }
  }

  const { directories, fileName } = splitPath(path)
  if (!fileName) {
    return { status: 'failed', reason: 'The stored path has no file name.' }
  }

  try {
    const directory = await resolveDirectory(root, directories)
    const handle = await directory.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(content)
    } finally {
      await writable.close()
    }
    return { status: 'written' }
  } catch (cause) {
    return {
      status: 'failed',
      reason: describeError(cause, 'The linked folder rejected the write.'),
    }
  }
}

/** Reads a real text file from a linked directory. */
export async function readTextFromDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<DiskReadOutcome> {
  const permission = await ensureHandlePermission(root, 'read', true)
  if (permission.status !== 'granted') {
    return {
      status: 'unavailable',
      reason:
        permission.reason ??
        'Read permission for the linked folder was not granted. Allow access to read the device copy.',
    }
  }

  const { directories, fileName } = splitPath(path)
  if (!fileName) {
    return { status: 'unavailable', reason: 'The stored path is empty.' }
  }

  try {
    let directory = root
    for (const segment of directories) {
      directory = await directory.getDirectoryHandle(segment)
    }
    const handle = await directory.getFileHandle(fileName)
    const file = await handle.getFile()
    return { status: 'ready', content: await file.text() }
  } catch (cause) {
    return {
      status: 'unavailable',
      reason: describeError(
        cause,
        'The linked folder could not be read. The handle may have moved, lost permission, or the file no longer exists.',
      ),
    }
  }
}

/** Opens the real directory picker, or reports why it cannot. */
export async function pickDirectory(
  mode: 'read' | 'readwrite',
): Promise<PickedDirectoryResult> {
  if (!window.showDirectoryPicker) {
    return {
      status: 'unsupported',
      reason:
        'This browser does not support choosing a device folder. Import with the file input instead.',
    }
  }

  try {
    return {
      status: 'picked',
      handle: await window.showDirectoryPicker({ id: 'codepilot-project', mode }),
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return { status: 'cancelled' }
    }
    return { status: 'failed', reason: describeError(cause, 'The folder could not be opened.') }
  }
}

/**
 * Picks one file. Uses the real picker when available and a hidden file input
 * otherwise. The returned bytes are the exact bytes the browser read.
 */
export async function pickBinaryFile(options: {
  accept: string
  description: string
  maxBytes: number
}): Promise<PickFileResult> {
  const { accept, description, maxBytes } = options

  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: 'codepilot-file',
        multiple: false,
        types: [
          {
            description,
            accept: accept.includes('/')
              ? { [accept]: accept === 'application/zip' ? ['.zip'] : [] }
              : { 'application/octet-stream': accept.split(',').map((value) => value.trim()) },
          },
        ],
      })

      if (!handle) {
        return { status: 'cancelled' }
      }

      const file = await handle.getFile()
      if (file.size > maxBytes) {
        return {
          status: 'failed',
          reason: `That file is ${Math.ceil(file.size / 1024)} KiB. The limit for this action is ${Math.ceil(maxBytes / 1024)} KiB.`,
        }
      }

      return {
        status: 'picked',
        file: {
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          handle,
        },
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return { status: 'cancelled' }
      }
      return { status: 'failed', reason: describeError(cause, 'The file could not be opened.') }
    }
  }

  return new Promise<PickFileResult>((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ status: 'failed', reason: 'There is no document to open a file picker from.' })
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.position = 'fixed'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'

    const cleanup = () => {
      input.remove()
    }

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0]
        if (!file) {
          cleanup()
          resolve({ status: 'cancelled' })
          return
        }

        if (file.size > maxBytes) {
          cleanup()
          resolve({
            status: 'failed',
            reason: `That file is ${Math.ceil(file.size / 1024)} KiB. The limit for this action is ${Math.ceil(maxBytes / 1024)} KiB.`,
          })
          return
        }

        void file
          .arrayBuffer()
          .then((buffer) => {
            cleanup()
            resolve({
              status: 'picked',
              file: { name: file.name, bytes: new Uint8Array(buffer) },
            })
          })
          .catch((cause: unknown) => {
            cleanup()
            resolve({
              status: 'failed',
              reason: describeError(cause, 'The selected file could not be read.'),
            })
          })
      },
      { once: true },
    )

    input.addEventListener(
      'cancel',
      () => {
        cleanup()
        resolve({ status: 'cancelled' })
      },
      { once: true },
    )

    document.body.append(input)
    input.click()
  })
}

const MAX_OPEN_TEXT_BYTES = 4 * 1024 * 1024

export type PickTextFileResult =
  | { status: 'picked'; name: string; content: string; handle?: FileSystemFileHandle }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

/** Picks one UTF-8 text file, rejecting binaries and oversized files honestly. */
export async function pickTextFile(): Promise<PickTextFileResult> {
  const picked = await pickBinaryFile({
    accept: '.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.c,.h,.cpp,.hpp,.java,.cs,.go,.rs,.rb,.php,.html,.css,.scss,.less,.sql,.sh,.ps1,.yml,.yaml,.toml,.xml,.vue,.svelte',
    description: 'Text and source files',
    maxBytes: MAX_OPEN_TEXT_BYTES,
  })

  if (picked.status !== 'picked') {
    return picked
  }

  const binaryAt = findNulByte(picked.file.bytes)
  if (binaryAt !== -1) {
    return {
      status: 'failed',
      reason: 'That file looks binary (it contains a NUL byte), so the text editor will not open it.',
    }
  }

  return {
    status: 'picked',
    name: picked.file.name,
    content: new TextDecoder('utf-8').decode(picked.file.bytes),
    handle: picked.file.handle,
  }
}

function findNulByte(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, 8192)
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return index
    }
  }
  return -1
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a turn to start the download before revoking the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * Saves bytes through the real save picker. Without that API the browser
 * downloads the file and the UI says so instead of claiming a chosen path.
 */
export async function saveBinaryFile(options: {
  suggestedName: string
  bytes: Uint8Array
  mimeType: string
  description: string
  extensions: string[]
}): Promise<SaveFileResult> {
  const { suggestedName, bytes, mimeType, description, extensions } = options

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        id: 'codepilot-save',
        suggestedName,
        types: [{ description, accept: { [mimeType]: extensions } }],
      })
      const writable = await handle.createWritable()
      try {
        await writable.write(bytes as BlobPart)
      } finally {
        await writable.close()
      }
      return { status: 'saved', fileName: handle.name || suggestedName }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return { status: 'cancelled' }
      }
      return {
        status: 'failed',
        reason: describeError(cause, 'The browser could not save that file.'),
      }
    }
  }

  downloadBytes(bytes, suggestedName, mimeType)
  return { status: 'downloaded', fileName: suggestedName }
}

/** Saves UTF-8 text through the save picker or the download fallback. */
export async function saveTextFile(
  suggestedName: string,
  content: string,
): Promise<SaveFileResult> {
  return saveBinaryFile({
    suggestedName,
    bytes: new TextEncoder().encode(content),
    mimeType: 'text/plain',
    description: 'Text file',
    extensions: ['.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html'],
  })
}
