import {
  db,
  type PracticeProgress,
  type PracticeSubmission,
} from '../../lib/db'

export function emptyProgress(problemId: string): PracticeProgress {
  return {
    problemId,
    attempted: 0,
    solved: false,
    solvedAt: null,
    lastAttemptAt: 0,
    lastLanguage: 'python',
    bookmarked: false,
    notes: '',
    codeByLanguage: {},
  }
}

export async function getPracticeProgress(problemId: string): Promise<PracticeProgress> {
  return (await db.practiceProgress.get(problemId)) ?? emptyProgress(problemId)
}

export async function listPracticeProgress(): Promise<PracticeProgress[]> {
  return db.practiceProgress.toArray()
}

export async function listPracticeSubmissions(): Promise<PracticeSubmission[]> {
  return db.practiceSubmissions.orderBy('createdAt').reverse().toArray()
}

export async function listProblemSubmissions(problemId: string): Promise<PracticeSubmission[]> {
  return db.practiceSubmissions
    .where('problemId')
    .equals(problemId)
    .reverse()
    .sortBy('createdAt')
}

async function ensureProgress(problemId: string): Promise<PracticeProgress> {
  const current = await db.practiceProgress.get(problemId)
  if (current) {
    return current
  }
  const created = emptyProgress(problemId)
  await db.practiceProgress.put(created)
  return created
}

export async function savePracticeDraft(
  problemId: string,
  language: string,
  code: string,
): Promise<void> {
  const current = await ensureProgress(problemId)
  await db.practiceProgress.put({
    ...current,
    lastLanguage: language,
    codeByLanguage: { ...current.codeByLanguage, [language]: code },
  })
}

export async function setPracticeBookmark(problemId: string, bookmarked: boolean): Promise<void> {
  const current = await ensureProgress(problemId)
  await db.practiceProgress.put({ ...current, bookmarked })
}

export async function savePracticeNotes(problemId: string, notes: string): Promise<void> {
  const current = await ensureProgress(problemId)
  await db.practiceProgress.put({ ...current, notes })
}

export type AttemptInput = {
  problemId: string
  language: string
  verdict: string
  passed: number
  total: number
  hiddenCases: number
  durationMs: number
}

function submissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Records a real submission result. A problem is only marked solved when the
 * grading service returned `accepted` for the full suite.
 */
export async function recordPracticeAttempt(input: AttemptInput): Promise<PracticeProgress> {
  const current = await ensureProgress(input.problemId)
  const now = Date.now()
  const accepted = input.verdict === 'accepted'

  const updated: PracticeProgress = {
    ...current,
    attempted: current.attempted + 1,
    solved: current.solved || accepted,
    solvedAt: current.solved ? current.solvedAt : accepted ? now : null,
    lastAttemptAt: now,
    lastLanguage: input.language,
  }

  const submission: PracticeSubmission = {
    id: submissionId(),
    problemId: input.problemId,
    language: input.language,
    verdict: input.verdict,
    passed: input.passed,
    total: input.total,
    hiddenCases: input.hiddenCases,
    durationMs: input.durationMs,
    createdAt: now,
  }

  await db.transaction('rw', db.practiceProgress, db.practiceSubmissions, async () => {
    await db.practiceProgress.put(updated)
    await db.practiceSubmissions.put(submission)
  })

  return updated
}

export type PracticeStats = {
  attempted: number
  solved: number
  submissions: number
  accepted: number
  accuracy: number | null
  byDifficulty: Record<'easy' | 'medium' | 'hard', { attempted: number; solved: number }>
  bookmarked: number
  streak: number
  lastActivity: number | null
}

/** Statistics computed from stored progress and submissions only. */
export function computePracticeStats(
  progress: PracticeProgress[],
  submissions: PracticeSubmission[],
  difficultyFor: (problemId: string) => 'easy' | 'medium' | 'hard' | null,
): PracticeStats {
  const byDifficulty = {
    easy: { attempted: 0, solved: 0 },
    medium: { attempted: 0, solved: 0 },
    hard: { attempted: 0, solved: 0 },
  }

  for (const entry of progress) {
    if (entry.attempted === 0) {
      continue
    }
    const difficulty = difficultyFor(entry.problemId)
    if (!difficulty) {
      continue
    }
    byDifficulty[difficulty].attempted += 1
    if (entry.solved) {
      byDifficulty[difficulty].solved += 1
    }
  }

  const accepted = submissions.filter((submission) => submission.verdict === 'accepted').length

  const dayKeys = new Set(
    submissions.map((submission) => new Date(submission.createdAt).toDateString()),
  )
  let streak = 0
  const cursor = new Date()
  // A streak requires actual submissions on consecutive local days. If there
  // is no submission today, the streak is 0 rather than carried over.
  while (dayKeys.has(cursor.toDateString())) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  const timestamps = submissions.map((submission) => submission.createdAt)

  return {
    attempted: progress.filter((entry) => entry.attempted > 0).length,
    solved: progress.filter((entry) => entry.solved).length,
    submissions: submissions.length,
    accepted,
    accuracy: submissions.length > 0 ? accepted / submissions.length : null,
    byDifficulty,
    bookmarked: progress.filter((entry) => entry.bookmarked).length,
    streak,
    lastActivity: timestamps.length > 0 ? Math.max(...timestamps) : null,
  }
}
