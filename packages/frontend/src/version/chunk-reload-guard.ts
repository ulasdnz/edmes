const MARK = 'mes:chunk-reload'

export function installChunkReloadGuard(options: {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
  target?: EventTarget
}): void {
  const target = options.target ?? window
  target.addEventListener('vite:preloadError', event => {
    event.preventDefault()
    try {
      if (options.storage.getItem(MARK)) return
      options.storage.setItem(MARK, '1')
    } catch {
      // a mark that cannot be read or written cannot stop a reload loop: do not reload
      return
    }
    options.reload()
  })
}
