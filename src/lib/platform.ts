const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

/** Label for the platform's primary modifier key. */
export const MOD_KEY = isApple ? '⌘' : 'Ctrl'
