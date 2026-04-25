export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export type DiagnosticCode =
  | 'no_job_order_in_range'
  | 'overlapping_stop_records_clipped'
  | 'converted_unplanned_missing_link'
  | 'no_production_total'
  | 'scrap_exceeds_total'
  | 'unknown_scrap_reason_treated_as_oee_affecting'

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
