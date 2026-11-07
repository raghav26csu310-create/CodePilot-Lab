import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ArrowRight, FolderPlus, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { Button } from '../../design-system/primitives/Button'
import { touchProject, type ProjectRecord } from '../../lib/db'
import { greetingFor } from '../../lib/format'
import { HeroStage } from './HeroStage'
import { ProjectDialog } from './ProjectDialog'
import { QuickActions } from './QuickActions'
import { RecentProjects } from './RecentProjects'
import { SystemStatus } from './SystemStatus'
import styles from './CommandCenter.module.css'

type DialogMode = 'create' | 'import'

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.03 },
  },
}

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
}

const stageItem: Variants = {
  hidden: { opacity: 0, scale: 0.985 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.08 },
  },
}

export function CommandCenterPage() {
  const navigate = useNavigate()
  const [greeting] = useState(() => greetingFor(new Date()))
  const [dialog, setDialog] = useState<DialogMode | null>(null)

  const closeDialog = useCallback(() => setDialog(null), [])
  const openCreate = useCallback(() => setDialog('create'), [])
  const openImport = useCallback(() => setDialog('import'), [])

  const handleCompleted = useCallback(
    async (project: ProjectRecord) => {
      setDialog(null)
      try {
        await touchProject(project.id)
      } catch {
        // The new record still opens; only the last-opened stamp failed.
      }
      navigate(`/workspace/${project.id}`)
    },
    [navigate],
  )

  const openProject = useCallback(
    async (project: ProjectRecord) => {
      try {
        await touchProject(project.id)
      } catch {
        // The record can still be opened; only the last-opened stamp failed.
      }
      navigate(`/workspace/${project.id}`)
    },
    [navigate],
  )

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroGrid} aria-hidden="true" />

        <motion.div
          className={styles.heroInner}
          variants={container}
          initial="hidden"
          animate="show"
        >
          <div className={styles.copy}>
            <motion.p className={styles.eyebrow} variants={item}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              {greeting} · CodePilot Lab · Local session
            </motion.p>

            <motion.h1 id="hero-title" className={styles.title} variants={item}>
              A laboratory for software that <span className={styles.accent}>thinks</span> with
              you.
            </motion.h1>

            <motion.p className={styles.lead} variants={item}>
              Create and import real local projects, then step into the surfaces that exist. Every
              record here is yours, stored in this browser — no seeded dashboards, no fabricated
              activity.
            </motion.p>

            <motion.div className={styles.actions} variants={item}>
              <Button to="/workspace" size="lg" iconRight={<ArrowRight size={16} />}>
                Enter workspace
              </Button>
              <Button
                variant="secondary"
                size="lg"
                icon={<FolderPlus size={15} />}
                onClick={openCreate}
              >
                Create new project
              </Button>
            </motion.div>

            <motion.p className={styles.note} variants={item}>
              <span className={styles.noteItem}>
                <Lock size={11} aria-hidden="true" />
                Local assets only · no account · no API key
              </span>
              <span className={styles.noteSep} aria-hidden="true" />
              <span className={`${styles.noteItem} ${styles.noteLive}`}>
                Workspace live · milestone 04
              </span>
            </motion.p>
          </div>

          <motion.div className={styles.stageCol} variants={stageItem}>
            <HeroStage compact />
          </motion.div>
        </motion.div>
      </section>

      <motion.div
        className={styles.dashboard}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
      >
        <RecentProjects
          onCreate={openCreate}
          onImport={openImport}
          onOpen={openProject}
        />

        <div className={styles.aside}>
          <QuickActions onCreate={openCreate} onImport={openImport} />
          <SystemStatus />
        </div>
      </motion.div>

      {createPortal(
        <AnimatePresence>
          {dialog ? (
            <ProjectDialog
              mode={dialog}
              onClose={closeDialog}
              onCompleted={handleCompleted}
            />
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
