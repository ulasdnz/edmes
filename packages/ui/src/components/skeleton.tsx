import { cn } from '@mes/ui/lib/utils'
import type * as React from 'react'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='skeleton'
      className={cn(
        'block h-3 rounded bg-[linear-gradient(90deg,#e4e8ee_25%,#f1f3f7_37%,#e4e8ee_63%)] bg-[length:400%_100%] animate-skeleton motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
