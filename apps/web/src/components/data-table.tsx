import { Skeleton } from '@mes/ui/components/skeleton'
import { cn } from '@mes/ui/lib/utils'
import { type ColumnDef, type RowData, tableFeatures, useTable } from '@tanstack/react-table'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'

export const dataTableFeatures = tableFeatures({})
export type DataTableFeatures = typeof dataTableFeatures

export const PAGE_SIZES = [20, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const cellClass = 'h-11 border-b border-line-2 px-2.5 py-1.5 whitespace-nowrap'
const headClass =
  'h-9 border-b border-line bg-surface-2 px-2.5 text-left text-xs font-semibold whitespace-nowrap text-text-2'

export function DataTable<TData extends RowData>(props: {
  label: string
  columns: ColumnDef<DataTableFeatures, TData>[]
  rows: readonly TData[]
  getRowId: (row: TData) => string
  pagination: Pagination
  onPageChange: (page: number) => void
  onSizeChange: (size: PageSize) => void
  empty: ReactNode
  busy?: boolean
}): ReactNode {
  const table = useTable({
    features: dataTableFeatures,
    columns: props.columns,
    data: props.rows,
    getRowId: props.getRowId,
  })

  if (props.rows.length === 0) return props.empty

  return (
    <div aria-busy={props.busy || undefined}>
      <div className='overflow-x-auto'>
        <table aria-label={props.label} className='w-full min-w-200 text-[13.5px]'>
          <thead>
            {table.getHeaderGroups().map(group => (
              <tr key={group.id}>
                {group.headers.map(header => (
                  <th key={header.id} scope='col' className={headClass}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className='last:[&>td]:border-b-0'>
                {row.getAllCells().map(cell => (
                  <td key={cell.id} className={cellClass}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        pagination={props.pagination}
        onPageChange={props.onPageChange}
        onSizeChange={props.onSizeChange}
      />
    </div>
  )
}

export function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, page - 1, page, page + 1, totalPages])
  const sorted = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const result: Array<number | 'gap'> = []
  for (const p of sorted) {
    const last = result.at(-1)
    if (typeof last === 'number' && p - last > 1) result.push('gap')
    result.push(p)
  }
  return result
}

const pageButton =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-control border border-transparent px-2 text-[13px] font-medium text-text-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50'

function Pager(props: {
  pagination: Pagination
  onPageChange: (page: number) => void
  onSizeChange: (size: PageSize) => void
}): ReactNode {
  const { t } = useTranslation()
  const sizeId = useId()
  const { page, limit, total, totalPages } = props.pagination
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-2 px-4 py-2.5 text-[13px] text-text-2'>
      <span>{t('table.showing', { from, to, total })}</span>
      <span className='flex-1' />
      <span className='flex items-center gap-2'>
        <label htmlFor={sizeId}>{t('table.rowsPerPage')}</label>
        <select
          id={sizeId}
          value={limit}
          onChange={event => {
            const size = PAGE_SIZES.find(option => option === Number(event.target.value))
            if (size) props.onSizeChange(size)
          }}
          className='h-8 rounded-control border border-border bg-surface px-2 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent'
        >
          {PAGE_SIZES.map(size => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </span>
      <nav aria-label={t('table.pagination')} className='flex items-center gap-0.5'>
        <button
          type='button'
          className={pageButton}
          aria-label={t('table.previousPage')}
          disabled={page <= 1}
          onClick={() => props.onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden='true' className='size-4' />
        </button>
        {pageWindow(page, totalPages).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} aria-hidden='true' className='px-1'>
              …
            </span>
          ) : (
            <button
              key={item}
              type='button'
              aria-label={t('table.page', { page: item })}
              aria-current={item === page ? 'page' : undefined}
              className={cn(
                pageButton,
                item === page && 'border-accent bg-accent-bg font-semibold text-accent-hover',
              )}
              onClick={() => props.onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type='button'
          className={pageButton}
          aria-label={t('table.nextPage')}
          disabled={page >= totalPages}
          onClick={() => props.onPageChange(page + 1)}
        >
          <ChevronRightIcon aria-hidden='true' className='size-4' />
        </button>
      </nav>
    </div>
  )
}

export function DataTableSkeleton(props: { columns: number; label: string }): ReactNode {
  return (
    <div aria-busy='true'>
      <output className='sr-only'>{props.label}</output>
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className='grid h-11 items-center gap-4 border-b border-line-2 px-3.5 last:border-b-0'
          style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: props.columns }, (_, column) => (
            <Skeleton key={column} style={{ width: `${60 + ((row + column) % 4) * 10}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}
