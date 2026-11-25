import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderWithI18n } from '../../test/render'
import { SearchBox, useLastPageCorrection } from './users-page'

function Correction(props: Parameters<typeof useLastPageCorrection>[0]) {
  useLastPageCorrection(props)
  return null
}

// Commits arrive back as the value later, the way the router updates the address.
function SearchWithSlowAddress(props: { onCommit: (value: string | undefined) => void }) {
  const [value, setValue] = useState<string | undefined>()
  return (
    <SearchBox
      value={value}
      onChange={next => {
        props.onCommit(next)
        setTimeout(() => setValue(next), 200)
      }}
    />
  )
}

describe('users page', () => {
  it('moves a page past the last one back without a new history entry', async () => {
    const onSearchChange = vi.fn()
    const screen = await renderWithI18n(
      <Correction page={5} totalPages={3} onSearchChange={onSearchChange} />,
    )
    await vi.waitFor(() => expect(onSearchChange).toHaveBeenCalled())
    expect(onSearchChange).toHaveBeenCalledOnce()
    expect(onSearchChange).toHaveBeenCalledWith({ page: 3 }, { replace: true })
    await screen.rerender(<Correction page={3} totalPages={3} onSearchChange={onSearchChange} />)
    expect(onSearchChange).toHaveBeenCalledOnce()
  })

  it('leaves a page within the list alone', async () => {
    const onSearchChange = vi.fn()
    await renderWithI18n(<Correction page={2} totalPages={3} onSearchChange={onSearchChange} />)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('keeps what is typed while the address catches up with the search', async () => {
    const onCommit = vi.fn()
    const screen = await renderWithI18n(<SearchWithSlowAddress onCommit={onCommit} />)
    const box = screen.getByRole('searchbox', { name: 'Search users' })
    await box.fill('ada')
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith('ada'))
    await userEvent.type(box, ' lovelace')
    await vi.waitFor(() => expect(onCommit).toHaveBeenLastCalledWith('ada lovelace'), {
      timeout: 2000,
    })
    await expect.element(box).toHaveValue('ada lovelace')
  })
})
