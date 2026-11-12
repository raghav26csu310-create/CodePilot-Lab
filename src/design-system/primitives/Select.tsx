import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

import styles from './Select.module.css'

export type SelectOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type SelectProps = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  id?: string
  placeholder?: string
  disabled?: boolean
  /** Compact height for dense toolbars. */
  compact?: boolean
  className?: string
  title?: string
}

type MenuPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * Accessible custom dropdown used everywhere a native <select> would be
 * unreliable. The menu is portalled with fixed positioning so it is never
 * clipped by an overflow container, and it is fully keyboard operable
 * (Arrow keys, Home/End, Enter/Space, Escape). Option contrast is explicit
 * rather than inherited from the browser.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  placeholder = 'Select…',
  disabled = false,
  compact = false,
  className,
  title,
}: SelectProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  )
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const measure = useCallback(() => {
    const button = buttonRef.current
    if (!button) {
      return
    }
    const rect = button.getBoundingClientRect()
    const viewportPadding = 12
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const spaceAbove = rect.top - viewportPadding
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow
    const maxHeight = Math.min(340, Math.max(140, placeAbove ? spaceAbove : spaceBelow))

    setPosition({
      left: Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - rect.width - viewportPadding),
      top: placeAbove ? Math.max(viewportPadding, rect.top - Math.min(maxHeight, 340) - 6) : rect.bottom + 6,
      width: Math.max(rect.width, 220),
      maxHeight,
    })
  }, [])

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) {
      buttonRef.current?.focus()
    }
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) {
      return
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    measure()
    setOpen(true)
  }, [disabled, measure, selectedIndex])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) {
        return
      }
      onChange(option.value)
      close()
    },
    [close, onChange, options],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (buttonRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return
      }
      close(false)
    }

    /**
     * Scrolling the menu itself is normal use — the list is the scroll
     * container, and closing on its own scroll made long option lists
     * unusable. Scrolling an ancestor moves the trigger, so the menu is
     * repositioned to follow it instead of being dismissed. Only when the
     * trigger leaves the viewport does the menu close.
     */
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return
      }

      const button = buttonRef.current
      if (!button) {
        return
      }

      const rect = button.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        close(false)
        return
      }

      measure()
    }

    const onResize = () => measure()

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [close, measure, open])

  useEffect(() => {
    if (!open) {
      return
    }

    // Keyboard navigation must keep the active option inside the list's
    // scroll viewport without moving the page.
    menuRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return
    }

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      let next = activeIndex
      for (let step = 0; step < options.length; step += 1) {
        next = (next + direction + options.length) % options.length
        if (!options[next]?.disabled) {
          break
        }
      }
      setActiveIndex(next)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const start = event.key === 'Home' ? 0 : options.length - 1
      const direction = event.key === 'Home' ? 1 : -1
      let next = start
      for (let step = 0; step < options.length; step += 1) {
        if (!options[next]?.disabled) {
          break
        }
        next = (next + direction + options.length) % options.length
      }
      setActiveIndex(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commit(activeIndex)
    }
  }

  const menu = open && position
    ? createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          <div className={styles.menuHead}>
            <span>{ariaLabel}</span>
            <span className={styles.menuCount}>{options.length} options</span>
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={styles.list}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === activeIndex
              return (
                <li key={option.value} role="none">
                  <button
                    type="button"
                    role="option"
                    id={`${listboxId}-option-${index}`}
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    disabled={option.disabled}
                    data-active={isActive}
                    data-selected={isSelected}
                    className={styles.option}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                  >
                    <span className={styles.optionBody}>
                      <span className={styles.optionLabel}>{option.label}</span>
                      {option.description ? (
                        <span className={styles.optionDescription}>{option.description}</span>
                      ) : null}
                    </span>
                    {isSelected ? <Check size={13} aria-hidden="true" className={styles.check} /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>,
        document.body,
      )
    : null
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={styles.trigger}
        data-open={open}
        data-compact={compact}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={styles.value} data-placeholder={!selected}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} aria-hidden="true" className={styles.chevron} data-open={open} />
      </button>
      {menu}
    </div>
  )
}
