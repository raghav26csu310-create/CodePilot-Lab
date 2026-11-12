import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, MoreHorizontal } from 'lucide-react'

import styles from './EditorMoreMenu.module.css'

export type EditorMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  /** Renders a checked state; omit for plain actions. */
  checked?: boolean
  disabled?: boolean
  onSelect: () => void
}

type MenuPosition = {
  left: number
  top: number
  maxHeight: number
}

type EditorMoreMenuProps = {
  items: EditorMenuItem[]
  /** Trigger styling comes from the toolbar so the control matches its neighbours. */
  triggerClassName?: string
  labelClassName?: string
  label?: string
}

const MENU_WIDTH = 248

/**
 * Overflow menu for the editor action bar. Non-modal: Escape and outside
 * clicks close it, arrow keys move between actions, and the menu repositions
 * with the trigger instead of closing when an ancestor scrolls.
 */
export function EditorMoreMenu({
  items,
  triggerClassName,
  labelClassName,
  label = 'More editor actions',
}: EditorMoreMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const measure = useCallback(() => {
    const button = buttonRef.current
    if (!button) {
      return
    }

    const rect = button.getBoundingClientRect()
    const padding = 12
    const spaceBelow = window.innerHeight - rect.bottom - padding
    const spaceAbove = rect.top - padding
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.min(360, Math.max(160, placeAbove ? spaceAbove : spaceBelow))

    setPosition({
      left: Math.min(
        Math.max(padding, rect.right - MENU_WIDTH),
        window.innerWidth - MENU_WIDTH - padding,
      ),
      top: placeAbove
        ? Math.max(padding, rect.top - Math.min(maxHeight, 360) - 6)
        : rect.bottom + 6,
      maxHeight,
    })
  }, [])

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) {
      buttonRef.current?.focus()
    }
  }, [])

  const openMenu = useCallback(() => {
    measure()
    setActiveIndex(Math.max(0, items.findIndex((item) => !item.disabled)))
    setOpen(true)
  }, [items, measure])

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

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', measure)
    }
  }, [close, measure, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')
        ?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const focusItem = (index: number) => {
    setActiveIndex(index)
    menuRef.current?.querySelector<HTMLButtonElement>(`[data-menu-index="${index}"]`)?.focus()
  }

  const move = (direction: 1 | -1) => {
    const total = items.length
    let next = activeIndex
    for (let step = 0; step < total; step += 1) {
      next = (next + direction + total) % total
      if (!items[next]?.disabled) {
        break
      }
    }
    focusItem(next)
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      // ARIA menu pattern: Tab closes the menu and moves focus to the next
      // (or previous) control in the page's tab sequence. Trapping focus on
      // the trigger instead would be a keyboard trap.
      event.preventDefault()
      const trigger = buttonRef.current
      const tabbable = trigger
        ? Array.from(
            document.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter(
            (element) =>
              element.offsetParent !== null &&
              element.getAttribute('aria-hidden') !== 'true' &&
              !menuRef.current?.contains(element),
          )
        : []
      const index = trigger ? tabbable.indexOf(trigger) : -1
      const next = index >= 0 ? tabbable[index + (event.shiftKey ? -1 : 1)] : undefined
      close(false)
      next?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const start = event.key === 'Home' ? 0 : items.length - 1
      const direction = event.key === 'Home' ? 1 : -1
      let next = start
      for (let step = 0; step < items.length; step += 1) {
        if (!items[next]?.disabled) {
          break
        }
        next = (next + direction + items.length) % items.length
      }
      focusItem(next)
    }
  }

  const menu = open && position
    ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label={label}
          style={{ left: position.left, top: position.top, width: MENU_WIDTH, maxHeight: position.maxHeight }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              data-menu-index={index}
              data-active={index === activeIndex}
              className={styles.item}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => {
                if (item.disabled) {
                  return
                }
                item.onSelect()
                close(true)
              }}
            >
              <span className={styles.itemIcon}>{item.icon}</span>
              <span className={styles.itemLabel}>{item.label}</span>
              {item.shortcut ? <span className={styles.shortcut}>{item.shortcut}</span> : null}
              {item.checked ? <Check size={12} aria-hidden="true" className={styles.check} /> : null}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-active={open}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) {
              openMenu()
            }
          }
        }}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
        <span className={labelClassName}>More</span>
      </button>
      {menu}
    </div>
  )
}
