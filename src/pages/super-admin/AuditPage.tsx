import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDateTime } from '@/lib/utils'
import type { AuditAction } from '@/types'

interface AuditRow {
  id: string
  action: AuditAction
  entity_type: string
  entity_id: string | null
  created_at: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  school?: { name: string } | null
  user?: { first_name: string; last_name: string; email: string } | null
}

const ACTION_VARIANT: Record<AuditAction, 'default' | 'destructive' | 'success' | 'warning' | 'info'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
  LOGIN: 'default',
  LOGOUT: 'default',
  PUBLISH: 'success',
  LOCK: 'warning',
  UNLOCK: 'info',
  PROMOTE: 'info',
  SCORE_ENTRY: 'default'
}

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  // Deliberately separate from actionFilter's Select — a date range is a
  // different kind of filter (a span, not a single value to match), so it
  // gets its own pair of native date inputs rather than being crammed
  // into the same dropdown control.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: logs = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['platform-audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*, school:schools(name), user:profiles(first_name, last_name, email)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as unknown as AuditRow[]
    }
    // No auto-refresh/polling here by design — this list is manual-refresh
    // only for now (see the Refresh button below). Worth revisiting later
    // if it turns out to actually be wanted at scale; not adding a polling
    // interval preemptively since every poll is a Supabase read whether or
    // not anyone's looking at the page.
  })

  const filtered = logs.filter(log => {
    const matchesSearch = `${log.entity_type} ${log.user?.email ?? ''} ${log.school?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())
    const matchesAction = actionFilter === 'all' || log.action === actionFilter
    const logDate = log.created_at.slice(0, 10)
    const matchesFrom = !dateFrom || logDate >= dateFrom
    const matchesTo = !dateTo || logDate <= dateTo
    return matchesSearch && matchesAction && matchesFrom && matchesTo
  })

  // Phase 5: client-side pagination over the already-capped 200-row
  // fetch — 200 rows rendered at once was still sluggish on lower-end
  // devices, and most admins only ever look at the first page or two.
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Platform-wide activity — most recent 200 events"
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by entity, user, or school…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
            </div>
            <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {Object.keys(ACTION_VARIANT).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date range</span>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="From date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="w-full sm:w-40"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                aria-label="To date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="w-full sm:w-40"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}>
                Clear dates
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-12 w-12" />}
              title="No audit events yet"
              description="Actions like suspending a user, generating invites, or changing assignments will appear here as they happen."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="hidden sm:table-cell">By</TableHead>
                  <TableHead className="hidden md:table-cell">School</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(log.created_at)}</TableCell>
                    <TableCell><Badge variant={ACTION_VARIANT[log.action]}>{log.action}</Badge></TableCell>
                    <TableCell className="text-sm">{log.entity_type}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {log.user ? `${log.user.first_name} ${log.user.last_name}` : '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{log.school?.name ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <p>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Previous page" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" aria-label="Next page" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
