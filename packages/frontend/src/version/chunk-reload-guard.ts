const MARK = 'mes:chunk-reload'

// The mark is the version that already reloaded once: a later version in the same tab session
// (a tablet stays open through several upgrades) reloads once again, the same version never loops.
export function installChunkReloadGuard(options: {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
  version: string
  target?: EventTarget
}): void {
  const target = options.target ?? window
  target.addEventListener('vite:preloadError', event => {
    try {
      if (options.storage.getItem(MARK) === options.version) return
      options.storage.setItem(MARK, options.version)
    } catch {
      // a mark that cannot be read or written cannot stop a reload loop: do not reload
      return
    }
    // Only when a reload follows: Vite's helper otherwise resolves the import to undefined
    event.preventDefault()
    options.reload()
  })
}
