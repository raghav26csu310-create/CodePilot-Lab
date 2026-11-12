import { db, type ConversionRecord } from '../../lib/db'

export async function listConversions(limit = 40): Promise<ConversionRecord[]> {
  return db.conversions.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function saveConversion(record: ConversionRecord): Promise<void> {
  await db.conversions.put(record)
}

export async function deleteConversion(id: string): Promise<void> {
  await db.conversions.delete(id)
}

export async function clearConversions(): Promise<void> {
  await db.conversions.clear()
}

export function newConversionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
