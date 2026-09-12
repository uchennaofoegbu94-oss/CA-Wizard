import * as React from 'react'
import { cn } from '@/lib/utils'

// ─── Table ────────────────────────────────────────────────
// containerClassName targets the OUTER scroll wrapper (e.g. a bounded
// `max-h-*` to create a fixed-height scroll frame, needed for a
// sticky <TableHeader> to actually freeze in place rather than just
// scrolling off with the rest of the page) — separate from
// `className`, which still only reaches the inner <table> element as
// before. Every existing usage that doesn't pass containerClassName
// behaves exactly as it did previously.
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn('relative w-full overflow-auto', containerClassName)}>
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
  )
)
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
)
TableBody.displayName = 'TableBody'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)}
      {...props}
    />
  )
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      scope="col"
      className={cn(
        'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
)
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />
  )
)
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
)
TableCaption.displayName = 'TableCaption'

// ─── Skeleton ─────────────────────────────────────────────

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
  )
}

// ─── Spinner ──────────────────────────────────────────────

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeMap = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-10 w-10 border-[3px]' }
  return (
    <div role="status" aria-label="Loading" className={cn('saas-spinner', sizeMap[size], className)} />
  )
}

// ─── Empty State ──────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Stats Card ───────────────────────────────────────────

interface StatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  trend?: { value: number; label: string }
  className?: string
}

function StatsCard({ title, value, subtitle, icon, className }: StatsCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-6', className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-2">
        <p className="text-3xl font-bold">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

// ─── Page Header ──────────────────────────────────────────

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  breadcrumb?: React.ReactNode
}

function PageHeader({ title, description, action, breadcrumb }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 mb-6">
      {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  )
}

export {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
  Skeleton, Spinner, EmptyState, StatsCard, PageHeader
}
