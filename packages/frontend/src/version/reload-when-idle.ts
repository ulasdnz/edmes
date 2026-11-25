export function reloadWhenIdle(options: {
  isBusy: () => boolean
  reload: () => void
  pollMs?: number
}): () => void {
  const timer = setInterval(() => {
    if (options.isBusy()) return
    clearInterval(timer)
    options.reload()
  }, options.pollMs ?? 5000)
  return () => clearInterval(timer)
}
