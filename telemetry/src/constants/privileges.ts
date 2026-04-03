export interface Privilege {
  code: string
  text: string
}

const tagTypesPrivileges: readonly Privilege[] = [
  { code: 'readTagTypes', text: 'Read Tag Types' },
  { code: 'createTagTypes', text: 'Create Tag Types' },
  { code: 'writeTagTypes', text: 'Write Tag Types' },
  { code: 'deleteTagTypes', text: 'Delete Tag Types' },
]

const edgeDevicesPrivileges: readonly Privilege[] = [
  { code: 'readEdgeDevices', text: 'Read Edge Devices' },
  { code: 'createEdgeDevices', text: 'Create Edge Devices' },
  { code: 'writeEdgeDevices', text: 'Write Edge Devices' },
  { code: 'deleteEdgeDevices', text: 'Delete Edge Devices' },
]

const tagsPrivileges: readonly Privilege[] = [
  { code: 'readTags', text: 'Read Tags' },
  { code: 'createTags', text: 'Create Tags' },
  { code: 'writeTags', text: 'Write Tags' },
  { code: 'deleteTags', text: 'Delete Tags' },
]

const historianPrivileges: readonly Privilege[] = [
  { code: 'readHistorian', text: 'Read Historian Data' },
  { code: 'writeTagValues', text: 'Write Tag Values' },
  { code: 'sendTagCommands', text: 'Send Tag Commands' },
]

const discoveryPrivileges: readonly Privilege[] = [
  { code: 'readDiscovery', text: 'Read Discovery Data' },
]

export const PRIVILEGES: readonly Privilege[] = Object.freeze([
  ...tagTypesPrivileges,
  ...edgeDevicesPrivileges,
  ...tagsPrivileges,
  ...historianPrivileges,
  ...discoveryPrivileges,
])

export const VALID_PRIVILEGE_CODES: ReadonlySet<string> = new Set(PRIVILEGES.map(p => p.code))

export const isValidPrivilegeCode = (code: string): boolean => VALID_PRIVILEGE_CODES.has(code)

export const getInvalidPrivilegeCodes = (codes: string[]): string[] =>
  codes.filter(code => !VALID_PRIVILEGE_CODES.has(code))
