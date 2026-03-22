export interface Privilege {
  code: string
  text: string
}

const usersPrivileges: readonly Privilege[] = [
  { code: 'readUsers', text: 'Read Users' },
  { code: 'writeUsers', text: 'Write Users' },
  { code: 'createUsers', text: 'Create Users' },
  { code: 'deleteUsers', text: 'Delete Users' },
  { code: 'accessUsersScreen', text: 'Access Users Screen' },
]

const rolesPrivileges: readonly Privilege[] = [
  { code: 'readRoles', text: 'Read Roles' },
  { code: 'writeRoles', text: 'Write Roles' },
  { code: 'createRoles', text: 'Create Roles' },
  { code: 'deleteRoles', text: 'Delete Roles' },
  { code: 'accessRolesScreen', text: 'Access Roles Screen' },
]

const specialitiesPrivileges: readonly Privilege[] = [
  { code: 'readSpecialities', text: 'Read Specialities' },
  { code: 'writeSpecialities', text: 'Write Specialities' },
  { code: 'createSpecialities', text: 'Create Specialities' },
  { code: 'deleteSpecialities', text: 'Delete Specialities' },
  { code: 'accessSpecialitiesScreen', text: 'Access Specialities Screen' },
]

const passwordPolicyPrivileges: readonly Privilege[] = [
  { code: 'readPasswordPolicy', text: 'Read Password Policy' },
  { code: 'writePasswordPolicy', text: 'Write Password Policy' },
]

const dashboardPrivileges: readonly Privilege[] = [
  { code: 'readDashboards', text: 'Read Dashboards' },
  { code: 'writeDashboards', text: 'Write Dashboards' },
  { code: 'createDashboards', text: 'Create Dashboards' },
  { code: 'deleteDashboards', text: 'Delete Dashboards' },
  { code: 'accessDashboardsScreen', text: 'Access Dashboards Screen' },
]

const settingsPrivileges: readonly Privilege[] = [
  { code: 'writeSystemSettings', text: 'Write System Settings' },
  { code: 'accessSystemSettingsScreen', text: 'Access System Settings Screen' },
]

const logsPrivileges: readonly Privilege[] = [
  { code: 'accessAuditLogsScreen', text: 'Access Audit Logs Screen' },
]

const departmentsPrivileges: readonly Privilege[] = [
  { code: 'readDepartments', text: 'Read Departments' },
  { code: 'writeDepartments', text: 'Write Departments' },
  { code: 'createDepartments', text: 'Create Departments' },
  { code: 'deleteDepartments', text: 'Delete Departments' },
  { code: 'accessDepartmentsScreen', text: 'Access Departments Screen' },
]

const workCenterPrivileges: readonly Privilege[] = [
  { code: 'readWorkCenters', text: 'Read Work Centers' },
  { code: 'writeWorkCenters', text: 'Write Work Centers' },
  { code: 'deleteWorkCenters', text: 'Delete Work Centers' },
  { code: 'readSchedules', text: 'Read Schedules' },
  { code: 'writeSchedules', text: 'Write Schedules' },
  { code: 'readOperators', text: 'Read Operators' },
  { code: 'writeOperators', text: 'Write Operators' },
  { code: 'readActionState', text: 'Read Action State' },
  { code: 'accessWorkCentersScreen', text: 'Access Work Centers Screen' },
]

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...usersPrivileges,
  ...rolesPrivileges,
  ...specialitiesPrivileges,
  ...passwordPolicyPrivileges,
  ...dashboardPrivileges,
  ...settingsPrivileges,
  ...logsPrivileges,
  ...departmentsPrivileges,
  ...workCenterPrivileges,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
