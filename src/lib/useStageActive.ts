import { useEffect, useState, type RefObject } from 'react'

/** Tracks whether an element is in the viewport and the tab is visible. */
export function useStageActive(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true)
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) {
          setInView(entry.isIntersecting)
        }
      },
      { threshold: 0.05 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return inView && tabVisible
}
