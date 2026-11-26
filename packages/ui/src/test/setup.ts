import 'vitest-browser-react'
import { afterEach } from 'vitest'
import '../styles/globals.css'

afterEach(() => {
  delete document.documentElement.dataset.density
})
