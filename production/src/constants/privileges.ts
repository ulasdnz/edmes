export interface Privilege {
  code: string
  text: string
}

const catalogPrivileges: readonly Privilege[] = [
  { code: 'readCatalog', text: 'Read Catalog' },
  { code: 'writeCatalog', text: 'Write Catalog' },
  { code: 'deleteCatalog', text: 'Delete Catalog' },
]

const standardPrivileges: readonly Privilege[] = [
  { code: 'readProductStandards', text: 'Read Product Standards' },
  { code: 'writeProductStandards', text: 'Write Product Standards' },
  { code: 'deleteProductStandards', text: 'Delete Product Standards' },
]

const planPrivileges: readonly Privilege[] = [
  { code: 'readProductionPlans', text: 'Read Production Plans' },
  { code: 'writeProductionPlans', text: 'Write Production Plans' },
  { code: 'deleteProductionPlans', text: 'Delete Production Plans' },
]

const jobOrderPrivileges: readonly Privilege[] = [
  { code: 'readJobOrders', text: 'Read Job Orders' },
  { code: 'writeJobOrders', text: 'Write Job Orders' },
  { code: 'deleteJobOrders', text: 'Delete Job Orders' },
  { code: 'executeJobOrders', text: 'Execute Job Orders' },
]

const adjustmentPrivileges: readonly Privilege[] = [
  { code: 'readProductionAdjustments', text: 'Read Production Adjustments' },
  { code: 'writeProductionAdjustments', text: 'Write Production Adjustments' },
  { code: 'deleteProductionAdjustments', text: 'Delete Production Adjustments' },
]

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...catalogPrivileges,
  ...standardPrivileges,
  ...planPrivileges,
  ...jobOrderPrivileges,
  ...adjustmentPrivileges,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
