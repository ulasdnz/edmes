import { Button } from '@mes/ui/components/button'
import { Input } from '@mes/ui/components/input'
import { Label } from '@mes/ui/components/label'
import { cn } from '@mes/ui/lib/utils'
import { type AnyFormApi, createFormHook, createFormHookContexts } from '@tanstack/react-form'
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

// The label of a required field ends in a red asterisk, as the canvas marks it
export function FieldLabel(props: {
  htmlFor: string
  required?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <Label
      htmlFor={props.htmlFor}
      className={cn(props.required && "after:text-state-unplanned-fg after:content-['_*']")}
    >
      {props.children}
    </Label>
  )
}

// The error replaces the hint while there is one
function FieldMessage(props: { id: string; error?: string; hint?: string }): ReactNode {
  if (props.error) {
    return (
      <span id={props.id} className='text-[12.5px] text-state-unplanned-fg'>
        {props.error}
      </span>
    )
  }
  if (!props.hint) return null
  return (
    <span id={props.id} className='text-[12.5px] text-text-3'>
      {props.hint}
    </span>
  )
}

function TextField(props: {
  label: string
  type?: 'text' | 'email' | 'password' | 'date'
  autoComplete?: string
  disabled?: boolean
  required?: boolean
  hint?: string
  className?: string
  trailing?: ReactNode
}): ReactNode {
  const field = useFieldContext<string>()
  const id = useId()
  const messageId = `${id}-message`
  const error = errorMessage(field.state.meta.errors[0])

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <FieldLabel htmlFor={id} required={props.required}>
        {props.label}
      </FieldLabel>
      <div className='relative'>
        <Input
          id={id}
          name={field.name}
          type={props.type ?? 'text'}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          required={props.required}
          value={field.state.value}
          onChange={event => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || props.hint ? messageId : undefined}
          className={props.className}
        />
        {props.trailing}
      </div>
      <FieldMessage id={messageId} error={error} hint={props.hint} />
    </div>
  )
}

// A native select drawn like the canvas's .se: the browser's own list, keyboard and touch included
function SelectField(props: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  hint?: string
}): ReactNode {
  const field = useFieldContext<string>()
  const id = useId()
  const messageId = `${id}-message`
  const error = errorMessage(field.state.meta.errors[0])

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <select
        id={id}
        name={field.name}
        value={field.state.value}
        onChange={event => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || props.hint ? messageId : undefined}
        className='h-(--control-h) w-full min-w-0 appearance-none rounded-control border border-border bg-surface bg-[length:5px_5px] bg-[position:calc(100%-15px)_15px,calc(100%-10px)_15px] bg-no-repeat pr-7 pl-2.5 text-sm leading-[1.3] text-text outline-none [background-image:linear-gradient(45deg,transparent_50%,var(--color-text-2)_50%),linear-gradient(135deg,var(--color-text-2)_50%,transparent_50%)] focus-visible:ring-2 focus-visible:ring-accent aria-invalid:border-state-unplanned aria-invalid:shadow-[0_0_0_3px_var(--color-state-unplanned-bg)]'
      >
        {props.options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessage id={messageId} error={error} hint={props.hint} />
    </div>
  )
}

// The server stays the authority: each { field, message } of a refused request goes under its
// field until that field changes. Answers whether any detail named a field of the form.
export function applyServerErrors(
  form: AnyFormApi,
  details: ReadonlyArray<{ field: string; message: string }> | undefined,
): boolean {
  let applied = false
  for (const { field, message } of details ?? []) {
    if (!(field in form.state.values)) continue
    applied = true
    form.setFieldMeta(field, meta => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: message },
    }))
  }
  return applied
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
  fieldComponents: { TextField, SelectField },
  formComponents: { SubmitButton },
})
