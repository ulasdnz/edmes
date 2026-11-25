import { type Language, resolveLanguage } from '@mes/frontend/i18n'
import { cn } from '@mes/ui/lib/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

export function LoginPage(props: {
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>
}): ReactNode {
  const { t, i18n } = useTranslation()
  const current = resolveLanguage({ stored: i18n.language })

  return (
    <div className='flex min-h-screen flex-wrap bg-bg'>
      <div className='flex flex-[1_1_420px] flex-col justify-between gap-10 bg-ink px-14 py-12 text-ink-text'>
        <div className='font-display text-[32px] font-bold tracking-[0.06em] text-white'>EDMES</div>
        <p className='max-w-105 text-[15px] leading-[1.55]'>{t('auth.tagline')}</p>
        <p className='text-[13px] text-ink-text-2'>{t('auth.onPremise')}</p>
      </div>
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
    </div>
  )
}
