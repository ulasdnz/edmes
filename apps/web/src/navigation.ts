import type { PrivilegeCode } from '@mes/privileges'
import { type LucideIcon, SlidersHorizontalIcon } from 'lucide-react'

export interface NavItem {
  id: string
  to: string
  labelKey: string
  permission: PrivilegeCode
}

export interface NavGroup {
  id: string
  labelKey: string
  icon: LucideIcon
  items: readonly NavItem[]
}

export const navigation: readonly NavGroup[] = [
  {
    id: 'system',
    labelKey: 'nav.system',
    icon: SlidersHorizontalIcon,
    items: [{ id: 'users', to: '/users', labelKey: 'nav.users', permission: 'readUsers' }],
  },
]

export function visibleNavigation(can: (code: PrivilegeCode) => boolean): readonly NavGroup[] {
  return navigation
    .map(group => ({ ...group, items: group.items.filter(item => can(item.permission)) }))
    .filter(group => group.items.length > 0)
}
