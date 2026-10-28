import { Canvas, useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'

import { Lattice } from './Lattice'

type CoreSceneProps = {
  paused: boolean
  pulse: number
  onFps: (fps: number) => void
}

function PerfProbe({ onFps }: { onFps: (fps: number) => void }) {
  const frames = useRef(0)
  const lastSample = useRef(0)

  useFrame(() => {
    const now = performance.now()

    if (lastSample.current === 0) {
      lastSample.current = now
      return
    }

    frames.current += 1
    const elapsed = now - lastSample.current

    if (elapsed >= 1000) {
      onFps(Math.round((frames.current * 1000) / elapsed))
      frames.current = 0
      lastSample.current = now
    }
  })

  return null
}

function CoreScene({ paused, pulse, onFps }: CoreSceneProps) {
  const dpr = useMemo<[number, number]>(() => {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
    return window.innerWidth < 760 || memory <= 4 ? [1, 1.35] : [1, 1.75]
  }, [])

  return (
    <Canvas
      dpr={dpr}
      frameloop={paused ? 'never' : 'always'}
      camera={{ position: [0, 0, 6.4], fov: 40, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden="true"
    >
      <Lattice pulse={pulse} />
      {paused ? null : <PerfProbe onFps={onFps} />}
    </Canvas>
  )
}

export default memo(CoreScene)
