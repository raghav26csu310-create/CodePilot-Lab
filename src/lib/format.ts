const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
})

export function formatDate(timestamp: number): string {
  return DATE_FORMAT.format(timestamp)
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function relativeTime(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp)
  const minutes = Math.floor(delta / 60_000)

  if (minutes < 1) {
    return 'just now'
  }

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  if (days < 7) {
    return `${days}d ago`
  }

  return DATE_FORMAT.format(timestamp)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const digits = value >= 100 || exponent === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[exponent] ?? 'B'}`
}

/** Time-of-day greeting, computed once from the local clock. */
export function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
