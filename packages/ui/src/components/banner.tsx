import { cn } from '@mes/ui/lib/utils'
import type { ReactNode } from 'react'

const tones = {
  info: 'border-accent-line bg-accent-bg text-[#173a8f]',
  warn: 'border-[#e6c46c] bg-state-planned-bg text-[#6b4000]',
  error: 'border-[#efb3aa] bg-state-unplanned-bg text-[#8a1f12]',
  ok: 'border-[#a5d6bc] bg-state-running-bg text-[#124f31]',
}

function Banner({
  tone,
  role,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'ok'
  role?: 'status' | 'alert'
  children: ReactNode
}) {
  return (
    <div
      role={role}
      data-slot='banner'
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border px-3.5 py-2.5 text-[13.5px]',
        tones[tone],
      )}
    >
      {children}
    </div>
  )
}

export { Banner }
