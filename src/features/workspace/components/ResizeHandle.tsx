import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import styles from './ResizeHandle.module.css'

type ResizeHandleProps = {
  /** Orientation of the separator line itself. */
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  min: number
  max: number
  /** Horizontal separators grow when the pointer moves up. */
  invert?: boolean
  onChange: (value: number) => void
  onReset: () => void
}

export function ResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  invert = false,
  onChange,
  onReset,
}: ResizeHandleProps) {
  const drag = useRef<{ start: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) {
      return
    }

    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
  }, [dragging, orientation])

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      start: orientation === 'vertical' ? event.clientX : event.clientY,
      value,
    }
    setDragging(true)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) {
      return
    }

    const pointer = orientation === 'vertical' ? event.clientX : event.clientY
    const direction = invert ? -1 : 1
    onChange(current.value + (pointer - current.start) * direction)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return
    }

    drag.current = null
    setDragging(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const increase = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    const step = event.shiftKey ? 64 : 16

    if (event.key === decrease) {
      event.preventDefault()
      onChange(value + (invert ? step : -step))
      return
    }

    if (event.key === increase) {
      event.preventDefault()
      onChange(value + (invert ? -step : step))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      onChange(min)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      onChange(max)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      className={styles.handle}
      data-orientation={orientation}
      data-dragging={dragging}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · drag or use arrow keys · Enter resets`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className={styles.line} aria-hidden="true" />
    </div>
  )
}
