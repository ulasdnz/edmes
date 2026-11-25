import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '@mes/ui/lib/utils'
import type * as React from 'react'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot='input'
      className={cn(
        'h-(--control-h) w-full min-w-0 rounded-control border border-border bg-surface px-2.5 text-sm leading-[1.3] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-[#eef1f5] disabled:text-text-2 aria-invalid:border-state-unplanned aria-invalid:shadow-[0_0_0_3px_var(--color-state-unplanned-bg)]',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
