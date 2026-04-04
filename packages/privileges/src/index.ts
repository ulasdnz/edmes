export interface Privilege {
  code: string
  text: string
}

export const USER_PRIVILEGES: readonly Privilege[] = Object.freeze([
  { code: 'readUsers', text: 'Read Users' },
  { code: 'writeUsers', text: 'Write Users' },
  { code: 'createUsers', text: 'Create Users' },
  { code: 'deleteUsers', text: 'Delete Users' },
  { code: 'accessUsersScreen', text: 'Access Users Screen' },
  { code: 'readRoles', text: 'Read Roles' },
  { code: 'writeRoles', text: 'Write Roles' },
  { code: 'createRoles', text: 'Create Roles' },
  { code: 'deleteRoles', text: 'Delete Roles' },
  { code: 'accessRolesScreen', text: 'Access Roles Screen' },
  { code: 'readSpecialities', text: 'Read Specialities' },
  { code: 'writeSpecialities', text: 'Write Specialities' },
  { code: 'createSpecialities', text: 'Create Specialities' },
  { code: 'deleteSpecialities', text: 'Delete Specialities' },
  { code: 'accessSpecialitiesScreen', text: 'Access Specialities Screen' },
  { code: 'readPasswordPolicy', text: 'Read Password Policy' },
  { code: 'writePasswordPolicy', text: 'Write Password Policy' },
  { code: 'readDashboards', text: 'Read Dashboards' },
  { code: 'writeDashboards', text: 'Write Dashboards' },
  { code: 'createDashboards', text: 'Create Dashboards' },
  { code: 'deleteDashboards', text: 'Delete Dashboards' },
  { code: 'accessDashboardsScreen', text: 'Access Dashboards Screen' },
  { code: 'writeSystemSettings', text: 'Write System Settings' },
  { code: 'accessSystemSettingsScreen', text: 'Access System Settings Screen' },
  { code: 'accessAuditLogsScreen', text: 'Access Audit Logs Screen' },
  { code: 'readDepartments', text: 'Read Departments' },
  { code: 'writeDepartments', text: 'Write Departments' },
  { code: 'createDepartments', text: 'Create Departments' },
  { code: 'deleteDepartments', text: 'Delete Departments' },
  { code: 'accessDepartmentsScreen', text: 'Access Departments Screen' },
  { code: 'accessWorkCentersScreen', text: 'Access Work Centers Screen' },
])

export const WORK_CENTER_PRIVILEGES: readonly Privilege[] = Object.freeze([
  { code: 'readWorkCenters', text: 'Read Work Centers' },
  { code: 'writeWorkCenters', text: 'Write Work Centers' },
  { code: 'deleteWorkCenters', text: 'Delete Work Centers' },
  { code: 'readSchedules', text: 'Read Schedules' },
  { code: 'writeSchedules', text: 'Write Schedules' },
  { code: 'readOperators', text: 'Read Operators' },
  { code: 'writeOperators', text: 'Write Operators' },
  { code: 'readActionState', text: 'Read Action State' },
])

export const PRODUCTION_PRIVILEGES: readonly Privilege[] = Object.freeze([
  { code: 'readCatalog', text: 'Read Catalog (UoM, Categories, Products)' },
  { code: 'writeCatalog', text: 'Write Catalog (UoM, Categories, Products)' },
  { code: 'deleteCatalog', text: 'Delete Catalog (UoM, Categories, Products)' },
  { code: 'readProductStandards', text: 'Read Product Standards' },
  { code: 'writeProductStandards', text: 'Write Product Standards' },
  { code: 'deleteProductStandards', text: 'Delete Product Standards' },
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
])

export const TELEMETRY_PRIVILEGES: readonly Privilege[] = Object.freeze([
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
])

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...USER_PRIVILEGES,
  ...WORK_CENTER_PRIVILEGES,
  ...PRODUCTION_PRIVILEGES,
  ...TELEMETRY_PRIVILEGES,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
