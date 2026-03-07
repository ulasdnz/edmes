/**
 * Shared shutdown state module.
 * Health endpoints check this flag to return 503 during graceful shutdown,
 * signaling load balancers to stop sending new traffic.
 */
export let isShuttingDown = false

export function setShuttingDown(): void {
  isShuttingDown = true
}
