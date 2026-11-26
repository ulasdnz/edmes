import { cn } from '@mes/ui/lib/utils'
import type * as React from 'react'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the caller passes htmlFor or nests the control
    <label
      data-slot='label'
      className={cn(
        'text-[12.5px] leading-[1.45] font-semibold text-text-2 select-none',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
