export interface AuthMiddlewareConfig {
  jwtSecret: string
  /**
   * Internal URL to User service. Defaults to http://localhost:3000
   * Used as fallback when Redis cache misses.
   */
  userServiceInternalUrl: string
  
  /**
   * Cache wrapper to be injected by the consuming service.
   * Format matches @mes/cache -> cacheWrapDedup
   */
  cacheWrapDedup: <T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>
}

let _config: AuthMiddlewareConfig | null = null

export const configureAuth = (cfg: AuthMiddlewareConfig) => {
  _config = cfg
}

export const getAuthConfig = (): AuthMiddlewareConfig => {
  if (!_config) {
    throw new Error('[@mes/auth] Auth middleware used before initialization. Call configureAuth() first.')
  }
  return _config
}
