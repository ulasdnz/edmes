export interface Privilege {
  code: string
  text: string
}

export const APPLICATION_PRIVILEGES = Object.freeze([
  { code: 'accessWebApp', text: 'Access Web App' },
  { code: 'accessOperatorPanel', text: 'Access Operator Panel' },
] as const satisfies readonly Privilege[])

export const USER_PRIVILEGES = Object.freeze([
  { code: 'readUsers', text: 'Read Users' },
  { code: 'writeUsers', text: 'Write Users' },
  { code: 'createUsers', text: 'Create Users' },
  { code: 'deleteUsers', text: 'Delete Users' },
  { code: 'readRoles', text: 'Read Roles' },
  { code: 'writeRoles', text: 'Write Roles' },
  { code: 'createRoles', text: 'Create Roles' },
  { code: 'deleteRoles', text: 'Delete Roles' },
  { code: 'readSpecialities', text: 'Read Specialities' },
  { code: 'writeSpecialities', text: 'Write Specialities' },
  { code: 'createSpecialities', text: 'Create Specialities' },
  { code: 'deleteSpecialities', text: 'Delete Specialities' },
  { code: 'readPasswordPolicy', text: 'Read Password Policy' },
  { code: 'writePasswordPolicy', text: 'Write Password Policy' },
  { code: 'readDashboards', text: 'Read Dashboards' },
  { code: 'writeDashboards', text: 'Write Dashboards' },
  { code: 'createDashboards', text: 'Create Dashboards' },
  { code: 'deleteDashboards', text: 'Delete Dashboards' },
  { code: 'writeSystemSettings', text: 'Write System Settings' },
  { code: 'readDepartments', text: 'Read Departments' },
  { code: 'writeDepartments', text: 'Write Departments' },
  { code: 'createDepartments', text: 'Create Departments' },
  { code: 'deleteDepartments', text: 'Delete Departments' },
] as const satisfies readonly Privilege[])

export const WORK_CENTER_PRIVILEGES = Object.freeze([
  { code: 'readWorkCenters', text: 'Read Work Centers' },
  { code: 'writeWorkCenters', text: 'Write Work Centers' },
  { code: 'deleteWorkCenters', text: 'Delete Work Centers' },
  { code: 'readSchedules', text: 'Read Schedules' },
  { code: 'writeSchedules', text: 'Write Schedules' },
  { code: 'readOperators', text: 'Read Operators' },
  { code: 'writeOperators', text: 'Write Operators' },
] as const satisfies readonly Privilege[])

export const PRODUCTION_PRIVILEGES = Object.freeze([
  { code: 'readCatalog', text: 'Read Catalog (UoM, Categories, Products)' },
  { code: 'writeCatalog', text: 'Write Catalog (UoM, Categories, Products)' },
  { code: 'deleteCatalog', text: 'Delete Catalog (UoM, Categories, Products)' },
  { code: 'readProductStandards', text: 'Read Product Standards' },
  { code: 'writeProductStandards', text: 'Write Product Standards' },
  { code: 'deleteProductStandards', text: 'Delete Product Standards' },
  { code: 'backdateProductStandards', text: 'Backdate Product Standards' },
  { code: 'readProductionPlans', text: 'Read Production Plans' },
  { code: 'writeProductionPlans', text: 'Write Production Plans' },
  { code: 'deleteProductionPlans', text: 'Delete Production Plans' },
  { code: 'readJobOrders', text: 'Read Job Orders' },
  { code: 'writeJobOrders', text: 'Write Job Orders' },
  { code: 'deleteJobOrders', text: 'Delete Job Orders' },
  { code: 'executeJobOrders', text: 'Execute Job Orders (Start/End)' },
  {
    code: 'readProductionAdjustments',
    text: 'Read Production Adjustments (Quantity/Scrap)',
  },
  {
    code: 'writeProductionAdjustments',
    text: 'Write Production Adjustments (Quantity/Scrap)',
  },
  {
    code: 'deleteProductionAdjustments',
    text: 'Delete Production Adjustments (Quantity/Scrap)',
  },
] as const satisfies readonly Privilege[])

export const TELEMETRY_PRIVILEGES = Object.freeze([
  { code: 'readTagTypes', text: 'Read Tag Types' },
  { code: 'createTagTypes', text: 'Create Tag Types' },
  { code: 'writeTagTypes', text: 'Write Tag Types' },
  { code: 'deleteTagTypes', text: 'Delete Tag Types' },
  { code: 'readEdgeDevices', text: 'Read Edge Devices' },
  { code: 'createEdgeDevices', text: 'Create Edge Devices' },
  { code: 'writeEdgeDevices', text: 'Write Edge Devices' },
  { code: 'deleteEdgeDevices', text: 'Delete Edge Devices' },
  { code: 'readTags', text: 'Read Tags' },
  { code: 'createTags', text: 'Create Tags' },
  { code: 'writeTags', text: 'Write Tags' },
  { code: 'deleteTags', text: 'Delete Tags' },
  { code: 'readHistorian', text: 'Read Historian Data' },
  { code: 'writeTagValues', text: 'Write Tag Values' },
  { code: 'sendTagCommands', text: 'Send Tag Commands' },
  { code: 'readDiscovery', text: 'Read Discovery Data' },
] as const satisfies readonly Privilege[])

export const PERFORMANCE_PRIVILEGES = Object.freeze([
  { code: 'readOee', text: 'Read OEE' },
  { code: 'readReasons', text: 'Read Reasons' },
  { code: 'writeReasons', text: 'Write Reasons' },
  { code: 'createReasons', text: 'Create Reasons' },
  { code: 'deleteReasons', text: 'Delete Reasons' },
  { code: 'readPlannedStops', text: 'Read Planned Stops' },
  { code: 'writePlannedStops', text: 'Write Planned Stops' },
  { code: 'createPlannedStops', text: 'Create Planned Stops' },
  { code: 'deletePlannedStops', text: 'Delete Planned Stops' },
  { code: 'executePlannedStops', text: 'Execute Planned Stops' },
  { code: 'readPlannedStopTemplates', text: 'Read Planned Stop Templates' },
  { code: 'writePlannedStopTemplates', text: 'Write Planned Stop Templates' },
  { code: 'createPlannedStopTemplates', text: 'Create Planned Stop Templates' },
  { code: 'deletePlannedStopTemplates', text: 'Delete Planned Stop Templates' },
  { code: 'executePlannedStopTemplates', text: 'Execute Planned Stop Templates' },
  { code: 'readPlannedStopSchedules', text: 'Read Planned Stop Schedules' },
  { code: 'writePlannedStopSchedules', text: 'Write Planned Stop Schedules' },
  { code: 'createPlannedStopSchedules', text: 'Create Planned Stop Schedules' },
  { code: 'deletePlannedStopSchedules', text: 'Delete Planned Stop Schedules' },
  { code: 'readUnplannedStops', text: 'Read Unplanned Stops' },
  { code: 'writeUnplannedStops', text: 'Write Unplanned Stops' },
  { code: 'createUnplannedStops', text: 'Create Unplanned Stops' },
  { code: 'deleteUnplannedStops', text: 'Delete Unplanned Stops' },
  { code: 'executeUnplannedStops', text: 'Execute Unplanned Stops' },
  { code: 'closeUnplannedStops', text: 'Close Unplanned Stops' },
  { code: 'convertUnplannedStops', text: 'Convert Unplanned Stops (to Planned)' },
  { code: 'readPerformancePolicy', text: 'Read Performance Policy' },
  { code: 'writePerformancePolicy', text: 'Write Performance Policy' },
] as const satisfies readonly Privilege[])

export const PRIVILEGES = Object.freeze([
  ...APPLICATION_PRIVILEGES,
  ...USER_PRIVILEGES,
  ...WORK_CENTER_PRIVILEGES,
  ...PRODUCTION_PRIVILEGES,
  ...TELEMETRY_PRIVILEGES,
  ...PERFORMANCE_PRIVILEGES,
] as const satisfies readonly Privilege[])

export type PrivilegeCode = (typeof PRIVILEGES)[number]['code']

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
