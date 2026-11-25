import { Button } from '@mes/ui/components/button'
import { Input } from '@mes/ui/components/input'
import { Label } from '@mes/ui/components/label'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import { type ReactNode, useId } from 'react'

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts()

// A schema validator reports issues ({ message }), a function validator plain strings.
function errorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' ? error.message : undefined
  }
  return undefined
}

function TextField(props: {
  label: string
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  disabled?: boolean
  className?: string
  trailing?: ReactNode
}): ReactNode {
  const field = useFieldContext<string>()
  const id = useId()
  const errorId = `${id}-error`
  const error = errorMessage(field.state.meta.errors[0])

  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={id}>{props.label}</Label>
      <div className='relative'>
        <Input
          id={id}
          name={field.name}
          type={props.type ?? 'text'}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          value={field.state.value}
          onChange={event => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={props.className}
        />
        {props.trailing}
      </div>
      {error && (
        <span id={errorId} className='text-[12.5px] text-state-unplanned-fg'>
          {error}
        </span>
      )}
    </div>
  )
}

function SubmitButton(props: { children: ReactNode; className?: string }): ReactNode {
  const form = useFormContext()
  return (
    <form.Subscribe selector={state => state.isSubmitting}>
      {isSubmitting => (
        <Button type='submit' variant='primary' pending={isSubmitting} className={props.className}>
          {props.children}
        </Button>
      )}
    </form.Subscribe>
  )
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton },
})
