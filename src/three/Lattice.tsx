import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

const SHELL_RADIUS = 1.42

function createGlowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    )
    gradient.addColorStop(0, 'rgba(190, 252, 255, 1)')
    gradient.addColorStop(0.22, 'rgba(87, 226, 230, 0.55)')
    gradient.addColorStop(0.6, 'rgba(48, 140, 190, 0.12)')
    gradient.addColorStop(1, 'rgba(87, 226, 230, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function Lattice({ pulse }: { pulse: number }) {
  const tilt = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const nucleus = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.SpriteMaterial>(null)
  const violetGlow = useRef<THREE.SpriteMaterial>(null)
  const pulseRing = useRef<THREE.Mesh>(null)
  const pulseMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const orbitA = useRef<THREE.Mesh>(null)
  const orbitB = useRef<THREE.Mesh>(null)
  const orbitC = useRef<THREE.Mesh>(null)
  const pulseStartedAt = useRef(-10)

  const edges = useMemo(() => {
    const shell = new THREE.IcosahedronGeometry(SHELL_RADIUS, 1)
    const shellEdges = new THREE.EdgesGeometry(shell)
    shell.dispose()

    const outer = new THREE.IcosahedronGeometry(2.18, 1)
    const outerEdges = new THREE.EdgesGeometry(outer)
    outer.dispose()

    return { shellEdges, outerEdges }
  }, [])

  const dust = useMemo(() => {
    const count = window.innerWidth < 760 ? 130 : 280
    const positions = new Float32Array(count * 3)
    let seed = 0x2f6e2b1

    // Deterministic PRNG keeps the composition stable across renders.
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }

    for (let index = 0; index < count; index += 1) {
      const radius = 1.72 + random() * 1.3
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)

      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[index * 3 + 1] = radius * Math.cos(phi) * 0.74
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }

    return positions
  }, [])

  const glowTexture = useMemo(() => createGlowTexture(), [])

  useEffect(
    () => () => {
      edges.shellEdges.dispose()
      edges.outerEdges.dispose()
    },
    [edges],
  )

  useEffect(() => () => glowTexture.dispose(), [glowTexture])

  useEffect(() => {
    if (pulse > 0) {
      pulseStartedAt.current = performance.now()
    }
  }, [pulse])

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)

    if (spin.current) {
      spin.current.rotation.y = elapsed * 0.075
    }

    if (tilt.current) {
      tilt.current.rotation.x = THREE.MathUtils.damp(
        tilt.current.rotation.x,
        state.pointer.y * -0.16,
        3.5,
        dt,
      )
      tilt.current.rotation.y = THREE.MathUtils.damp(
        tilt.current.rotation.y,
        state.pointer.x * 0.22,
        3.5,
        dt,
      )
    }

    if (nucleus.current) {
      const breath = 1 + Math.sin(elapsed * 1.15) * 0.02
      nucleus.current.scale.setScalar(breath)
    }

    if (glow.current) {
      glow.current.opacity = 0.28 + Math.sin(elapsed * 1.15) * 0.04
    }

    if (violetGlow.current) {
      violetGlow.current.opacity = 0.12 + Math.sin(elapsed * 0.7 + 1.4) * 0.03
    }

    if (orbitA.current) {
      orbitA.current.rotation.z = elapsed * 0.09
    }
    if (orbitB.current) {
      orbitB.current.rotation.z = -elapsed * 0.06
    }
    if (orbitC.current) {
      orbitC.current.rotation.z = elapsed * 0.045
    }

    if (pulseRing.current && pulseMaterial.current) {
      const progress = (performance.now() - pulseStartedAt.current) / 1200

      if (progress >= 0 && progress < 1) {
        pulseRing.current.visible = true
        pulseRing.current.scale.setScalar(0.5 + progress * 2.4)
        pulseMaterial.current.opacity = 0.5 * (1 - progress)
      } else {
        pulseRing.current.visible = false
      }
    }
  })

  return (
    <group ref={tilt} rotation={[0.16, 0, 0.08]} scale={0.95}>
      <group ref={spin}>
        <lineSegments geometry={edges.shellEdges}>
          <lineBasicMaterial
            color="#7fdcff"
            transparent
            opacity={0.32}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>

        <mesh>
          <icosahedronGeometry args={[SHELL_RADIUS * 0.99, 1]} />
          <meshBasicMaterial
            color="#0a2230"
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        <lineSegments geometry={edges.outerEdges}>
          <lineBasicMaterial color="#4c7f9e" transparent opacity={0.075} depthWrite={false} />
        </lineSegments>

        <mesh ref={nucleus}>
          <icosahedronGeometry args={[0.46, 1]} />
          <meshStandardMaterial
            color="#050f16"
            emissive="#1fc4cf"
            emissiveIntensity={0.34}
            metalness={0.92}
            roughness={0.24}
            flatShading
          />
        </mesh>

        <mesh scale={1.16}>
          <icosahedronGeometry args={[0.46, 1]} />
          <meshBasicMaterial
            color="#9ff6f8"
            wireframe
            transparent
            opacity={0.32}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <mesh scale={0.66}>
          <octahedronGeometry args={[0.5, 0]} />
          <meshBasicMaterial
            color="#8c7bff"
            wireframe
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <sprite scale={[3, 3, 1]}>
          <spriteMaterial
            ref={glow}
            map={glowTexture}
            color="#8ff4f6"
            transparent
            opacity={0.3}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>

        <sprite scale={[5, 5, 1]} position={[0.3, -0.25, -0.8]}>
          <spriteMaterial
            ref={violetGlow}
            map={glowTexture}
            color="#8c7bff"
            transparent
            opacity={0.16}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>

        <mesh ref={pulseRing} position={[0, 0, 0.5]} visible={false}>
          <ringGeometry args={[1, 1.014, 96]} />
          <meshBasicMaterial
            ref={pulseMaterial}
            color="#8ff4f6"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <mesh ref={orbitA} rotation={[Math.PI / 2.15, 0.25, 0]}>
          <torusGeometry args={[1.95, 0.0035, 6, 180]} />
          <meshBasicMaterial
            color="#7fd9ff"
            transparent
            opacity={0.26}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <mesh ref={orbitB} rotation={[Math.PI / 1.7, -0.5, 0.4]}>
          <torusGeometry args={[2.16, 0.003, 6, 180]} />
          <meshBasicMaterial
            color="#8c7bff"
            transparent
            opacity={0.17}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <mesh ref={orbitC} rotation={[Math.PI / 2.5, 0.8, -0.3]}>
          <torusGeometry args={[1.72, 0.003, 6, 160]} />
          <meshBasicMaterial
            color="#a9dcff"
            transparent
            opacity={0.14}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dust, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={0.02}
            sizeAttenuation
            color="#bfe9ff"
            transparent
            opacity={0.5}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>

      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 5, 3]} intensity={2.4} color="#d6efff" />
      <pointLight position={[0, 0, 0]} intensity={6} distance={4.5} decay={2} color="#3fe0e6" />
      <pointLight
        position={[-3, -2, -2.5]}
        intensity={16}
        distance={7}
        decay={2}
        color="#7a5cff"
      />
    </group>
  )
}
