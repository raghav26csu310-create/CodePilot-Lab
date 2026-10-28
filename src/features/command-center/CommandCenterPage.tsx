import { motion, type Variants } from 'framer-motion'
import { ArrowRight, Lock } from 'lucide-react'

import { Badge } from '../../design-system/primitives/Badge'
import { Button } from '../../design-system/primitives/Button'
import { HeroStage } from './HeroStage'
import styles from './CommandCenter.module.css'

const CAPABILITIES = [
  {
    title: 'Command center',
    description: 'Shell, routing, command palette',
    status: 'Live',
    live: true,
  },
  {
    title: 'Core lattice',
    description: 'Realtime 3D · static fallback',
    status: 'Live',
    live: true,
  },
  {
    title: 'Workspace',
    description: 'Monaco, files, tabs, local save',
    status: 'Phase 2',
    live: false,
  },
  {
    title: 'Copilot',
    description: 'Local provider bridge, disclosed limits',
    status: 'Phase 3',
    live: false,
  },
] as const

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.065, delayChildren: 0.04 },
  },
}

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
}

export function CommandCenterPage() {
  return (
    <div className={styles.command}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroGrid} aria-hidden="true" />

        <div className={styles.heroInner}>
          <motion.div className={styles.copy} variants={container} initial="hidden" animate="show">
            <motion.p className={styles.eyebrow} variants={item}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              Local-first · AI-native · Cinematic
            </motion.p>

            <motion.h1 id="hero-title" className={styles.title} variants={item}>
              A laboratory for software that <span className={styles.accent}>thinks</span> with you.
            </motion.h1>

            <motion.p className={styles.lead} variants={item}>
              A local-first coding environment built as an instrument, not a dashboard. Files,
              editor, execution and copilot will share one surface — with output you can verify and
              nothing staged for show.
            </motion.p>

            <motion.div className={styles.actions} variants={item}>
              <Button to="/workspace" size="lg" iconRight={<ArrowRight size={16} />}>
                Enter the workspace
              </Button>
              <Button href="#capabilities" variant="secondary" size="lg">
                See system status
              </Button>
            </motion.div>

            <motion.p className={styles.note} variants={item}>
              <span className={styles.noteItem}>
                <Lock size={11} aria-hidden="true" />
                Local assets only · no account · no API key
              </span>
              <span className={styles.noteSep} aria-hidden="true" />
              <span className={`${styles.noteItem} ${styles.noteSoon}`}>
                Workspace arrives in Phase 02
              </span>
            </motion.p>
          </motion.div>

          <motion.div
            className={styles.stageCol}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            <HeroStage />
          </motion.div>
        </div>
      </section>

      <motion.section
        id="capabilities"
        className={styles.rail}
        aria-labelledby="capabilities-title"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.32 }}
      >
        <div className={styles.railInner}>
          <div className={styles.railHead}>
            <h2 id="capabilities-title" className={styles.railTitle}>
              System capability
            </h2>
            <span className={styles.railMeta}>Phase 01 · Identity</span>
          </div>

          <ul className={styles.caps}>
            {CAPABILITIES.map((capability, index) => (
              <li key={capability.title} className={styles.cap}>
                <div className={styles.capTop}>
                  <span className={styles.capIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <Badge tone={capability.live ? 'live' : 'planned'}>{capability.status}</Badge>
                </div>
                <span className={styles.capTitle}>{capability.title}</span>
                <span className={styles.capDesc}>{capability.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.section>
    </div>
  )
}
