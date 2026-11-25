import type { JobOrder } from '@mes/frontend/data/production/job-orders'
import { jobOrderRuntimeState } from '@mes/frontend/domain'
import { StatePill } from '@mes/ui/components/state-pill'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function CurrentJobOrder(props: { jobOrder: JobOrder | null }): ReactNode {
  const { t, i18n } = useTranslation()
  const { jobOrder } = props

  return (
    <section
      aria-label={t('station.jobOrder')}
      className='flex flex-col gap-4 rounded-control border border-line bg-surface p-6'
    >
      {jobOrder === null ? (
        <p className='text-lg text-text-2'>{t('station.noRunningJobOrder')}</p>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-3'>
            <span className='font-display text-3xl font-semibold'>{jobOrder.code}</span>
            {jobOrderRuntimeState(jobOrder) === 'running' && (
              <StatePill state='running'>{t('station.running')}</StatePill>
            )}
          </div>
          <dl className='flex flex-col gap-1'>
            <dt className='text-sm text-text-2'>{t('station.target')}</dt>
            <dd className='font-display text-2xl font-semibold'>
              {new Intl.NumberFormat(i18n.language).format(jobOrder.targetQuantity)}
            </dd>
          </dl>
        </>
      )}
    </section>
  )
}
