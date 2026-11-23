import { describe, expect, it } from 'vitest'
import {
  clearActivities,
  listActivities,
  logActivity,
  subscribeToActivity,
} from './activityService'

describe('activityService', () => {
  it('records, queries, and clears activities', async () => {
    await clearActivities()
    const initial = await listActivities()
    expect(initial).toHaveLength(0)

    let notified = false
    const unsubscribe = subscribeToActivity((record) => {
      if (record.description === 'Test activity 1') {
        notified = true
      }
    })

    const record = await logActivity({
      type: 'project:create',
      description: 'Test activity 1',
      projectName: 'Test Project',
      status: 'success',
    })

    expect(record.id).toBeDefined()
    expect(record.description).toBe('Test activity 1')
    expect(notified).toBe(true)

    unsubscribe()

    const records = await listActivities()
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]?.description).toBe('Test activity 1')

    await clearActivities()
    const afterClear = await listActivities()
    expect(afterClear).toHaveLength(0)
  })

  it('duplicates project record and contents and toggles pin', async () => {
    const { createProjectRecord, duplicateProjectCascade, toggleProjectPin, getProject, deleteProjectCascade } = await import('./db')
    const project = await createProjectRecord({
      name: 'Test Original',
      language: 'TypeScript',
      source: 'created',
    })

    const pinned = await toggleProjectPin(project.id)
    expect(pinned).toBe(true)
    const afterPin = await getProject(project.id)
    expect(afterPin?.pinned).toBe(true)

    const duplicated = await duplicateProjectCascade(project.id, 'Test Copy')
    expect(duplicated.id).not.toBe(project.id)
    expect(duplicated.name).toBe('Test Copy')
    expect(duplicated.language).toBe(project.language)

    const activities = await listActivities({ projectId: duplicated.id })
    expect(activities.some((act) => act.type === 'project:duplicate')).toBe(true)

    await deleteProjectCascade(project.id)
    await deleteProjectCascade(duplicated.id)
  })
})
