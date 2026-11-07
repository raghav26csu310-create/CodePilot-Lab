import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react'

import { extensionForFile } from '../../../lib/projectImport'
import styles from './FileGlyph.module.css'

type GlyphTone =
  | 'typescript'
  | 'javascript'
  | 'code'
  | 'style'
  | 'markup'
  | 'config'
  | 'doc'
  | 'image'
  | 'archive'
  | 'shell'
  | 'plain'
  | 'folder'

function toneForFile(name: string): GlyphTone {
  const lower = name.toLocaleLowerCase()
  const extension = extensionForFile(lower)

  if (lower === '.env' || lower.startsWith('.env.')) {
    return 'config'
  }

  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'style'
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
    case 'astro':
      return 'markup'
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
      return 'config'
    case 'md':
    case 'mdx':
    case 'txt':
    case 'rst':
      return 'doc'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
      return 'image'
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
      return 'archive'
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return 'shell'
    case '':
      return 'plain'
    default:
      return 'code'
  }
}

function GlyphShape({
  tone,
  size,
  className,
}: {
  tone: GlyphTone
  size: number
  className: string
}) {
  const common = {
    size,
    className,
    'data-tone': tone,
    'aria-hidden': true,
  } as const

  switch (tone) {
    case 'config':
      return <FileCog {...common} />
    case 'doc':
      return <FileText {...common} />
    case 'image':
      return <FileImage {...common} />
    case 'archive':
      return <FileArchive {...common} />
    case 'shell':
      return <FileTerminal {...common} />
    case 'plain':
      return <File {...common} />
    default:
      return <FileCode {...common} />
  }
}

type FileGlyphProps = {
  name: string
  kind: 'file' | 'folder'
  open?: boolean
  size?: number
  className?: string
}

export function FileGlyph({ name, kind, open = false, size = 14, className }: FileGlyphProps) {
  const classes = `${styles.glyph} ${className ?? ''}`

  if (kind === 'folder') {
    return open ? (
      <FolderOpen
        size={size}
        className={classes}
        data-tone="folder"
        aria-hidden="true"
      />
    ) : (
      <Folder size={size} className={classes} data-tone="folder" aria-hidden="true" />
    )
  }

  return <GlyphShape tone={toneForFile(name)} size={size} className={classes} />
}
