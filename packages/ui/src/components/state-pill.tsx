import { cn } from '@mes/ui/lib/utils'
import type { ReactNode } from 'react'

const states = {
  running: {
    shape: 'play',
    className:
      'bg-state-running-bg text-state-running-fg before:[clip-path:polygon(10%_0,100%_50%,10%_100%)]',
  },
  unplanned: {
    shape: 'octagon',
    className:
      'bg-state-unplanned-bg text-state-unplanned-fg before:[clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)]',
  },
  planned: {
    shape: 'pause',
    className:
      'bg-state-planned-bg text-state-planned-fg before:bg-[linear-gradient(90deg,currentColor_0_35%,transparent_35%_65%,currentColor_65%)]',
  },
  idle: {
    shape: 'ring',
    className:
      'bg-state-idle-bg text-state-idle-fg before:rounded-full before:border-2 before:border-current before:bg-transparent',
  },
} as const

function StatePill({
  state,
  children,
}: {
  state: 'running' | 'unplanned' | 'planned' | 'idle'
  children: ReactNode
}) {
  const { shape, className } = states[state]
  return (
    <span
      data-slot='state-pill'
      data-shape={shape}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-xl pr-[9px] pl-2 text-[12.5px] font-semibold whitespace-nowrap before:size-2.5 before:flex-none before:bg-current before:content-['']",
        className,
      )}
    >
      {children}
    </span>
  )
}

export { StatePill }
