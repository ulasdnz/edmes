import { useAppCore } from '@mes/frontend/core'
import { plantTimeOptions } from '@mes/frontend/data/user/plant-time'
import { type Language, resolveLanguage } from '@mes/frontend/i18n'
import markUrl from '@mes/ui/brand/mark.png'
import wordmarkUrl from '@mes/ui/brand/wordmark.png'
import { cn } from '@mes/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PlantClock } from '../../components/plant-clock'
import { writeLanguage } from '../../prefs'
import { LoginForm } from './login-form'

const LANGUAGES: readonly Language[] = ['en', 'tr']

function chooseLanguage(language: Language) {
  try {
    writeLanguage(localStorage, language)
  } catch {
    // the choice lasts for this page when the device keeps nothing
  }
}

// Left out while it loads and when it fails: the form works without it
function PlantTimeLine(): ReactNode {
  const { api } = useAppCore()
  const { data } = useQuery(plantTimeOptions(api))
  if (!data) return null
  return <PlantClock clock={data.clock} timeZone={data.plantTimezone} />
}

// The form comes first, for the keyboard and on a narrow screen, where the brand panel wraps
// under it; on a wide screen the panel is drawn on the left.
export function LoginPage(props: {
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>
}): ReactNode {
  const { t, i18n } = useTranslation()
  const current = resolveLanguage({ stored: i18n.language })

  return (
    <div className='flex min-h-screen flex-row-reverse flex-wrap bg-bg'>
      <div className='flex flex-[1_1_480px] items-center justify-center px-6 py-12'>
        <div className='flex w-full max-w-95 flex-col gap-4.5'>
          <div className='flex items-center justify-between'>
            <h1 className='font-display text-[26px] leading-[1.15] font-semibold'>
              {t('auth.title')}
            </h1>
            <fieldset className='flex rounded-control border border-border'>
              <legend className='sr-only'>{t('common.language')}</legend>
              {LANGUAGES.map(language => (
                <button
                  key={language}
                  type='button'
                  lang={language}
                  aria-pressed={current === language}
                  onClick={() => {
                    chooseLanguage(language)
                    void i18n.changeLanguage(language)
                  }}
                  className={cn(
                    'h-7.5 px-3 text-[12.5px] font-semibold text-text-2 outline-none first:rounded-l-[5px] last:rounded-r-[5px] focus-visible:ring-2 focus-visible:ring-accent',
                    current === language && 'bg-accent-bg text-accent-hover',
                  )}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </fieldset>
          </div>
          <LoginForm onSubmit={props.onSubmit} />
        </div>
      </div>
      <div className='flex flex-[1_1_420px] flex-col justify-between gap-10 bg-ink px-14 py-12 text-ink-text'>
        <div className='flex items-center gap-3'>
          <img src={markUrl} alt='' className='block size-15 flex-none' />
          <img src={wordmarkUrl} alt='EDMES' className='ml-1 block h-8 w-auto flex-none' />
        </div>
        <p className='max-w-105 text-[15px] leading-[1.55]'>{t('auth.tagline')}</p>
        <div className='flex flex-col gap-1.5 text-[12.5px] text-ink-text-2'>
          <span>{t('auth.onPremise')}</span>
          <PlantTimeLine />
        </div>
      </div>
    </div>
  )
}
