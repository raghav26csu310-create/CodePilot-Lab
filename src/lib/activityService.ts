import {
  recordActivity,
  listActivities,
  clearActivities,
  type ActivityRecord,
  type ActivityType,
} from './db'

export type { ActivityRecord, ActivityType }

const ACTIVITY_EVENT = 'codepilot:activity'
const listeners = new Set<(record: ActivityRecord) => void>()

export function emitActivityEvent(record: ActivityRecord) {
  for (const listener of listeners) {
    try {
      listener(record)
    } catch {
      // Ignore listener error
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: record }))
    } catch {
      // Window event dispatch failed
    }
  }
}

export function subscribeToActivity(callback: (record: ActivityRecord) => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export async function logActivity(
  input: Omit<ActivityRecord, 'id' | 'timestamp'> & { timestamp?: number },
): Promise<ActivityRecord> {
  const record = await recordActivity(input)
  emitActivityEvent(record)
  return record
}

export { listActivities, clearActivities }
