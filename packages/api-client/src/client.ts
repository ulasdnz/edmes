import createFetchClient, { type Client, type Middleware } from 'openapi-fetch'
import createQueryClient, { type OpenapiQueryClient } from 'openapi-react-query'
import { apiErrorFromResponse, toApiError } from './api-error'
import type { paths } from './paths'

export interface ApiClientOptions {
  baseUrl?: string
  getToken: () => string | null
  getLocale: () => string
  onUnauthorized: () => void
  timeoutMs?: number
}

export interface ApiClient {
  fetchClient: Client<paths>
  $api: OpenapiQueryClient<paths>
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl = '/api/v1', getToken, getLocale, onUnauthorized, timeoutMs = 15000 } = options

  const middleware: Middleware = {
    onRequest({ request }) {
      const token = getToken()
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      request.headers.set('Accept-Language', getLocale())
      return request
    },
    async onResponse({ response }) {
      if (response.ok) return undefined
      const error = await apiErrorFromResponse(response)
      if (error.status === 401 && error.code === 'auth.unauthenticated') onUnauthorized()
      throw error
    },
    onError({ error }) {
      return toApiError(error)
    },
  }

  const fetchWithTimeout = (request: Request) =>
    fetch(
      new Request(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
      }),
    )

  const fetchClient = createFetchClient<paths>({ baseUrl, fetch: fetchWithTimeout })
  fetchClient.use(middleware)

  return { fetchClient, $api: createQueryClient(fetchClient) }
}
