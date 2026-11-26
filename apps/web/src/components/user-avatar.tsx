import { cn } from '@mes/ui/lib/utils'
import type { ReactNode } from 'react'

export function initials(name: string, surname: string): string {
  return `${name.charAt(0)}${surname.charAt(0)}`.toLocaleUpperCase()
}

// The photo when there is one, the initials otherwise; the caller sets the size. Without alt the
// avatar is decoration beside the name it shows.
export function UserAvatar(props: {
  name: string
  surname: string
  photoUrl?: string | null
  alt?: string
  className?: string
}): ReactNode {
  const shape = 'shrink-0 rounded-full shadow-[0_0_0_2px_var(--color-surface)]'
  if (props.photoUrl) {
    return (
      <img
        src={props.photoUrl}
        alt={props.alt ?? ''}
        className={cn(shape, 'bg-avatar object-cover', props.className)}
      />
    )
  }
  return (
    <span
      aria-hidden='true'
      className={cn(
        shape,
        'inline-flex items-center justify-center bg-avatar font-semibold text-avatar-text',
        props.className,
      )}
    >
      {initials(props.name, props.surname)}
    </span>
  )
}
