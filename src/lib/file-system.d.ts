/**
 * The File System Access API is shipping in Chromium but is not yet part of
 * TypeScript's DOM lib. Keep the global augmentation in one place.
 */
interface Window {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}
