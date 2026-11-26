import { PRIVILEGES, type PrivilegeCode } from '@mes/privileges'

export interface DefaultRole {
  key: 'planner' | 'shiftSupervisor' | 'quality' | 'operator' | 'viewer'
  name: string
  description: string
  permissions: readonly PrivilegeCode[]
}

const READ = PRIVILEGES.map(privilege => privilege.code).filter(code => code.startsWith('read'))

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    key: 'planner',
    name: 'Planner',
    description: 'Plans production, job orders, schedules and product standards',
    permissions: [
      'accessWebApp',
      ...READ,
      'writeProductionPlans',
      'deleteProductionPlans',
      'writeJobOrders',
      'deleteJobOrders',
      'writeSchedules',
      'writeProductStandards',
      'deleteProductStandards',
    ],
  },
  {
    key: 'shiftSupervisor',
    name: 'Shift Supervisor',
    description: 'Runs a shift: job orders, operators, production adjustments and stops',
    permissions: [
      'accessWebApp',
      'accessOperatorPanel',
      ...READ,
      'executeJobOrders',
      'writeOperators',
      'writeProductionAdjustments',
      'createUnplannedStops',
      'writeUnplannedStops',
      'executeUnplannedStops',
      'createPlannedStops',
      'writePlannedStops',
      'executePlannedStops',
      'executePlannedStopTemplates',
    ],
  },
  {
    key: 'quality',
    name: 'Quality',
    description: 'Reviews production and maintains adjustments and reasons',
    permissions: [
      'accessWebApp',
      ...READ,
      'writeProductionAdjustments',
      'deleteProductionAdjustments',
      'createReasons',
      'writeReasons',
    ],
  },
  {
    key: 'operator',
    name: 'Operator',
    description: 'Works at a machine through the operator panel',
    permissions: [
      'accessOperatorPanel',
      'readWorkCenters',
      'readSchedules',
      'readOperators',
      'writeOperators',
      'readCatalog',
      'readProductStandards',
      'readJobOrders',
      'executeJobOrders',
      'readProductionAdjustments',
      'writeProductionAdjustments',
      'readReasons',
      'readPlannedStops',
      'executePlannedStops',
      'readPlannedStopTemplates',
      'executePlannedStopTemplates',
      'readUnplannedStops',
      'createUnplannedStops',
      'writeUnplannedStops',
      'executeUnplannedStops',
      'readTags',
      'readHistorian',
      'readOee',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Reads everything in the web app and changes nothing',
    permissions: ['accessWebApp', ...READ],
  },
]
