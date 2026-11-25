export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted'

export interface ApiErrorInit {
  kind: ApiErrorKind
  status?: number
  code: string
  message?: string
  details?: ReadonlyArray<{ field: string; message: string }>
  traceId?: string
  cause?: unknown
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code: string
  readonly details?: ReadonlyArray<{ field: string; message: string }>
  readonly traceId?: string

  constructor(init: ApiErrorInit) {
    super(init.message ?? init.code, { cause: init.cause })
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status ?? 0
    this.code = init.code
    this.details = init.details
    this.traceId = init.traceId
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isAbortError(error)) {
    return new ApiError({ kind: 'aborted', code: 'client.aborted', cause: error })
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new ApiError({ kind: 'timeout', code: 'client.timeout', cause: error })
  }
  return new ApiError({ kind: 'network', code: 'client.network', cause: error })
}

function isDetails(value: unknown): value is ApiError['details'] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.field === 'string' &&
        typeof item.message === 'string',
    )
  )
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const traceId = response.headers.get('x-trace-id') ?? undefined
  const body: unknown = await response.json().catch(() => undefined)
  const envelope =
    typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
  if (
    typeof envelope === 'object' &&
    envelope !== null &&
    'code' in envelope &&
    typeof envelope.code === 'string'
  ) {
    return new ApiError({
      kind: 'http',
      status: response.status,
      code: envelope.code,
      message:
        'message' in envelope && typeof envelope.message === 'string'
          ? envelope.message
          : undefined,
      details: 'details' in envelope && isDetails(envelope.details) ? envelope.details : undefined,
      traceId,
    })
  }
  return new ApiError({
    kind: 'http',
    status: response.status,
    code: 'client.unexpected_response',
    traceId,
  })
}
