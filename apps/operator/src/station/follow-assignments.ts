import type { AppCore } from '@mes/frontend/core'
import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import type { StationStore } from './station-store'

// The session holds no work centers, so a change to the user's assignments arrives only as the
// user's own `user.updated`. The visible work centers are read again; the screens observing that
// query follow, and a station no longer visible is cleared.
export function followAssignments(
  core: Pick<AppCore, 'api' | 'session' | 'queryClient' | 'realtime'>,
  station: StationStore,
): () => void {
  return core.realtime.on('user.updated', payload => {
    const userId = core.session.getState().user?._id
    if (userId === undefined || payload.userId !== userId) return
    core.queryClient
      .fetchQuery({ ...workCentersListOptions(core.api, { status: 'active' }), staleTime: 0 })
      .then(
        list => {
          station.reconcile(list.data.map(workCenter => workCenter._id))
        },
        () => {
          // unanswered: the screens' own recovery asks again
        },
      )
  })
}
