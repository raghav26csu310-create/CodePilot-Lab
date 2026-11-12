import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

/**
 * Replaces the __SITE_URL__ token in built HTML, robots.txt and sitemap.xml.
 *
 * Usage: SITE_URL=https://example.com npm run build && node scripts/set-site-url.mjs
 *
 * With no SITE_URL the token becomes an empty string, which leaves valid
 * relative links in development previews. A production deployment should set
 * SITE_URL so canonical, Open Graph and sitemap URLs are absolute.
 */

const raw = (process.env.SITE_URL ?? '').trim()
let base = ''

if (raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    console.error(`SITE_URL is not a valid URL: ${raw}`)
    process.exit(1)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.error('SITE_URL must use http or https.')
    process.exit(1)
  }
  base = parsed.origin
} else {
  console.warn(
    'SITE_URL is not set. Canonical, Open Graph and sitemap URLs will stay relative; set it before a public deployment.',
  )
}

const ROOT = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const EXTENSIONS = new Set(['.html', '.xml', '.txt'])
let changed = 0

async function walk(directory) {
  const entries = await readdir(directory)
  for (const name of entries) {
    const path = join(directory, name)
    const info = await stat(path)
    if (info.isDirectory()) {
      await walk(path)
      continue
    }
    if (!EXTENSIONS.has(extname(path))) {
      continue
    }
    const source = await readFile(path, 'utf8')
    if (!source.includes('__SITE_URL__')) {
      continue
    }
    await writeFile(path, source.split('__SITE_URL__').join(base), 'utf8')
    changed += 1
  }
}

await walk(ROOT)
console.log(`set-site-url: rewrote ${changed} file(s) using ${base || '(relative URLs)'}`)
