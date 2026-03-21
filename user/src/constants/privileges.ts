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

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...usersPrivileges,
  ...rolesPrivileges,
  ...specialitiesPrivileges,
  ...dashboardPrivileges,
  ...settingsPrivileges,
  ...logsPrivileges,
  ...departmentsPrivileges,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
