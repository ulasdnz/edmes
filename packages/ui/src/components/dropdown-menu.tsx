import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from 'cn'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import type * as React from 'react'

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot='dropdown-menu' {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot='dropdown-menu-portal' {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot='dropdown-menu-trigger' {...props} />
}

function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className='isolate z-50 outline-none'
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot='dropdown-menu-content'
          className={cn(
            'z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-line bg-surface text-text shadow-[0_12px_32px_rgba(15,27,45,0.18)] p-1 outline-none',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot='dropdown-menu-group' {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot='dropdown-menu-label'
      data-inset={inset}
      className={cn('px-3 py-1 text-xs font-semibold text-text-3 data-inset:pl-7', className)}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <MenuPrimitive.Item
      data-slot='dropdown-menu-item'
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex min-h-(--control-h) w-full cursor-default items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] leading-[1.3] outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-7 data-[variant=destructive]:text-state-unplanned-fg data-disabled:cursor-not-allowed data-disabled:text-text-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[17px] [&_svg]:text-text-2 data-[variant=destructive]:[&_svg]:text-state-unplanned-fg",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot='dropdown-menu-sub' {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot='dropdown-menu-sub-trigger'
      data-inset={inset}
      className={cn(
        "relative flex min-h-(--control-h) w-full cursor-default items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] leading-[1.3] outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-7 data-[variant=destructive]:text-state-unplanned-fg data-disabled:cursor-not-allowed data-disabled:text-text-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[17px] [&_svg]:text-text-2 data-[variant=destructive]:[&_svg]:text-state-unplanned-fg data-popup-open:bg-surface-2",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className='ml-auto' />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = 'start',
  alignOffset = -3,
  side = 'right',
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot='dropdown-menu-sub-content'
      className={cn('w-auto min-w-[96px] p-1', className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot='dropdown-menu-checkbox-item'
      data-inset={inset}
      className={cn(
        "relative flex min-h-(--control-h) w-full cursor-default items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] leading-[1.3] outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-7 data-[variant=destructive]:text-state-unplanned-fg data-disabled:cursor-not-allowed data-disabled:text-text-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[17px] [&_svg]:text-text-2 data-[variant=destructive]:[&_svg]:text-state-unplanned-fg pr-8",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className='pointer-events-none absolute right-2 flex items-center justify-center'
        data-slot='dropdown-menu-checkbox-item-indicator'
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot='dropdown-menu-radio-group' {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot='dropdown-menu-radio-item'
      data-inset={inset}
      className={cn(
        "relative flex min-h-(--control-h) w-full cursor-default items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] leading-[1.3] outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-7 data-[variant=destructive]:text-state-unplanned-fg data-disabled:cursor-not-allowed data-disabled:text-text-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[17px] [&_svg]:text-text-2 data-[variant=destructive]:[&_svg]:text-state-unplanned-fg pr-8",
        className,
      )}
      {...props}
    >
      <span
        className='pointer-events-none absolute right-2 flex items-center justify-center'
        data-slot='dropdown-menu-radio-item-indicator'
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot='dropdown-menu-separator'
      className={cn('-mx-1 my-1 h-px bg-line-2', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot='dropdown-menu-shortcut'
      className={cn('ml-auto text-xs tracking-widest text-text-3', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
