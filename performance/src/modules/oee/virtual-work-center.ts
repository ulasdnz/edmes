import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import * as workCenterClient from '../../lib/internal-api/work-center.client.js'
import type { AvailabilityResult } from './availability.calc.js'
import type { Diagnostic } from './diagnostics.js'
import type { OeeRange } from './oee.types.js'
import type { ProductivityResult } from './productivity.calc.js'
import type { QualityResult } from './quality.calc.js'

export type FactorStatus = 'ok' | 'no_context' | 'not_calculable'

export type ComposedFactor = {
  status: FactorStatus
  ratio: number
  diagnostics: Diagnostic[]
}

export type VirtualOeeResult = {
  availability: ComposedFactor
  productivity: ComposedFactor
  quality: ComposedFactor
  oee: ComposedFactor
  diagnostics: Diagnostic[]
}

type ContributorResult = {
  workCenterId: string
  availability: AvailabilityResult
  productivity: ProductivityResult
  quality: QualityResult
}

type CompositionRule = 'primary_work_center' | 'average' | 'weighted'

type Contributor = {
  workCenterId: string
  weight: number | null
}

type FactorComposition = {
  rule: CompositionRule
  contributors: Contributor[]
}

function composeFactor(
  rule: CompositionRule,
  contributors: Contributor[],
  results: ContributorResult[],
  getField: (r: ContributorResult) => { status: FactorStatus; ratio: number },
): ComposedFactor {
  if (contributors.length === 0) {
    return { status: 'no_context', ratio: 0, diagnostics: [] }
  }

  const mapped = contributors.map(c => {
    const r = results.find(res => res.workCenterId === c.workCenterId)
    const field = r ? getField(r) : { status: 'not_calculable' as FactorStatus, ratio: 0 }
    return { contributor: c, status: field.status, ratio: field.ratio }
  })

  if (rule === 'primary_work_center') {
    const primary = mapped[0]
    return {
      status: primary.status,
      ratio: primary.ratio,
      diagnostics: [],
    }
  }

  if (rule === 'average') {
    if (mapped.some(m => m.status === 'not_calculable')) {
      return { status: 'not_calculable', ratio: 0, diagnostics: [] }
    }
    const withContext = mapped.filter(m => m.status !== 'no_context')
    if (withContext.length === 0) {
      return { status: 'no_context', ratio: 0, diagnostics: [] }
    }
    const avg = withContext.reduce((sum, m) => sum + m.ratio, 0) / withContext.length
    return { status: 'ok', ratio: avg, diagnostics: [] }
  }

  // weighted
  if (mapped.some(m => m.status === 'not_calculable')) {
    return { status: 'not_calculable', ratio: 0, diagnostics: [] }
  }
  const withContext = mapped.filter(m => m.status !== 'no_context')
  if (withContext.length === 0) {
    return { status: 'no_context', ratio: 0, diagnostics: [] }
  }

  const allWeightsNull = withContext.every(m => m.contributor.weight === null)
  let totalWeight = 0
  let weightedSum = 0
  for (const m of withContext) {
    const w = allWeightsNull ? 1 : (m.contributor.weight ?? 1)
    totalWeight += w
    weightedSum += w * m.ratio
  }
  const ratio = totalWeight > 0 ? weightedSum / totalWeight : 0
  return { status: 'ok', ratio, diagnostics: [] }
}

export async function calculateVirtualOee(
  workCenterId: string,
  range: OeeRange,
  visitedWorkCenterIds: Set<string>,
  calculateOeeForWc: (
    wcId: string,
    range: OeeRange,
    visited: Set<string>,
  ) => Promise<{
    availability: AvailabilityResult
    productivity: ProductivityResult
    quality: QualityResult
  }>,
): Promise<VirtualOeeResult> {
  if (visitedWorkCenterIds.has(workCenterId)) {
    return {
      availability: {
        status: 'not_calculable',
        ratio: 0,
        diagnostics: [{ code: 'virtual_work_center_cycle' as const, severity: 'error' }],
      },
      productivity: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      quality: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      oee: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      diagnostics: [
        {
          code: 'virtual_work_center_cycle' as const,
          severity: 'error',
          context: { workCenterId },
        },
      ],
    }
  }

  const wc = await workCenterClient.getById(workCenterId)
  if (!wc || !wc.metricComposition) {
    return {
      availability: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      productivity: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      quality: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      oee: { status: 'not_calculable', ratio: 0, diagnostics: [] },
      diagnostics: [],
    }
  }

  const composition = wc.metricComposition as {
    availability: FactorComposition
    productivity: FactorComposition
    quality: FactorComposition
  }

  const visited = new Set(visitedWorkCenterIds)
  visited.add(workCenterId)

  const allContributorIds = new Set<string>([
    ...composition.availability.contributors.map(c => String(c.workCenterId)),
    ...composition.productivity.contributors.map(c => String(c.workCenterId)),
    ...composition.quality.contributors.map(c => String(c.workCenterId)),
  ])

  const contributorResults: ContributorResult[] = await Promise.all(
    Array.from(allContributorIds).map(async wcId => {
      const result = await calculateOeeForWc(wcId, range, visited)
      return { workCenterId: wcId, ...result }
    }),
  )

  const toContributors = (fc: FactorComposition): Contributor[] =>
    fc.contributors.map(c => ({ workCenterId: String(c.workCenterId), weight: c.weight ?? null }))

  const availability = composeFactor(
    composition.availability.rule,
    toContributors(composition.availability),
    contributorResults,
    r => ({ status: r.availability.status as FactorStatus, ratio: r.availability.ratio }),
  )

  const productivity = composeFactor(
    composition.productivity.rule,
    toContributors(composition.productivity),
    contributorResults,
    r => ({ status: r.productivity.status as FactorStatus, ratio: r.productivity.ratio }),
  )

  const quality = composeFactor(
    composition.quality.rule,
    toContributors(composition.quality),
    contributorResults,
    r => ({ status: r.quality.status as FactorStatus, ratio: r.quality.ratio }),
  )

  let oeeStatus: FactorStatus
  if (
    availability.status === 'not_calculable' ||
    productivity.status === 'not_calculable' ||
    quality.status === 'not_calculable'
  ) {
    oeeStatus = 'not_calculable'
  } else if (
    availability.status === 'no_context' &&
    productivity.status === 'no_context' &&
    quality.status === 'no_context'
  ) {
    oeeStatus = 'no_context'
  } else {
    oeeStatus = 'ok'
  }

  const oeeRatio = oeeStatus === 'ok' ? availability.ratio * productivity.ratio * quality.ratio : 0

  const cycleDiagnostics: Diagnostic[] = []
  for (const r of contributorResults) {
    const nested = r as unknown as { diagnostics?: Diagnostic[] }
    if (nested.diagnostics) {
      cycleDiagnostics.push(
        ...nested.diagnostics.filter(d => d.code === 'virtual_work_center_cycle'),
      )
    }
  }

  return {
    availability,
    productivity,
    quality,
    oee: { status: oeeStatus, ratio: oeeRatio, diagnostics: [] },
    diagnostics: cycleDiagnostics,
  }
}

export { SYSTEM_IDENTITY }
