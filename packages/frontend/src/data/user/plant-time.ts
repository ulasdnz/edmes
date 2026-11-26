import type { ApiClient, paths } from '@mes/api-client'
import { queryOptions } from '@tanstack/react-query'
import { createServerClock, type ServerClock } from '../../time'

type PlantTimeResponse =
  paths['/auth/plant-time']['get']['responses'][200]['content']['application/json']

export interface PlantTime {
  plantTimezone: PlantTimeResponse['data']['plantTimezone']
  clock: ServerClock
}

// Public, read once before sign-in. The clock is built when the answer arrives, so a page that
// shows it later still reads the server's time, not the moment the answer was rendered.
export function plantTimeOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ['get', '/auth/plant-time'] as const,
    queryFn: async ({ signal }): Promise<PlantTime> => {
      const { data } = await api.fetchClient.GET('/auth/plant-time', { signal })
      if (!data) throw new Error('the plant time answered no body')
      return {
        plantTimezone: data.data.plantTimezone,
        clock: createServerClock(data.data.serverTime),
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
