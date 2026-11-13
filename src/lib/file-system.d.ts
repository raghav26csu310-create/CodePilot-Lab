/**
 * The File System Access API is shipping in Chromium but is not yet part of
 * TypeScript's DOM lib. Keep the global augmentation in one place.
 *
 * `createWritable` already exists in lib.dom; the picker entry points and the
 * permission methods do not. They are optional because Firefox/Safari expose
 * neither, and every caller must check before using them.
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>
  requestPermission?: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>
}

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string | string[]>
}

interface FilePickerOptions {
  id?: string
  startIn?: FileSystemHandle | string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | string
  }) => Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?: (
    options?: FilePickerOptions,
  ) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (
    options?: FilePickerOptions & { suggestedName?: string },
  ) => Promise<FileSystemFileHandle>
}
