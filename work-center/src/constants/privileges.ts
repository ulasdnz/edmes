export interface Privilege {
  code: string
  text: string
}

const workCenterPrivileges: readonly Privilege[] = [
  { code: 'readWorkCenters', text: 'Read Work Centers' },
  { code: 'writeWorkCenters', text: 'Write Work Centers' },
  { code: 'deleteWorkCenters', text: 'Delete Work Centers' },
]

const schedulePrivileges: readonly Privilege[] = [
  { code: 'readSchedules', text: 'Read Schedules' },
  { code: 'writeSchedules', text: 'Write Schedules' },
]

const operatorPrivileges: readonly Privilege[] = [
  { code: 'readOperators', text: 'Read Operators' },
  { code: 'writeOperators', text: 'Write Operators' },
]

const actionStatePrivileges: readonly Privilege[] = [
  { code: 'readActionState', text: 'Read Action State' },
]

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...workCenterPrivileges,
  ...schedulePrivileges,
  ...operatorPrivileges,
  ...actionStatePrivileges,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
