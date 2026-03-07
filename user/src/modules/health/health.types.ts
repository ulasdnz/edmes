export interface HealthResponse {
  status: 'healthy' | 'unhealthy'
  timestamp: string
  uptime: number
  memory: {
    rss: number
    heapUsed: number
  }
  services: {
    mongodb: 'healthy' | 'unhealthy'
    redis: 'healthy' | 'unhealthy'
  }
}

export interface ReadinessResponse {
  ready: boolean
}

export interface LivenessResponse {
  alive: boolean
}
