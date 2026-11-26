import { type ApiError, toApiError } from '@mes/api-client'
import { Banner } from '@mes/ui/components/banner'
import { Button } from '@mes/ui/components/button'
import type { TFunction } from 'i18next'
import { LockIcon, TriangleAlertIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useAppForm } from '../../components/form'

const LOCKED = 'auth.account_temporarily_locked'

function failureMessage(error: ApiError, t: TFunction): string {
  if (error.kind === 'network') return t('auth.unreachable')
  if (error.kind === 'timeout') return t('auth.timeout')
  // nginx answers it and cannot translate
  if (error.code === 'gateway.unavailable') return t('common.serviceUnavailable')
  if (error.kind === 'http' && error.message !== error.code) return error.message
  return t('auth.failed')
}

export function LoginForm(props: {
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>
}): ReactNode {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ApiError | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: {
      onSubmit: z.object({
        email: z.string().trim().min(1, t('auth.emailRequired')),
        password: z.string().min(1, t('auth.passwordRequired')),
      }),
    },
    onSubmit: async ({ value }) => {
      setFailure(null)
      try {
        await props.onSubmit({ email: value.email.trim(), password: value.password })
      } catch (error) {
        setFailure(toApiError(error))
      }
    },
  })

  const locked = failure?.code === LOCKED

  return (
    <form
      noValidate
      aria-label={t('auth.title')}
      className='flex flex-col gap-4.5'
      onSubmit={event => {
        event.preventDefault()
        if (form.state.isSubmitting) return
        void form.handleSubmit()
      }}
    >
      {failure && (
        <Banner tone={locked ? 'warn' : 'error'} role='alert'>
          {locked ? (
            <LockIcon aria-hidden='true' className='size-4' />
          ) : (
            <TriangleAlertIcon aria-hidden='true' className='size-4' />
          )}
          <span className='flex-1'>{failureMessage(failure, t)}</span>
        </Banner>
      )}
      <form.AppField name='email'>
        {field => (
          <field.TextField
            label={t('auth.email')}
            type='email'
            autoComplete='username'
            className='h-11'
          />
        )}
      </form.AppField>
      <form.AppField name='password'>
        {field => (
          <field.TextField
            label={t('auth.password')}
            type={showPassword ? 'text' : 'password'}
            autoComplete='current-password'
            className='h-11 pr-18'
            trailing={
              <Button
                type='button'
                size='sm'
                variant='ghost'
                aria-pressed={showPassword}
                className='absolute top-2 right-1.5'
                onClick={() => setShowPassword(shown => !shown)}
              >
                {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              </Button>
            }
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton className='h-11 text-[15px]'>{t('auth.submit')}</form.SubmitButton>
      </form.AppForm>
      <p className='text-[13px] text-text-3'>{t('auth.forgotPassword')}</p>
    </form>
  )
}
