import {
  db,
  type FeedbackCategory,
  type FeedbackDelivery,
  type FeedbackRecord,
} from './db'

/**
 * Feedback storage and optional delivery.
 *
 * Local persistence is the one guaranteed path: every submission is written to
 * IndexedDB before any network attempt. When `VITE_FEEDBACK_ENDPOINT` is set, the
 * same payload is POSTed there and the recorded delivery state says exactly what
 * happened. No endpoint configured means the UI must say "stored locally only",
 * never a fabricated "sent to the team".
 */

export const FEEDBACK_LIMITS = {
  messageMin: 10,
  messageMax: 4_000,
  contactMax: 200,
  featureMax: 80,
} as const

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'general', label: 'General feedback' },
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
]

export type FeedbackDraft = {
  category: FeedbackCategory
  rating: number | null
  feature: string
  message: string
  contact: string
  page: string
}

export type FeedbackResult = {
  record: FeedbackRecord
  delivery: FeedbackDelivery
  endpointStatus: number | null
  endpointError: string | null
}

export type FeedbackValidation = Partial<Record<keyof FeedbackDraft, string>>

export function validateFeedback(draft: FeedbackDraft): FeedbackValidation {
  const errors: FeedbackValidation = {}
  const message = draft.message.trim()

  if (message.length < FEEDBACK_LIMITS.messageMin) {
    errors.message = `Write at least ${FEEDBACK_LIMITS.messageMin} characters so the note is actionable.`
  } else if (message.length > FEEDBACK_LIMITS.messageMax) {
    errors.message = `Keep the message under ${FEEDBACK_LIMITS.messageMax} characters.`
  }

  if (draft.contact.length > FEEDBACK_LIMITS.contactMax) {
    errors.contact = `Keep contact details under ${FEEDBACK_LIMITS.contactMax} characters.`
  }

  if (draft.feature.length > FEEDBACK_LIMITS.featureMax) {
    errors.feature = `Keep the feature label under ${FEEDBACK_LIMITS.featureMax} characters.`
  }

  if (draft.rating !== null && (draft.rating < 1 || draft.rating > 5)) {
    errors.rating = 'Choose a rating from 1 to 5, or leave it blank.'
  }

  return errors
}

function feedbackEndpoint(): string | null {
  const raw = (import.meta.env.VITE_FEEDBACK_ENDPOINT ?? '').trim()
  if (!raw) {
    return null
  }

  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

async function postToEndpoint(
  endpoint: string,
  payload: FeedbackRecord,
): Promise<{ status: number | null; error: string | null }> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { status: response.status, error: `The feedback endpoint answered ${response.status}.` }
    }
    return { status: response.status, error: null }
  } catch (error) {
    return {
      status: null,
      error:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'The feedback endpoint did not answer within 8 seconds.'
          : 'The feedback endpoint could not be reached from this browser.',
    }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

/**
 * Persists locally first, then attempts the optional endpoint. The local write is
 * the source of truth; a delivery failure never discards the submission.
 */
export async function submitFeedback(draft: FeedbackDraft): Promise<FeedbackResult> {
  const record: FeedbackRecord = {
    id: createId(),
    category: draft.category,
    rating: draft.rating,
    feature: draft.feature.trim(),
    message: draft.message.trim(),
    contact: draft.contact.trim(),
    page: draft.page,
    appVersion: __APP_VERSION__,
    createdAt: Date.now(),
    delivery: 'local',
    endpointStatus: null,
    endpointError: null,
  }

  await db.feedback.add(record)

  const endpoint = feedbackEndpoint()
  if (!endpoint) {
    return {
      record,
      delivery: 'local',
      endpointStatus: null,
      endpointError: null,
    }
  }

  const result = await postToEndpoint(endpoint, record)
  const delivery: FeedbackDelivery = result.error ? 'endpoint-failed' : 'endpoint'
  const updated: FeedbackRecord = {
    ...record,
    delivery,
    endpointStatus: result.status,
    endpointError: result.error,
  }

  try {
    await db.feedback.put(updated)
  } catch {
    // The original local record still exists; delivery metadata is best effort.
  }

  return {
    record: updated,
    delivery,
    endpointStatus: result.status,
    endpointError: result.error,
  }
}

export async function listFeedback(limit = 20): Promise<FeedbackRecord[]> {
  return db.feedback.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function clearFeedback(): Promise<void> {
  await db.feedback.clear()
}
