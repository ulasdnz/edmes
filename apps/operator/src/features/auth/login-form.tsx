import { type ApiError, toApiError } from '@mes/api-client'
import { Banner } from '@mes/ui/components/banner'
import { Button } from '@mes/ui/components/button'
import { Input } from '@mes/ui/components/input'
import { Label } from '@mes/ui/components/label'
import type { TFunction } from 'i18next'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

function failureMessage(error: ApiError, t: TFunction): string {
  if (error.kind === 'network') return t('auth.unreachable')
  if (error.kind === 'timeout') return t('auth.timeout')
  if (error.kind === 'http' && error.message !== error.code) return error.message
  return t('auth.failed')
}

export function LoginForm(props: {
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>
}): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ApiError | null>(null)

  async function submit() {
    if (pending) return
    setPending(true)
    setFailure(null)
    try {
      await props.onSubmit({ email: email.trim(), password })
    } catch (error) {
      setFailure(toApiError(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      noValidate
      aria-label={t('auth.title')}
      className='flex flex-col gap-5'
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
    >
      {failure && (
        <Banner tone='error' role='alert'>
          {failureMessage(failure, t)}
        </Banner>
      )}
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={`${id}-email`}>{t('auth.email')}</Label>
        <Input
          id={`${id}-email`}
          type='email'
          autoComplete='username'
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={`${id}-password`}>{t('auth.password')}</Label>
        <Input
          id={`${id}-password`}
          type='password'
          autoComplete='current-password'
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </div>
      <Button
        type='submit'
        variant='primary'
        pending={pending}
        disabled={email.trim() === '' || password === ''}
      >
        {t('auth.submit')}
      </Button>
    </form>
  )
}
