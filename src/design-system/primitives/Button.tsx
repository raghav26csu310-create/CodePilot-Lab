import type { MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg' | 'iconOnly'

export type ButtonProps = {
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  to?: string
  href?: string
  onClick?: MouseEventHandler<HTMLElement>
  disabled?: boolean
  type?: 'button' | 'submit'
  icon?: ReactNode
  iconRight?: ReactNode
  ariaLabel?: string
  title?: string
  full?: boolean
  className?: string
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  to,
  href,
  onClick,
  disabled = false,
  type = 'button',
  icon,
  iconRight,
  ariaLabel,
  title,
  full = false,
  className,
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], full ? styles.full : null, className]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {iconRight ? (
        <span className={styles.icon} aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} aria-label={ariaLabel} title={title} onClick={onClick}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={classes} aria-label={ariaLabel} title={title} onClick={onClick}>
        {content}
      </a>
    )
  }

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {content}
    </button>
  )
}
