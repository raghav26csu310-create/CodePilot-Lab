import styles from './CoreFallback.module.css'

export function CoreFallback({ reason }: { reason: 'reduced-motion' | 'no-webgl' }) {
  return (
    <div className={styles.fallback} aria-hidden="true">
      <svg className={styles.svg} viewBox="0 0 400 400" fill="none" role="presentation">
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#57e2e6" stopOpacity="0.32" />
            <stop offset="55%" stopColor="#2b7f92" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#04060b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="core-edge" x1="136" y1="126" x2="264" y2="274">
            <stop stopColor="#a9dcff" stopOpacity="0.65" />
            <stop offset="1" stopColor="#57e2e6" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        <circle cx="200" cy="200" r="150" fill="url(#core-glow)" />
        <circle cx="200" cy="200" r="181" stroke="rgb(150 180 220 / 0.08)" />
        <circle
          cx="200"
          cy="200"
          r="152"
          stroke="rgb(150 180 220 / 0.12)"
          strokeDasharray="1 7"
        />
        <circle cx="200" cy="200" r="114" stroke="rgb(87 226 230 / 0.14)" />
        <ellipse
          cx="200"
          cy="200"
          rx="172"
          ry="58"
          stroke="rgb(140 123 255 / 0.17)"
          transform="rotate(-24 200 200)"
        />
        <ellipse
          cx="200"
          cy="200"
          rx="148"
          ry="46"
          stroke="rgb(87 226 230 / 0.13)"
          transform="rotate(34 200 200)"
        />

        <path
          d="M200 126 264 163v74l-64 37-64-37v-74Z"
          stroke="url(#core-edge)"
          strokeWidth="1.2"
        />
        <path
          d="M200 148 245 174v52l-45 26-45-26v-52Z"
          stroke="rgb(169 220 255 / 0.24)"
          strokeWidth="1"
        />
        <path
          d="m181 181 24 19-24 19"
          stroke="#57e2e6"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M214 219h18" stroke="#57e2e6" strokeWidth="2.6" strokeLinecap="round" opacity="0.75" />

        <circle cx="200" cy="126" r="2.4" fill="#a9dcff" opacity="0.9" />
        <circle cx="264" cy="163" r="2" fill="#57e2e6" opacity="0.7" />
        <circle cx="264" cy="237" r="2" fill="#57e2e6" opacity="0.45" />
        <circle cx="200" cy="274" r="2.4" fill="#a9dcff" opacity="0.75" />
        <circle cx="136" cy="237" r="2" fill="#57e2e6" opacity="0.45" />
        <circle cx="136" cy="163" r="2" fill="#57e2e6" opacity="0.7" />
        <circle cx="200" cy="200" r="3.5" fill="#8ff4f6" opacity="0.16" />
      </svg>

      <span className={styles.caption}>
        {reason === 'reduced-motion' ? 'Static render · reduced motion' : 'Static render · WebGL unavailable'}
      </span>
    </div>
  )
}
