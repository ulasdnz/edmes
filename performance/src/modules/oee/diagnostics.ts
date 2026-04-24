export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export type DiagnosticCode =
  | 'no_job_order_in_range'
  | 'overlapping_stop_records_clipped'
  | 'converted_unplanned_missing_link'

export type Diagnostic = {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  context?: Record<string, unknown>
}

export function diag(
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  context?: Record<string, unknown>,
): Diagnostic {
  return context ? { code, severity, context } : { code, severity }
}
