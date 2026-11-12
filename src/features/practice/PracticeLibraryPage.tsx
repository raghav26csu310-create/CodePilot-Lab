import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Circle,
  Filter,
  Flame,
  LoaderCircle,
  Search,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Select } from '../../design-system/primitives/Select'
import type { PracticeProgress, PracticeSubmission } from '../../lib/db'
import {
  DIFFICULTY_LABEL,
  PRACTICE_PROBLEMS,
  type Difficulty,
} from './catalog'
import {
  computePracticeStats,
  listPracticeProgress,
  listPracticeSubmissions,
  setPracticeBookmark,
  type PracticeStats,
} from './progressStorage'
import styles from './PracticeLibraryPage.module.css'

type StatusFilter = 'all' | 'unsolved' | 'solved' | 'attempted' | 'bookmarked'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All problems' },
  { value: 'unsolved', label: 'Not solved yet' },
  { value: 'attempted', label: 'Attempted' },
  { value: 'solved', label: 'Solved' },
  { value: 'bookmarked', label: 'Bookmarked' },
]

const DIFFICULTY_OPTIONS: { value: 'all' | Difficulty; label: string }[] = [
  { value: 'all', label: 'All difficulties' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

const DIFFICULTY_BY_ID = new Map(PRACTICE_PROBLEMS.map((problem) => [problem.id, problem.difficulty]))

export function PracticeLibraryPage() {
  const [progress, setProgress] = useState<PracticeProgress[]>([])
  const [submissions, setSubmissions] = useState<PracticeSubmission[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [difficulty, setDifficulty] = useState<'all' | Difficulty>('all')
  const [topic, setTopic] = useState('all')
  const [search, setSearch] = useState('')
  const [bookmarkBusy, setBookmarkBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [rows, subs] = await Promise.all([listPracticeProgress(), listPracticeSubmissions()])
        if (cancelled) {
          return
        }
        setProgress(rows)
        setSubmissions(subs)
        setError(null)
      } catch {
        if (!cancelled) {
          setError('Practice progress could not be read from IndexedDB.')
        }
      } finally {
        if (!cancelled) {
          setLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const progressById = useMemo(
    () => new Map(progress.map((entry) => [entry.problemId, entry])),
    [progress],
  )

  const stats: PracticeStats = useMemo(
    () =>
      computePracticeStats(progress, submissions, (problemId) => DIFFICULTY_BY_ID.get(problemId) ?? null),
    [progress, submissions],
  )

  const topics = useMemo(() => {
    const set = new Set<string>()
    for (const problem of PRACTICE_PROBLEMS) {
      for (const entry of problem.topics) {
        set.add(entry)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return PRACTICE_PROBLEMS.filter((problem) => {
      const entry = progressById.get(problem.id)
      if (status === 'solved' && !entry?.solved) return false
      if (status === 'unsolved' && entry?.solved) return false
      if (status === 'attempted' && (entry?.attempted ?? 0) === 0) return false
      if (status === 'bookmarked' && !entry?.bookmarked) return false
      if (difficulty !== 'all' && problem.difficulty !== difficulty) return false
      if (topic !== 'all' && !problem.topics.includes(topic)) return false
      if (!term) return true
      return (
        problem.title.toLowerCase().includes(term) ||
        problem.summary.toLowerCase().includes(term) ||
        problem.topics.some((value) => value.toLowerCase().includes(term))
      )
    })
  }, [difficulty, progressById, search, status, topic])

  const nextProblem = useMemo(() => {
    const unsolved = PRACTICE_PROBLEMS.find((problem) => !progressById.get(problem.id)?.solved)
    return unsolved ?? PRACTICE_PROBLEMS[0]
  }, [progressById])

  const toggleBookmark = async (problemId: string) => {
    if (bookmarkBusy) {
      return
    }
    const current = progressById.get(problemId)?.bookmarked ?? false
    setBookmarkBusy(problemId)
    try {
      await setPracticeBookmark(problemId, !current)
      const rows = await listPracticeProgress()
      setProgress(rows)
    } catch {
      setError('The bookmark could not be saved to IndexedDB.')
    } finally {
      setBookmarkBusy(null)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Phase 06 · Practice Arena</p>
          <h1 className={styles.title}>
            Original problems.
            <span className={styles.titleAccent}> Real verdicts.</span>
          </h1>
          <p className={styles.lede}>
            Thirteen original problems across arrays, strings, graphs, backtracking and dynamic
            programming. Run the visible cases, submit against a private suite, and keep your
            drafts, notes, bookmarks and submissions in this browser. Hidden inputs never reach the
            page.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryLink} to={`/practice/${nextProblem?.id ?? 'signal-peak'}`}>
              <Sparkles size={13} aria-hidden="true" />
              {nextProblem ? `Continue with ${nextProblem.title}` : 'Open the first problem'}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            {stats.attempted > 0 ? (
              <span className={styles.streak}>
                <Flame size={12} aria-hidden="true" />
                {stats.streak > 0 ? `${stats.streak}-day submission streak` : 'No streak today'}
              </span>
            ) : null}
          </div>
        </div>

        <dl className={styles.stats}>
          <div className={styles.statCard}>
            <dt>
              <Trophy size={12} aria-hidden="true" /> Solved
            </dt>
            <dd>
              {stats.solved}
              <span>/ {PRACTICE_PROBLEMS.length}</span>
            </dd>
          </div>
          <div className={styles.statCard}>
            <dt>
              <Target size={12} aria-hidden="true" /> Attempted
            </dt>
            <dd>{stats.attempted}</dd>
          </div>
          <div className={styles.statCard}>
            <dt>
              <CheckCircle2 size={12} aria-hidden="true" /> Acceptance
            </dt>
            <dd>
              {stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`}
              <span>
                {stats.submissions} submission{stats.submissions === 1 ? '' : 's'}
              </span>
            </dd>
          </div>
          <div className={styles.statCard}>
            <dt>
              <Bookmark size={12} aria-hidden="true" /> Bookmarked
            </dt>
            <dd>{stats.bookmarked}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.progressStrip} aria-label="Progress by difficulty">
        {(Object.keys(stats.byDifficulty) as Difficulty[]).map((level) => {
          const total = PRACTICE_PROBLEMS.filter((problem) => problem.difficulty === level).length
          const solved = stats.byDifficulty[level].solved
          return (
            <div key={level} className={styles.progressItem}>
              <span className={styles.progressLabel}>
                {DIFFICULTY_LABEL[level]}
                <span>
                  {solved}/{total}
                </span>
              </span>
              <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={solved} aria-label={`${DIFFICULTY_LABEL[level]} solved`}>
                <span
                  data-difficulty={level}
                  style={{ width: total > 0 ? `${(solved / total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <section className={styles.filters} aria-label="Problem filters">
        <div className={styles.filterHead}>
          <span>
            <Filter size={12} aria-hidden="true" />
            {filtered.length} of {PRACTICE_PROBLEMS.length} problems
          </span>
          {status !== 'all' || difficulty !== 'all' || topic !== 'all' || search ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                setStatus('all')
                setDifficulty('all')
                setTopic('all')
                setSearch('')
              }}
            >
              Reset filters
            </button>
          ) : null}
        </div>

        <div className={styles.filterRow}>
          <label className={styles.searchField}>
            <Search size={13} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, summaries and topics"
              aria-label="Search problems"
            />
          </label>
          <div className={styles.filterSelect}>
            <Select
              value={status}
              onChange={(value) => setStatus(value as StatusFilter)}
              options={STATUS_OPTIONS}
              ariaLabel="Progress filter"
              compact
            />
          </div>
          <div className={styles.filterSelect}>
            <Select
              value={difficulty}
              onChange={(value) => setDifficulty(value as 'all' | Difficulty)}
              options={DIFFICULTY_OPTIONS}
              ariaLabel="Difficulty filter"
              compact
            />
          </div>
          <div className={styles.filterSelect}>
            <Select
              value={topic}
              onChange={setTopic}
              options={[
                { value: 'all', label: 'All topics' },
                ...topics.map((entry) => ({ value: entry, label: entry })),
              ]}
              ariaLabel="Topic filter"
              compact
            />
          </div>
        </div>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}

      {!loaded ? (
        <p className={styles.loading}>
          <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />
          Reading stored practice progress…
        </p>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No problem matches those filters.</p>
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              setStatus('all')
              setDifficulty('all')
              setTopic('all')
              setSearch('')
            }}
          >
            Show all problems
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {filtered.map((problem) => {
            const entry = progressById.get(problem.id)
            return (
              <li key={problem.id} className={styles.card} data-solved={entry?.solved ?? false}>
                <div className={styles.cardTop}>
                  <span className={styles.difficulty} data-level={problem.difficulty}>
                    {DIFFICULTY_LABEL[problem.difficulty]}
                  </span>
                  <div className={styles.cardTopRight}>
                    {entry?.solved ? (
                      <span className={styles.solvedChip}>
                        <CheckCircle2 size={11} aria-hidden="true" />
                        Solved
                      </span>
                    ) : entry && entry.attempted > 0 ? (
                      <span className={styles.attemptedChip}>
                        <Circle size={9} aria-hidden="true" />
                        {entry.attempted} attempt{entry.attempted === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={styles.bookmarkButton}
                      data-active={entry?.bookmarked ?? false}
                      onClick={() => void toggleBookmark(problem.id)}
                      disabled={bookmarkBusy === problem.id}
                      aria-label={
                        entry?.bookmarked ? `Remove bookmark for ${problem.title}` : `Bookmark ${problem.title}`
                      }
                      title={entry?.bookmarked ? 'Remove bookmark' : 'Bookmark this problem'}
                    >
                      {entry?.bookmarked ? (
                        <BookmarkCheck size={13} aria-hidden="true" />
                      ) : (
                        <Bookmark size={13} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <h2 className={styles.cardTitle}>
                  <Link to={`/practice/${problem.id}`}>{problem.title}</Link>
                </h2>
                <p className={styles.cardSummary}>{problem.summary}</p>

                <div className={styles.topics}>
                  {problem.topics.map((entry_) => (
                    <span key={entry_}>{entry_}</span>
                  ))}
                </div>

                <div className={styles.cardFoot}>
                  <span className={styles.runtimes}>6 runtimes · visible + hidden tests</span>
                  <Link className={styles.cardLink} to={`/practice/${problem.id}`}>
                    Open
                    <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles.footnote}>
        Progress, drafts and submissions are stored only in this browser's IndexedDB. Grading runs
        on the loopback service with private test data; the page receives only case indices, hidden
        flags, statuses and bounded visible stderr.
      </p>
    </main>
  )
}
