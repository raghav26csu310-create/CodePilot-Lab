/**
 * Placement maths for the portalled `Select` menu.
 *
 * The menu is fixed-positioned, so a naive "open below the trigger" places it
 * outside the viewport on short windows and inside the on-screen keyboard area
 * on mobile. This module is pure so the edge cases (flip above, clamp to the
 * viewport, tiny windows) can be unit tested without a browser.
 */

export type AnchorRect = {
  left: number
  top: number
  bottom: number
  width: number
}

export type Viewport = {
  width: number
  height: number
}

export type MenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
  /** True when the menu had to open above the trigger. */
  above: boolean
}

export type PlacementOptions = {
  padding?: number
  gap?: number
  minWidth?: number
  preferredHeight?: number
  /** Below this much space the menu flips above when the space above is larger. */
  flipThreshold?: number
  minHeight?: number
}

const DEFAULTS = {
  padding: 12,
  gap: 6,
  minWidth: 220,
  preferredHeight: 340,
  flipThreshold: 180,
  minHeight: 112,
} as const

export function placeMenu(
  anchor: AnchorRect,
  viewport: Viewport,
  options: PlacementOptions = {},
): MenuPlacement {
  const padding = options.padding ?? DEFAULTS.padding
  const gap = options.gap ?? DEFAULTS.gap
  const minWidth = options.minWidth ?? DEFAULTS.minWidth
  const preferredHeight = options.preferredHeight ?? DEFAULTS.preferredHeight
  const flipThreshold = options.flipThreshold ?? DEFAULTS.flipThreshold
  const minHeight = options.minHeight ?? DEFAULTS.minHeight

  const usableWidth = Math.max(0, viewport.width - padding * 2)
  const width = Math.min(Math.max(anchor.width, minWidth), usableWidth)
  const left = clamp(anchor.left, padding, Math.max(padding, viewport.width - width - padding))

  const spaceBelow = viewport.height - anchor.bottom - gap - padding
  const spaceAbove = anchor.top - gap - padding
  const above = spaceBelow < flipThreshold && spaceAbove > spaceBelow
  const available = Math.max(above ? spaceAbove : spaceBelow, 0)

  // Never exceed the viewport, even when both sides are cramped: the list
  // scrolls inside whatever height is left instead of being pushed off screen.
  const height = Math.min(
    preferredHeight,
    Math.max(minHeight, Math.min(available, viewport.height - padding * 2)),
  )

  const rawTop = above ? anchor.top - gap - height : anchor.bottom + gap
  const top = clamp(rawTop, padding, Math.max(padding, viewport.height - padding - height))

  return { left, top, width, maxHeight: height, above }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
