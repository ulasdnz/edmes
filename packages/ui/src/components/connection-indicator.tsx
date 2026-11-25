import { cn } from '@mes/ui/lib/utils'

const tones = {
  live: 'bg-state-running-bg text-state-running-fg before:size-2 before:rounded-full before:bg-state-running',
  reconnecting:
    'bg-state-planned-bg text-state-planned-fg before:size-2.5 before:rounded-full before:border-2 before:border-current before:border-r-transparent',
  offline:
    'bg-state-unplanned-bg text-state-unplanned-fg before:size-2.5 before:bg-[linear-gradient(45deg,transparent_41%,currentColor_41%_59%,transparent_59%),linear-gradient(-45deg,transparent_41%,currentColor_41%_59%,transparent_59%)]',
}

function ConnectionIndicator({
  status,
  label,
}: {
  status: 'live' | 'reconnecting' | 'offline'
  label: string
}) {
  return (
    <output
      data-slot='connection-indicator'
      data-status={status}
      className={cn(
        "inline-flex h-7 items-center gap-[7px] rounded-[14px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap before:flex-none before:content-['']",
        tones[status],
      )}
    >
      {label}
    </output>
  )
}

export { ConnectionIndicator }
