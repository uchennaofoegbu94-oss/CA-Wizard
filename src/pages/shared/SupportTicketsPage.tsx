import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, LifeBuoy, Search, ArrowLeft, Send, ArrowUpCircle,
  Clock, School as SchoolIcon, KeyRound
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { timeAgo, formatDateTime, fullName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type {
  SupportTicket, TicketMessage, TicketStatus, TicketPriority, TicketCategory
} from '@/types'

const ALL_VALUE = '__all__'
const PAGE_SIZE = 15

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_on_requester: 'Waiting on Requester',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened'
}

const STATUS_BADGE: Record<TicketStatus, 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive'> = {
  open: 'info',
  in_progress: 'warning',
  waiting_on_requester: 'secondary',
  resolved: 'success',
  closed: 'secondary',
  reopened: 'destructive'
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent'
}

const PRIORITY_BADGE: Record<TicketPriority, 'default' | 'secondary' | 'warning' | 'destructive'> = {
  low: 'secondary', medium: 'default', high: 'warning', urgent: 'destructive'
}

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  technical: 'Technical', billing: 'Billing', account: 'Account',
  feature_request: 'Feature Request', other: 'Other'
}

const ESCALATION_LABEL = { school: 'School', group: 'Group', platform: 'Platform' } as const

const createSchema = z.object({
  subject: z.string().min(4, 'Give it a short, clear subject'),
  description: z.string().min(10, 'Add a bit more detail so we can help'),
  category: z.enum(['technical', 'billing', 'account', 'feature_request', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'urgent'])
})
type CreateFormData = z.infer<typeof createSchema>

export default function SupportTicketsPage() {
  const { profile, role, schoolId } = useAuth()
  const qc = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [replyText, setReplyText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const canCreate = role === 'teacher' || role === 'school_admin'

  // ── Tickets list (RLS scopes visibility per role automatically) ──
  const { data: tickets = [], isLoading: loadingTickets } = useQuery({
    queryKey: ['support-tickets', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*, submitter:profiles!support_tickets_submitted_by_fkey(*), school:schools(*), assignee:profiles!support_tickets_assigned_to_fkey(*)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as SupportTicket[]
    },
    enabled: !!profile
  })

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (statusFilter !== ALL_VALUE && t.status !== statusFilter) return false
      if (dateFrom && t.created_at < `${dateFrom}T00:00:00`) return false
      if (dateTo && t.created_at > `${dateTo}T23:59:59`) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${t.subject} ${t.description} ${t.school?.name ?? ''} ${t.submitter ? fullName(t.submitter) : ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tickets, statusFilter, dateFrom, dateTo, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const selectedTicket = tickets.find(t => t.id === selectedId) ?? null

  // ── Messages for the open ticket ──────────────────────────
  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['ticket-messages', selectedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('*, sender:profiles(*)')
        .eq('ticket_id', selectedId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as TicketMessage[]
    },
    enabled: !!selectedId
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['support-tickets'] })
    qc.invalidateQueries({ queryKey: ['ticket-messages', selectedId] })
    qc.invalidateQueries({ queryKey: ['my-group-open-tickets'] })
  }

  // ── Notification fan-out ─────────────────────────────────────
  // Resolution of "who is the current handler" happens server-side
  // in notify_ticket_participants (migration 027) — a school_admin's
  // own ticket needs to notify a super_admin, which the plain
  // notifications RLS can't do (a super_admin has no school_id to
  // match against), so this goes through a SECURITY DEFINER RPC
  // rather than a direct insert. Best-effort, same as the rest of
  // the app's notification calls — a failure here never blocks the
  // action that triggered it.
  const handlerLinkPath = (level: SupportTicket['escalation_level']) =>
    level === 'school' ? '/school/support' : level === 'group' ? '/group-admin/tickets' : '/super-admin/tickets'

  const submitterLinkPath = (t: SupportTicket) =>
    t.submitter?.role === 'teacher' ? '/teacher/support' : '/school/support'

  const notifyTicket = async (params: {
    ticketId: string
    type: 'ticket_created' | 'ticket_replied' | 'ticket_escalated' | 'ticket_status_changed'
    title: string
    body?: string
    linkPath: string
    notifySubmitter?: boolean
    notifyHandler?: boolean
  }) => {
    try {
      await supabase.rpc('notify_ticket_participants', {
        p_ticket_id: params.ticketId,
        p_type: params.type,
        p_title: params.title,
        p_body: params.body ?? null,
        p_link_path: params.linkPath,
        p_notify_submitter: params.notifySubmitter ?? false,
        p_notify_current_handler: params.notifyHandler ?? false,
        p_exclude_profile_id: profile?.id ?? null
      })
    } catch {
      // Intentionally swallowed — see notifyUser() for the same reasoning
    }
  }

  // ── Create ticket ──────────────────────────────────────────
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { category: 'other', priority: 'medium' }
  })

  const createTicket = useMutation({
    mutationFn: async (data: CreateFormData) => {
      const { data: row, error } = await supabase
        .from('support_tickets')
        .insert({
          submitted_by: profile!.id,
          school_id: schoolId!,
          subject: data.subject,
          description: data.description,
          category: data.category,
          priority: data.priority
        })
        .select()
        .single()
      if (error) throw error
      return row as SupportTicket
    },
    onSuccess: (row) => {
      logAudit({ schoolId: schoolId, userId: profile?.id ?? null, action: 'CREATE', entityType: 'support_ticket', entityId: row.id, newValue: { subject: row.subject } })
      toast.success('Ticket submitted')
      setCreateOpen(false)
      reset()
      invalidateAll()
      setSelectedId(row.id)
      notifyTicket({
        ticketId: row.id,
        type: 'ticket_created',
        title: `New ticket: ${row.subject}`,
        body: row.description.length > 140 ? `${row.description.slice(0, 140)}…` : row.description,
        linkPath: handlerLinkPath(row.escalation_level),
        notifyHandler: true
      })
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Update ticket (status / priority / escalation) ──────────
  const updateTicket = useMutation({
    mutationFn: async (patch: Partial<Pick<SupportTicket, 'status' | 'priority' | 'escalation_level' | 'assigned_to'>>) => {
      if (!selectedTicket) throw new Error('No ticket selected')
      const fullPatch: Record<string, unknown> = { ...patch }
      if (patch.status === 'resolved') fullPatch.resolved_at = new Date().toISOString()
      if (patch.status === 'closed') fullPatch.closed_at = new Date().toISOString()
      if (patch.status && patch.status !== 'resolved') fullPatch.resolved_at = null
      if (patch.status && patch.status !== 'closed') fullPatch.closed_at = null

      const { error } = await supabase.from('support_tickets').update(fullPatch).eq('id', selectedTicket.id)
      if (error) throw error
      return { ...selectedTicket, ...fullPatch } as SupportTicket
    },
    onSuccess: (_row, patch) => {
      logAudit({
        schoolId: selectedTicket?.school_id ?? null,
        userId: profile?.id ?? null,
        action: 'UPDATE',
        entityType: 'support_ticket',
        entityId: selectedTicket?.id ?? null,
        newValue: patch
      })
      if (patch.escalation_level) {
        toast.success('Ticket escalated')
        if (selectedTicket) {
          notifyTicket({
            ticketId: selectedTicket.id,
            type: 'ticket_escalated',
            title: `Ticket escalated: ${selectedTicket.subject}`,
            linkPath: handlerLinkPath(patch.escalation_level),
            notifyHandler: true
          })
        }
      } else {
        toast.success('Ticket updated')
        if (patch.status && (patch.status === 'resolved' || patch.status === 'closed') && selectedTicket) {
          notifyTicket({
            ticketId: selectedTicket.id,
            type: 'ticket_status_changed',
            title: `Ticket ${patch.status}: ${selectedTicket.subject}`,
            linkPath: submitterLinkPath(selectedTicket),
            notifySubmitter: true
          })
        }
      }
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Reply ───────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async (message: string) => {
      if (!selectedTicket) throw new Error('No ticket selected')
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: selectedTicket.id,
        sender_id: profile!.id,
        message
      })
      if (error) throw error
      return message
    },
    onSuccess: (message) => {
      setReplyText('')
      invalidateAll()
      if (selectedTicket) {
        const title = `New reply: ${selectedTicket.subject}`
        const body = message.length > 140 ? `${message.slice(0, 140)}…` : message
        notifyTicket({ ticketId: selectedTicket.id, type: 'ticket_replied', title, body, linkPath: submitterLinkPath(selectedTicket), notifySubmitter: true })
        notifyTicket({ ticketId: selectedTicket.id, type: 'ticket_replied', title, body, linkPath: handlerLinkPath(selectedTicket.escalation_level), notifyHandler: true })
      }
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // A public Supabase Auth endpoint (see the identical comment on
  // super-admin UsersPage's own copy of this) — no special DB
  // permission needed. Gated behind canAct/`acting` for UI consistency
  // with every other handler-only action on this page, not because
  // that's the real security boundary (there isn't one to gate here —
  // only the inbox owner can ever act on the link it sends).
  const sendPasswordReset = useMutation({
    mutationFn: async () => {
      if (!selectedTicket?.submitter?.email) throw new Error('No submitter email on this ticket')
      const { error } = await supabase.auth.resetPasswordForEmail(selectedTicket.submitter.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Reset link sent to ${selectedTicket?.submitter?.email}`)
      if (selectedTicket) {
        logAudit({
          schoolId: selectedTicket.school_id ?? null, userId: profile?.id ?? null, action: 'UPDATE',
          entityType: 'password_reset_sent', entityId: selectedTicket.submitted_by
        })
      }
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Handler / escalation logic ───────────────────────────────
  // Mirrors the ticket_handler_update RLS policy exactly — this only
  // controls whether the action buttons render; the database is the
  // real enforcement.
  const canAct = (t: SupportTicket): boolean => {
    if (role === 'super_admin') return true
    if (role === 'school_admin') return t.escalation_level === 'school' && t.school_id === schoolId
    if (role === 'group_admin') return t.escalation_level === 'group'
    return false
  }

  const escalateLabel = (t: SupportTicket): string | null => {
    if (role === 'school_admin' && t.escalation_level === 'school') {
      return t.group_id ? 'Escalate to Group Admin' : 'Escalate to Super Admin'
    }
    if (role === 'group_admin' && t.escalation_level === 'group') {
      return 'Escalate to Super Admin'
    }
    return null
  }

  const handleEscalate = (t: SupportTicket) => {
    const next = t.escalation_level === 'school' ? (t.group_id ? 'group' : 'platform') : 'platform'
    updateTicket.mutate({ escalation_level: next })
  }

  const handleReply = () => {
    if (!replyText.trim()) return
    sendReply.mutate(replyText.trim())
  }

  // ══════════════════════════════════════════════════════════
  // Detail / thread view
  // ══════════════════════════════════════════════════════════
  if (selectedTicket) {
    const acting = canAct(selectedTicket)
    const escLabel = escalateLabel(selectedTicket)

    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setSelectedId(null)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to tickets
        </Button>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedTicket.subject}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedTicket.submitter ? fullName(selectedTicket.submitter) : 'Unknown'}
                      {selectedTicket.school && <> · {selectedTicket.school.name}</>}
                      {' · '}{formatDateTime(selectedTicket.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={STATUS_BADGE[selectedTicket.status]}>{STATUS_LABEL[selectedTicket.status]}</Badge>
                    <Badge variant={PRIORITY_BADGE[selectedTicket.priority]}>{PRIORITY_LABEL[selectedTicket.priority]}</Badge>
                    <Badge variant="outline">{ESCALATION_LABEL[selectedTicket.escalation_level]}</Badge>
                  </div>
                </div>
                <p className="mt-3 text-sm whitespace-pre-wrap">{selectedTicket.description}</p>
              </CardContent>
            </Card>

            {/* Thread */}
            <Card>
              <CardContent className="p-4">
                {loadingMessages ? (
                  <div className="flex justify-center py-8"><Spinner /></div>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                    {messages.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">No replies yet.</p>
                    )}
                    {messages.map(m => {
                      const isMe = m.sender_id === profile?.id
                      return (
                        <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isMe ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            <p className="font-medium text-xs mb-0.5 opacity-80">
                              {m.sender ? fullName(m.sender) : 'Unknown'}
                            </p>
                            <p className="whitespace-pre-wrap">{m.message}</p>
                            <p className="text-[10px] mt-1 opacity-60">{timeAgo(m.created_at)}</p>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Textarea
                    placeholder="Write a reply…"
                    rows={2}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleReply()
                      }
                    }}
                  />
                  <Button onClick={handleReply} disabled={sendReply.isPending || !replyText.trim()}>
                    {sendReply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar controls */}
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <h3 className="text-sm font-semibold">Ticket Details</h3>
                <div className="text-sm space-y-1.5">
                  <p className="text-muted-foreground">Category</p>
                  <p className="font-medium">{CATEGORY_LABEL[selectedTicket.category]}</p>
                </div>

                {acting && selectedTicket.submitter?.email && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => sendPasswordReset.mutate()}
                    disabled={sendPasswordReset.isPending}
                  >
                    {sendPasswordReset.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-2 h-3.5 w-3.5" />}
                    Send Password Reset Email
                  </Button>
                )}

                <div className="text-sm space-y-1.5">
                  <p className="text-muted-foreground">Assigned to</p>
                  {selectedTicket.assignee ? (
                    <p className="font-medium">
                      {fullName(selectedTicket.assignee)}
                      {selectedTicket.assignee.id === profile?.id && ' (you)'}
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic">Unassigned</p>
                  )}
                  {acting && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => updateTicket.mutate({ assigned_to: selectedTicket.assignee?.id === profile?.id ? null : (profile?.id ?? null) })}
                      disabled={updateTicket.isPending}
                    >
                      {selectedTicket.assignee?.id === profile?.id ? 'Unassign myself' : 'Assign to me'}
                    </Button>
                  )}
                </div>

                {acting ? (
                  <>
                    <FormField label="Status" htmlFor="status-select">
                      <Select
                        value={selectedTicket.status}
                        onValueChange={(v) => updateTicket.mutate({ status: v as TicketStatus })}
                      >
                        <SelectTrigger id="status-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS_LABEL) as TicketStatus[]).map(s => (
                            <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Priority" htmlFor="priority-select">
                      <Select
                        value={selectedTicket.priority}
                        onValueChange={(v) => updateTicket.mutate({ priority: v as TicketPriority })}
                      >
                        <SelectTrigger id="priority-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map(p => (
                            <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    {escLabel && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => handleEscalate(selectedTicket)}
                        disabled={updateTicket.isPending}
                      >
                        <ArrowUpCircle className="mr-2 h-4 w-4" /> {escLabel}
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {selectedTicket.escalation_level === 'platform'
                      ? 'This ticket is with the platform team.'
                      : 'This ticket has moved beyond your level and is read-only for you now — you can still reply.'}
                  </p>
                )}

                {(selectedTicket.resolved_at || selectedTicket.closed_at) && (
                  <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                    {selectedTicket.resolved_at && <p>Resolved {formatDateTime(selectedTicket.resolved_at)}</p>}
                    {selectedTicket.closed_at && <p>Closed {formatDateTime(selectedTicket.closed_at)}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // List view
  // ══════════════════════════════════════════════════════════
  return (
    <div>
      <PageHeader
        title="Support Tickets"
        description={
          role === 'teacher' || role === 'school_admin'
            ? 'Get help from your school admin, or reach the CA-Wizard team'
            : 'Tickets currently routed to you'
        }
        action={canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Button>
        ) : undefined}
      />

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tickets…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="sm:w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                {(Object.keys(STATUS_LABEL) as TicketStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="date-from" className="text-xs text-muted-foreground shrink-0">From</label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="date-to" className="text-xs text-muted-foreground shrink-0">To</label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
              >
                Clear dates
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loadingTickets ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="h-10 w-10" />}
          title="No tickets"
          description={canCreate ? 'Nothing here yet — open a ticket if you need help.' : 'Nothing currently routed to you.'}
          action={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Ticket</Button> : undefined}
        />
      ) : (
        <div className="space-y-2">
          {paginated.map(t => (
            <Card key={t.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setSelectedId(t.id)}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {t.school && (role === 'group_admin' || role === 'super_admin') && (
                        <span className="inline-flex items-center gap-1"><SchoolIcon className="h-3 w-3" />{t.school.name}</span>
                      )}
                      {t.submitter && (role === 'school_admin' || role === 'group_admin' || role === 'super_admin') && (
                        <span>{fullName(t.submitter)}</span>
                      )}
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(t.created_at)}</span>
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Badge variant={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge variant={PRIORITY_BADGE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
              <p>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <span>Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create Ticket ─────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Support Ticket</DialogTitle>
            <DialogDescription>
              {role === 'teacher'
                ? 'Your school admin will see this first.'
                : "This goes straight to the CA-Wizard platform team."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => createTicket.mutate(d))} className="space-y-4">
            <FormField label="Subject" required error={errors.subject?.message} htmlFor="ticket-subject">
              <Input id="ticket-subject" placeholder="Short summary of the issue" {...register('subject')} />
            </FormField>
            <FormField label="Description" required error={errors.description?.message} htmlFor="ticket-description">
              <Textarea id="ticket-description" rows={4} placeholder="What's going on? Include any steps to reproduce." {...register('description')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Category" htmlFor="ticket-category">
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ticket-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map(c => (
                          <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField label="Priority" htmlFor="ticket-priority">
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ticket-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map(p => (
                          <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || createTicket.isPending}>
                {createTicket.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Ticket'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
