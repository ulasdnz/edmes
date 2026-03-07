/**
 * Privilege Registry — single source of truth for all valid permission codes.
 *
 * Structure mirrors the legacy privilege system:
 * - `code`:     Machine-readable identifier used in roles and JWT (e.g., 'readUsers')
 * - `text`:     Human-readable label for UI display
 * - `group`:    Category array for grouping in role management UI
 * - `required`: Dependent privileges that are automatically needed
 *
 * Naming convention: `${action}${Resource}`
 * Actions: read, write, create, delete, navigate
 *
 * This file is the ONLY place where privileges are defined.
 * Role creation/update validates against this registry.
 * Other microservices add their domain privileges here as they're built.
 */

export interface Privilege {
  code: string
  text: string
  group: string[]
  required: string[]
}

// ─── Users Service Privileges ────────────────────────────────────────────────

const usersPrivileges: Privilege[] = [
  { code: 'readUsers', text: 'Read Users', group: ['Users'], required: [] },
  { code: 'writeUsers', text: 'Write Users', group: ['Users'], required: [] },
  { code: 'createUsers', text: 'Create Users', group: ['Users'], required: [] },
  { code: 'deleteUsers', text: 'Delete Users', group: ['Users'], required: [] },
  { code: 'navigateUsers', text: 'Navigate Users', group: ['Users'], required: [] },
]

const rolesPrivileges: Privilege[] = [
  { code: 'readRoles', text: 'Read Roles', group: ['Roles'], required: [] },
  { code: 'writeRoles', text: 'Write Roles', group: ['Roles'], required: [] },
  { code: 'createRoles', text: 'Create Roles', group: ['Roles'], required: [] },
  { code: 'deleteRoles', text: 'Delete Roles', group: ['Roles'], required: [] },
  { code: 'navigateRoles', text: 'Navigate Roles', group: ['Roles'], required: [] },
]

const specialitiesPrivileges: Privilege[] = [
  { code: 'readSpecialities', text: 'Read Specialities', group: ['Specialities'], required: [] },
  { code: 'writeSpecialities', text: 'Write Specialities', group: ['Specialities'], required: [] },
  {
    code: 'createSpecialities',
    text: 'Create Specialities',
    group: ['Specialities'],
    required: [],
  },
  {
    code: 'deleteSpecialities',
    text: 'Delete Specialities',
    group: ['Specialities'],
    required: [],
  },
  {
    code: 'navigateSpecialities',
    text: 'Navigate Specialities',
    group: ['Specialities'],
    required: [],
  },
]

const passwordPolicyPrivileges: Privilege[] = [
  {
    code: 'readPasswordPolicy',
    text: 'Read Password Policy',
    group: ['Password Policy'],
    required: [],
  },
  {
    code: 'writePasswordPolicy',
    text: 'Write Password Policy',
    group: ['Password Policy'],
    required: [],
  },
]

// ─── Dashboard & Common Privileges ───────────────────────────────────────────

const dashboardPrivileges: Privilege[] = [
  { code: 'readDashboards', text: 'Read Dashboards', group: ['Dashboard'], required: [] },
  { code: 'writeDashboards', text: 'Write Dashboards', group: ['Dashboard'], required: [] },
  { code: 'createDashboards', text: 'Create Dashboards', group: ['Dashboard'], required: [] },
  { code: 'deleteDashboards', text: 'Delete Dashboards', group: ['Dashboard'], required: [] },
  { code: 'navigateDashboards', text: 'Navigate Dashboards', group: ['Dashboard'], required: [] },
]

const settingsPrivileges: Privilege[] = [
  { code: 'writeSystemSettings', text: 'Write System Settings', group: ['Settings'], required: [] },
  {
    code: 'navigateSystemSettings',
    text: 'Navigate System Settings',
    group: ['Settings'],
    required: [],
  },
]

const logsPrivileges: Privilege[] = [
  { code: 'navigateCrudLogs', text: 'Navigate Event Logs', group: ['Logs'], required: [] },
]

const departmentsPrivileges: Privilege[] = [
  { code: 'readDepartments', text: 'Read Departments', group: ['Departments'], required: [] },
  { code: 'writeDepartments', text: 'Write Departments', group: ['Departments'], required: [] },
  { code: 'createDepartments', text: 'Create Departments', group: ['Departments'], required: [] },
  { code: 'deleteDepartments', text: 'Delete Departments', group: ['Departments'], required: [] },
  {
    code: 'navigateDepartments',
    text: 'Navigate Departments',
    group: ['Departments'],
    required: [],
  },
]

// ─── Combined Registry ───────────────────────────────────────────────────────

/**
 * All registered privileges. Frozen at startup — immutable at runtime.
 * Other services add their domain-specific privileges to this array as they're built.
 */
export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...usersPrivileges,
  ...rolesPrivileges,
  ...specialitiesPrivileges,
  ...passwordPolicyPrivileges,
  ...dashboardPrivileges,
  ...settingsPrivileges,
  ...logsPrivileges,
  ...departmentsPrivileges,
])

/**
 * Set of all valid privilege codes — O(1) lookup for validation.
 */
export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

/**
 * Check if a privilege code is valid (exists in the registry).
 */
export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

/**
 * Validate an array of privilege codes. Returns invalid codes.
 */
export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
