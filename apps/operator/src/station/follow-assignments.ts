import type { AppCore } from '@mes/frontend/core'
import {
  type WorkCenter,
  workCentersListOptions,
} from '@mes/frontend/data/work-center/work-centers'
import type { StationStore } from './station-store'

// The session holds no work centers, so a change to the user's assignments arrives only as the
// user's own `user.updated`. The visible work centers are read again, and a station no longer
// visible is cleared; the screens observing that query follow.
export function followAssignments(
  core: Pick<AppCore, 'api' | 'session' | 'queryClient' | 'realtime'>,
  station: StationStore,
): () => void {
  const { queryClient } = core
  const options = workCentersListOptions(core.api, { status: 'active' })
  const reconcile = (list: { data: readonly WorkCenter[] }) => {
    station.reconcile(list.data.map(workCenter => workCenter._id))
  }

  async function reread() {
    const query = queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true })
    if (!query?.isActive()) {
      // No screen shows the list: one read. After a failure it is marked stale, so the next
      // screen that shows it reads it again.
      await queryClient.fetchQuery({ ...options, staleTime: 0 }).then(reconcile, () =>
        queryClient.invalidateQueries({
          queryKey: options.queryKey,
          exact: true,
          refetchType: 'none',
        }),
      )
      return
    }
    // A screen shows the list: refetch it with the screen's own options, so a server that does
    // not answer is asked again until it does.
    const asked = Date.now()
    await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true })
    const state = queryClient.getQueryState<{ data: WorkCenter[] }>(options.queryKey)
    if (state?.status === 'success' && state.data && state.dataUpdatedAt >= asked) {
      reconcile(state.data)
    }
  }

  return core.realtime.on('user.updated', payload => {
    const userId = core.session.getState().user?._id
    if (userId === undefined || payload.userId !== userId) return
    void reread()
  })
}
