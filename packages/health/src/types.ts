export type ServiceStatus = 'healthy' | 'unhealthy'

export interface ServiceCheck {
  status: ServiceStatus
  message?: string
}

export interface HealthResponse {
  status: ServiceStatus
  timestamp: string
  uptime: number
  memory: {
    rss: number
    heapUsed: number
  }
  services: Record<string, ServiceStatus>
}

export interface ReadinessResponse {
  ready: boolean
}

export interface LivenessResponse {
  alive: boolean
}

export interface HealthProbe {
  name: string
  check: () => Promise<void>
}

export interface HealthConfig {
  probes: HealthProbe[]
  logger: { warn: (msg: string, meta?: Record<string, unknown>) => void }
}
