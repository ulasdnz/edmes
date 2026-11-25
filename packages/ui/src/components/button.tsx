import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cn } from '@mes/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2Icon } from 'lucide-react'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[7px] rounded-control border font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'border-[#aeb7c4] bg-surface text-text',
        primary: 'border-accent bg-accent text-white',
        danger: 'border-[#e2a49b] bg-surface text-state-unplanned-fg',
        'danger-solid': 'border-[#b42e1e] bg-[#b42e1e] text-white',
        ghost: 'border-transparent bg-transparent text-accent-hover',
      },
      size: {
        default: 'h-(--control-h) px-[14px] text-[13.5px] leading-none',
        sm: 'h-(--control-h-sm) px-2.5 text-[12.5px] leading-none',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  pending = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { pending?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot='button'
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <Loader2Icon aria-hidden='true' className='animate-spin' />}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
