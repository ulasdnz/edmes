import { type ApiError, toApiError } from '@mes/api-client'
import { useAppCore, useCan, useSession } from '@mes/frontend/core'
import {
  type Me,
  type MyRole,
  myProfileOptions,
  type UpdateMeBody,
  useRemoveMyAvatar,
  useUpdateMe,
  useUploadMyAvatar,
} from '@mes/frontend/data/user/me'
import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import { tokenIssuedAt } from '@mes/frontend/session'
import { formatInstant } from '@mes/frontend/time'
import { Banner } from '@mes/ui/components/banner'
import { Button } from '@mes/ui/components/button'
import { Input } from '@mes/ui/components/input'
import { Skeleton } from '@mes/ui/components/skeleton'
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { LockIcon, TriangleAlertIcon } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyServerErrors, FieldLabel, useAppForm } from '../../components/form'
import { apiErrorMessage, PageError } from '../../components/page-state'
import { UserAvatar } from '../../components/user-avatar'

// What the form edits, pinned to the request PATCH /users/me takes: a contract change breaks the
// build. Gender and birth date are empty while the user has none; the API cannot clear either.
type ProfileFields = Required<Pick<UpdateMeBody, 'name' | 'surname' | 'email' | 'language'>> & {
  gender: NonNullable<UpdateMeBody['gender']> | ''
  birthDate: string
}

function valuesOf(user: Me): ProfileFields {
  return {
    name: user.name,
    surname: user.surname,
    email: user.email,
    language: user.language,
    gender: user.gender ?? '',
    birthDate: user.birthDate ?? '',
  }
}

function profileSchema(t: TFunction, stored: ProfileFields) {
  return z.object({
    name: z.string().trim().min(2, t('profile.nameMin')).max(24, t('profile.nameMax')),
    surname: z.string().trim().min(1, t('profile.surnameRequired')),
    email: z
      .string()
      .trim()
      .pipe(z.email(t('profile.emailInvalid'))),
    language: z.enum(['en', 'tr']),
    gender: z.enum(['female', 'male']).or(z.literal('')),
    birthDate: stored.birthDate ? z.string().min(1, t('profile.birthDateRequired')) : z.string(),
  }) satisfies z.ZodType<ProfileFields>
}

// Only what differs from the stored profile is sent
function changesOf(values: ProfileFields, stored: ProfileFields): UpdateMeBody {
  const body: UpdateMeBody = {}
  for (const key of ['name', 'surname', 'email'] as const) {
    const value = values[key].trim()
    if (value !== stored[key]) body[key] = value
  }
  if (values.language !== stored.language) body.language = values.language
  if (values.gender !== '' && values.gender !== stored.gender) body.gender = values.gender
  if (values.birthDate !== '' && values.birthDate !== stored.birthDate) {
    body.birthDate = values.birthDate
  }
  return body
}

function isChanged(values: ProfileFields, stored: ProfileFields): boolean {
  // A cleared birth date is a change the check refuses, so its message can show
  const birthDateCleared = values.birthDate === '' && stored.birthDate !== ''
  return birthDateCleared || Object.keys(changesOf(values, stored)).length > 0
}

const cardHeader =
  'flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-2 px-4 py-2.5'
const cardTitle = 'font-display text-lg leading-tight font-semibold'
const hint = 'text-[12.5px] text-text-3'

function AvatarRow(props: { user: Me }): ReactNode {
  const { t } = useTranslation()
  const { api, session } = useAppCore()
  const upload = useUploadMyAvatar(api)
  const remove = useRemoveMyAvatar(api)
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const messageId = useId()
  const { user } = props
  const busy = upload.isPending || remove.isPending
  const callbacks = {
    // The top bar shows the photo too
    onSuccess: () => void session.refresh(),
    onError: (failure: unknown) => setError(apiErrorMessage(toApiError(failure), t)),
  }

  return (
    <div className='flex flex-wrap items-center gap-4'>
      <UserAvatar
        name={user.name}
        surname={user.surname}
        photoUrl={user.photoUrl}
        alt={t('profile.photo')}
        className='size-18 text-2xl'
      />
      <div className='flex min-w-0 flex-col gap-1.5'>
        <span className='font-semibold'>{t('profile.avatar')}</span>
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            size='sm'
            disabled={busy}
            pending={upload.isPending}
            aria-describedby={messageId}
            onClick={() => fileInput.current?.click()}
          >
            {t('profile.uploadPhoto')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={!user.photoUrl || busy}
            pending={remove.isPending}
            onClick={() => {
              setError(null)
              remove.mutate(undefined, callbacks)
            }}
          >
            {t('profile.removePhoto')}
          </Button>
        </div>
        {/* The server checks the content and the size; accept only narrows the file dialog */}
        <input
          ref={fileInput}
          type='file'
          accept='image/png,image/jpeg'
          hidden
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setError(null)
            upload.mutate(file, callbacks)
          }}
        />
        {error ? (
          <span id={messageId} className='text-[12.5px] text-state-unplanned-fg'>
            {error}
          </span>
        ) : (
          <span id={messageId} className={hint}>
            {user.photoUrl ? t('profile.photoHint') : t('profile.noPhoto')}
          </span>
        )}
      </div>
    </div>
  )
}

function UsernameField(props: { username: string }): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <FieldLabel htmlFor={id}>{t('profile.username')}</FieldLabel>
      <div className='relative'>
        <Input
          id={id}
          value={props.username}
          readOnly
          aria-describedby={`${id}-hint`}
          className='border-line bg-[#eef1f5] pr-8 text-text-2'
        />
        <LockIcon
          aria-hidden='true'
          className='pointer-events-none absolute top-2.5 right-2.5 size-4 text-text-3'
        />
      </div>
      <span id={`${id}-hint`} className={hint}>
        {t('profile.usernameHint')}
      </span>
    </div>
  )
}

function PersonalDetails(props: { user: Me }): ReactNode {
  const { t, i18n } = useTranslation()
  const { api, session } = useAppCore()
  const update = useUpdateMe(api)
  // What the server holds; a save moves it, a refetch of the page's data does not
  const [stored, setStored] = useState(() => valuesOf(props.user))
  const [failure, setFailure] = useState<{ error: ApiError; onFields: boolean } | null>(null)

  const form = useAppForm({
    defaultValues: stored,
    validators: { onSubmit: profileSchema(t, stored) },
    onSubmit: async ({ value, formApi }) => {
      const body = changesOf(value, stored)
      if (Object.keys(body).length === 0) return
      setFailure(null)
      try {
        const saved = valuesOf(await update.mutateAsync(body))
        setStored(saved)
        formApi.reset(saved)
        toast.success(t('profile.saved'))
        if (saved.language !== i18n.language) void i18n.changeLanguage(saved.language)
        // The top bar's name and the session's language follow
        void session.refresh()
      } catch (error) {
        const refused = toApiError(error)
        setFailure({ error: refused, onFields: applyServerErrors(formApi, refused.details) })
      }
    },
  })

  const genders = [
    ...(stored.gender === '' ? [{ value: '', label: '' }] : []),
    { value: 'female', label: t('profile.female') },
    { value: 'male', label: t('profile.male') },
  ]

  return (
    <section
      aria-label={t('profile.details')}
      className='min-w-0 flex-[999_1_520px] rounded-lg border border-line bg-surface'
    >
      <div className={cardHeader}>
        <h2 className={cardTitle}>{t('profile.details')}</h2>
      </div>
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault()
          if (form.state.isSubmitting) return
          void form.handleSubmit()
        }}
      >
        <div className='flex flex-col gap-4.5 p-4'>
          {failure && (
            <Banner tone='error' role='alert'>
              <TriangleAlertIcon aria-hidden='true' className='size-4' />
              <span className='flex-1'>
                <span className='font-semibold'>{t('profile.notSaved')}</span>{' '}
                {failure.onFields ? t('profile.checkFields') : apiErrorMessage(failure.error, t)}
              </span>
            </Banner>
          )}
          <AvatarRow user={props.user} />
          <div className='grid grid-cols-1 gap-4 min-[701px]:grid-cols-2'>
            <form.AppField name='name'>
              {field => <field.TextField label={t('profile.name')} required />}
            </form.AppField>
            <form.AppField name='surname'>
              {field => <field.TextField label={t('profile.surname')} required />}
            </form.AppField>
            <UsernameField username={props.user.username} />
            <form.AppField name='email'>
              {field => <field.TextField label={t('profile.email')} type='email' required />}
            </form.AppField>
            <form.AppField name='language'>
              {field => (
                <field.SelectField
                  label={t('profile.language')}
                  hint={t('profile.languageHint')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'tr', label: 'Türkçe' },
                  ]}
                />
              )}
            </form.AppField>
            <form.AppField name='gender'>
              {field => <field.SelectField label={t('profile.gender')} options={genders} />}
            </form.AppField>
            <form.AppField name='birthDate'>
              {field => <field.TextField label={t('profile.birthDate')} type='date' />}
            </form.AppField>
          </div>
        </div>
        <form.Subscribe selector={state => [state.values, state.isSubmitting] as const}>
          {([values, submitting]) => {
            const changed = isChanged(values, stored)
            return (
              <div className='flex justify-end gap-2 border-t border-line-2 px-4 py-2.5'>
                <Button
                  type='button'
                  disabled={!changed || submitting}
                  onClick={() => {
                    form.reset()
                    setFailure(null)
                  }}
                >
                  {t('profile.discard')}
                </Button>
                <Button type='submit' variant='primary' disabled={!changed} pending={submitting}>
                  {t('profile.save')}
                </Button>
              </div>
            )
          }}
        </form.Subscribe>
      </form>
    </section>
  )
}

function RolesCard(props: { roles: MyRole[] }): ReactNode {
  const { t } = useTranslation()
  return (
    <section aria-label={t('profile.roles')} className='rounded-lg border border-line bg-surface'>
      <div className={cardHeader}>
        <h2 className={cardTitle}>{t('profile.roles')}</h2>
        <span className='flex-1' />
        <span className='inline-flex items-center gap-1 text-[12.5px] text-text-3'>
          <LockIcon aria-hidden='true' className='size-3.5' />
          {t('profile.readOnly')}
        </span>
      </div>
      <div className='flex flex-col gap-2 p-4'>
        {props.roles.length === 0 && (
          <p className='text-[13.5px] text-text-2'>{t('profile.noRoles')}</p>
        )}
        {props.roles.map(role => (
          <div key={role._id}>
            <span className='font-semibold'>{role.name}</span>
            {role.description && <p className={hint}>{role.description}</p>}
          </div>
        ))}
        <p className={hint}>{t('profile.rolesHint')}</p>
      </div>
    </section>
  )
}

// The work centers the user may see, read through the list every screen shares. Without
// readWorkCenters the list is not readable, and only their number is known.
function WorkCentersCard(props: { workCenterIds: readonly string[] }): ReactNode {
  const { t } = useTranslation()
  const { api } = useAppCore()
  const can = useCan()
  const readable = can('readWorkCenters')
  const query = useQuery({
    ...workCentersListOptions(api, { status: 'active' }),
    enabled: readable,
  })

  let summary: string | null = null
  let body: ReactNode
  if (!readable) {
    summary = t('profile.workCentersCount', { count: props.workCenterIds.length })
    body = props.workCenterIds.length === 0 && (
      <p className='text-[13.5px] text-text-2'>{t('profile.noWorkCenters')}</p>
    )
  } else if (query.data) {
    const all = query.data.data
    const physical = all.filter(wc => wc.type === 'physical')
    const virtual = all.filter(wc => wc.type === 'virtual')
    summary = t('profile.physicalVirtual', { physical: physical.length, virtual: virtual.length })
    body =
      all.length === 0 ? (
        <p className='text-[13.5px] text-text-2'>{t('profile.noWorkCenters')}</p>
      ) : (
        <>
          {virtual.map(wc => (
            <div key={wc._id} className='flex flex-wrap items-center gap-2'>
              <span className='font-semibold'>{wc.name}</span>
              <span className='inline-flex h-5 items-center rounded px-1.5 text-[11.5px] font-semibold whitespace-nowrap bg-state-idle-bg text-state-idle-fg'>
                {t('profile.virtual')}
              </span>
            </div>
          ))}
          {physical.length > 0 && (
            <div className='flex flex-wrap items-center gap-x-2 gap-y-1.5'>
              {physical.map(wc => (
                <span key={wc._id} className='font-mono text-[13px] font-medium'>
                  {wc.code}
                </span>
              ))}
            </div>
          )}
        </>
      )
  } else if (query.isError) {
    body = <p className='text-[13.5px] text-text-2'>{t('profile.workCentersFailed')}</p>
  } else {
    body = (
      <Skeleton role='status' aria-label={t('profile.workCentersLoading')} className='h-4 w-48' />
    )
  }

  return (
    <section
      aria-label={t('profile.workCenters')}
      className='rounded-lg border border-line bg-surface'
    >
      <div className={cardHeader}>
        <h2 className={cardTitle}>{t('profile.workCenters')}</h2>
        <span className='flex-1' />
        {summary && <span className='text-[12.5px] text-text-3'>{summary}</span>}
      </div>
      <div className='flex flex-col gap-1.5 p-4 text-[13.5px]'>
        {body}
        <p className={`${hint} mt-1.5`}>{t('profile.workCentersHint')}</p>
      </div>
    </section>
  )
}

function SignedInLine(props: { username: string }): ReactNode {
  const { i18n } = useTranslation()
  const { session } = useAppCore()
  const { plantTimezone } = useSession()
  const issuedAt = tokenIssuedAt(session.getToken())
  const time =
    issuedAt && plantTimezone
      ? formatInstant(issuedAt.toISOString(), {
          timeZone: plantTimezone,
          locale: i18n.language,
          style: 'time',
        })
      : null

  return (
    <p className='text-[12.5px] text-text-3'>
      <Trans
        i18nKey={time ? 'profile.signedIn' : 'profile.signedInNoTime'}
        values={{ username: props.username, time }}
        components={{ code: <span className='font-mono text-[12.5px]' /> }}
      />
    </p>
  )
}

export function ProfilePage(): ReactNode {
  const { t } = useTranslation()
  const { api, session } = useAppCore()
  const { user, plantTimezone, serverClock } = useSession()
  const profile = useQuery(myProfileOptions(api))

  let body: ReactNode
  if (profile.data) {
    body = (
      <div className='flex flex-wrap items-start gap-5'>
        <PersonalDetails user={profile.data.user} />
        <aside className='flex max-w-115 min-w-0 flex-[1_1_380px] flex-col gap-5'>
          <RolesCard roles={profile.data.roles} />
          <WorkCentersCard workCenterIds={profile.data.user.workCenterIds} />
        </aside>
      </div>
    )
  } else if (profile.isError) {
    const error = toApiError(profile.error)
    body = (
      <section className='rounded-lg border border-line bg-surface'>
        <PageError
          title={t('profile.loadFailed')}
          message={apiErrorMessage(error, t)}
          traceId={error.traceId}
          details={{
            code: error.code,
            status: error.status || undefined,
            occurredAt: (
              serverClock?.fromDevice(new Date(profile.errorUpdatedAt)) ??
              new Date(profile.errorUpdatedAt)
            ).toISOString(),
            timeZone: plantTimezone ?? 'UTC',
          }}
          onRetry={() => void profile.refetch()}
        />
      </section>
    )
  } else {
    body = <Skeleton role='status' aria-label={t('profile.loading')} className='h-96 w-full' />
  }

  return (
    <>
      <div className='flex flex-wrap items-end gap-x-4 gap-y-3'>
        <div className='flex flex-col gap-1'>
          <h1 className='font-display text-[28px] leading-[1.15] font-semibold'>
            {t('profile.title')}
          </h1>
          {user && <SignedInLine username={user.username} />}
        </div>
        <span className='flex-1' />
        <Button variant='danger' onClick={session.logout}>
          {t('topbar.logOut')}
        </Button>
      </div>
      {body}
    </>
  )
}
