import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, ChevronDown, ChevronUp,
  Lock, Unlock, BookOpen, CheckCircle, Star, Trash2, Pencil
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { notifyManyUsers } from '@/lib/notifications'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import type { Session, Term, TermName } from '@/types'

// ─── Schemas ────────────────────────────────────────────────

const sessionSchema = z.object({
  name:       z.string().min(1, 'Required (e.g. 2025/2026)'),
  start_year: z.coerce.number().min(2000).max(2100),
  end_year:   z.coerce.number().min(2000).max(2100)
}).refine(d => d.end_year === d.start_year + 1, {
  message: 'End year must be start year + 1',
  path: ['end_year']
})

const termSchema = z.object({
  name:       z.enum(['First Term', 'Second Term', 'Third Term']),
  start_date: z.string().optional(),
  end_date:   z.string().optional()
})

type SessionForm = z.infer<typeof sessionSchema>
type TermForm    = z.infer<typeof termSchema>

// ─── API ────────────────────────────────────────────────────

async function fetchSessions(schoolId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('school_id', schoolId)
    .order('start_year', { ascending: false })
  if (error) throw error
  return data as Session[]
}

async function fetchTerms(schoolId: string) {
  const { data, error } = await supabase
    .from('terms')
    .select('*')
    .eq('school_id', schoolId)
    .order('name')
  if (error) throw error
  return data as Term[]
}

// ─── Component ──────────────────────────────────────────────

const TERM_NAMES: TermName[] = ['First Term', 'Second Term', 'Third Term']

export default function SessionsPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [sessionDialog, setSessionDialog] = useState(false)
  const [termDialog, setTermDialog]     = useState<{ sessionId: string; name: TermName } | null>(null)
  const [editingTerm, setEditingTerm]   = useState<Term | null>(null)
  const [setCurrentConfirm, setSetCurrentConfirm] = useState<Session | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [deleteTermTarget, setDeleteTermTarget] = useState<Term | null>(null)
  const [editTermTarget, setEditTermTarget] = useState<Term | null>(null)
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')

  const { data: sessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions', schoolId],
    queryFn: () => fetchSessions(schoolId!),
    enabled: !!schoolId
  })

  const { data: allTerms = [] } = useQuery({
    queryKey: ['terms', schoolId],
    queryFn: () => fetchTerms(schoolId!),
    enabled: !!schoolId
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sessions', schoolId] })
    qc.invalidateQueries({ queryKey: ['terms', schoolId] })
    qc.invalidateQueries({ queryKey: ['school-dashboard', schoolId] })
  }

  // Session form
  const sessionForm = useForm<SessionForm>({ resolver: zodResolver(sessionSchema) })

  const createSession = useMutation({
    mutationFn: async (values: SessionForm) => {
      const { data, error } = await supabase.from('sessions').insert({ ...values, school_id: schoolId }).select().single()
      if (error) throw error
      return data as Session
    },
    onSuccess: (data) => {
      invalidate(); setSessionDialog(false); sessionForm.reset()
      toast.success('Session created — terms and classes carried over from the previous session')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'session', entityId: data.id, newValue: { name: data.name } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const setCurrentSession = useMutation({
    mutationFn: async (sessionId: string) => {
      // Unset all current sessions first
      await supabase.from('sessions').update({ is_current: false }).eq('school_id', schoolId!)
      const { error } = await supabase.from('sessions').update({ is_current: true }).eq('id', sessionId)
      if (error) throw error
      return sessionId
    },
    onSuccess: (sessionId) => {
      invalidate(); setSetCurrentConfirm(null); toast.success('Current session updated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'session', entityId: sessionId, newValue: { is_current: true } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // The real safety guarantee here is the DB trigger from migration 013
  // (prevent_unsafe_session_delete) — it blocks deleting any session that
  // still has terms or classes under it, full stop, regardless of what
  // this UI does. The client-side check below (disabling the button when
  // terms.length > 0) is just a courtesy to avoid a wasted round trip for
  // the common case; a session with zero terms but existing classes still
  // reaches the server and gets the trigger's own clear error message
  // surfaced directly via e.message.
  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sessions').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidate(); setDeleteTarget(null); toast.success('Session deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'session', entityId: id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('still has terms or classes')
        ? e.message
        : e.message.includes('foreign key')
          ? 'This session has records depending on it and cannot be deleted.'
          : e.message
    )
  })

  // Term form
  const termForm = useForm<TermForm>({ resolver: zodResolver(termSchema) })

  const createTerm = useMutation({
    mutationFn: async (values: TermForm & { session_id: string }) => {
      const { data, error } = await supabase.from('terms').insert({
        ...values, school_id: schoolId, is_current: false, is_published: false, is_locked: false
      }).select().single()
      if (error) throw error
      return data as Term
    },
    onSuccess: (data) => {
      invalidate(); setTermDialog(null); termForm.reset(); toast.success('Term created')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'term', entityId: data.id, newValue: { name: data.name } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const updateTerm = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Term> }) => {
      const { error } = await supabase.from('terms').update(data).eq('id', id)
      if (error) throw error
      return { id, data }
    },
    onSuccess: async ({ id, data }) => {
      invalidate(); toast.success('Term updated')
      // Lock/publish toggles are common enough state changes on a term
      // to warrant their own audit action types rather than a generic UPDATE
      const action = 'is_locked' in data ? (data.is_locked ? 'LOCK' : 'UNLOCK')
        : 'is_published' in data && data.is_published ? 'PUBLISH'
        : 'UPDATE'
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action, entityType: 'term', entityId: id, newValue: data })

      // Notify every teacher in the school when a term locks or
      // publishes — the two events that actually change what a teacher
      // can/should do next. Unlock and other field edits stay silent to
      // avoid notification noise.
      const isLockEvent = 'is_locked' in data && data.is_locked
      const isPublishEvent = 'is_published' in data && data.is_published
      if (isLockEvent || isPublishEvent) {
        const termName = allTerms.find(t => t.id === id)?.name ?? 'This term'
        const { data: teachers } = await supabase.from('profiles').select('id').eq('school_id', schoolId!).eq('role', 'teacher')
        if (teachers && teachers.length > 0) {
          notifyManyUsers(teachers.map(t => t.id), {
            schoolId: schoolId!,
            type: isLockEvent ? 'term_locked' : 'term_published',
            title: isLockEvent ? `${termName} has been locked` : `${termName} results are published`,
            body: isLockEvent
              ? 'Grade entry is now closed for this term.'
              : 'Report cards and broadsheets for this term are now visible to students and parents.',
            linkPath: '/school/reports'
          })
        }
      }
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // The real guarantee here is migration 019's prevent_unsafe_term_delete
  // trigger — same reasoning as session deletion: this client-side check
  // is a courtesy, not the security boundary. A term with any recorded
  // scores/attendance/comments/snapshots can't be deleted regardless of
  // what this UI does; the trigger's own message surfaces directly.
  const deleteTerm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('terms').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidate(); setDeleteTermTarget(null); toast.success('Term deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'term', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const updateTermDates = useMutation({
    mutationFn: async ({ id, start_date, end_date }: { id: string; start_date: string; end_date: string }) => {
      const { error } = await supabase.from('terms').update({
        start_date: start_date || null,
        end_date: end_date || null
      }).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidate(); setEditTermTarget(null); toast.success('Term dates updated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'term', entityId: id, newValue: { start_date: editStartDate, end_date: editEndDate } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const setCurrentTerm = useMutation({
    mutationFn: async ({ termId, schoolId }: { termId: string; schoolId: string }) => {
      await supabase.from('terms').update({ is_current: false }).eq('school_id', schoolId)
      const { error } = await supabase.from('terms').update({ is_current: true }).eq('id', termId)
      if (error) throw error
      return termId
    },
    onSuccess: (termId) => {
      invalidate(); toast.success('Current term set')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'term', entityId: termId, newValue: { is_current: true } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const onCreateSession = sessionForm.handleSubmit(values => createSession.mutate(values))

  const onCreateTerm = termForm.handleSubmit(values => {
    if (!termDialog) return
    createTerm.mutate({ ...values, session_id: termDialog.sessionId, name: termDialog.name })
  })

  const openEditTerm = (term: Term) => {
    setEditStartDate(term.start_date ?? '')
    setEditEndDate(term.end_date ?? '')
    setEditTermTarget(term)
  }

  const termsForSession = (sessionId: string) =>
    allTerms.filter(t => t.session_id === sessionId)

  const termExists = (sessionId: string, name: TermName) =>
    allTerms.some(t => t.session_id === sessionId && t.name === name)

  return (
    <div>
      <PageHeader
        title="Sessions & Terms"
        description="Manage academic sessions and their terms"
        action={
          <Button onClick={() => setSessionDialog(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Session
          </Button>
        }
      />

      {loadingSessions ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title="No sessions yet"
          description="Create your first academic session to get started"
          action={<Button onClick={() => setSessionDialog(true)}><Plus className="mr-2 h-4 w-4" />New Session</Button>}
        />
      ) : (
        <div className="space-y-4">
          {sessions.map(session => {
            const isExpanded = expanded === session.id
            const terms = termsForSession(session.id)

            return (
              <Card key={session.id} className={session.is_current ? 'border-brand-400 ring-1 ring-brand-300' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{session.name}</CardTitle>
                          {session.is_current && <Badge variant="default">Current</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {session.start_year} / {session.end_year} · {terms.length}/3 terms created
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!session.is_current && (
                        <Button size="sm" variant="outline" onClick={() => setSetCurrentConfirm(session)}>
                          <Star className="mr-1 h-3 w-3" /> Set Current
                        </Button>
                      )}
                      {profile?.role === 'school_admin' && !session.is_current && (
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={terms.length > 0}
                          title={terms.length > 0 ? 'Remove this session\'s terms first' : 'Delete session'}
                          aria-label={`Delete ${session.name}`}
                          onClick={() => setDeleteTarget(session)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setExpanded(isExpanded ? null : session.id)}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="border-t pt-4 space-y-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Terms</p>
                      {TERM_NAMES.map(termName => {
                        const term = terms.find(t => t.name === termName)
                        const exists = !!term

                        return (
                          <div key={termName} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3">
                            <div className="flex items-center gap-3">
                              <div className={`h-2 w-2 rounded-full shrink-0 ${exists ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                              <div>
                                <p className="text-sm font-medium">{termName}</p>
                                {term && (
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {term.is_current   && <Badge variant="info"        className="text-xs">Current</Badge>}
                                    {term.is_locked    && <Badge variant="warning"     className="text-xs">Locked</Badge>}
                                    {term.is_published && <Badge variant="success"     className="text-xs">Published</Badge>}
                                    {term.start_date   && <span className="text-xs text-muted-foreground">{formatDate(term.start_date)} – {formatDate(term.end_date ?? '')}</span>}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                              {!exists ? (
                                <Button size="sm" variant="outline" onClick={() => {
                                  termForm.setValue('name', termName)
                                  setTermDialog({ sessionId: session.id, name: termName })
                                }}>
                                  <Plus className="mr-1 h-3 w-3" /> Create
                                </Button>
                              ) : (
                                <>
                                  {/* Only offered when this term's session is ALSO the
                                      current session — migration 019's trigger enforces
                                      this server-side regardless, this is just the UI
                                      not offering an action that would be rejected. */}
                                  {!term.is_current && session.is_current && (
                                    <Button size="sm" variant="outline"
                                      onClick={() => setCurrentTerm.mutate({ termId: term.id, schoolId: schoolId! })}>
                                      Set Current
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={() => openEditTerm(term)}>
                                    <Pencil className="mr-1 h-3 w-3" /> Dates
                                  </Button>
                                  <Button size="sm" variant="outline"
                                    onClick={() => updateTerm.mutate({ id: term.id, data: { is_locked: !term.is_locked, locked_at: !term.is_locked ? new Date().toISOString() : null } })}>
                                    {term.is_locked
                                      ? <><Unlock className="mr-1 h-3 w-3" />Unlock</>
                                      : <><Lock   className="mr-1 h-3 w-3" />Lock</>}
                                  </Button>
                                  <Button size="sm"
                                    variant={term.is_published ? 'secondary' : 'default'}
                                    onClick={() => updateTerm.mutate({ id: term.id, data: { is_published: !term.is_published, published_at: !term.is_published ? new Date().toISOString() : null } })}>
                                    {term.is_published
                                      ? 'Unpublish'
                                      : <><CheckCircle className="mr-1 h-3 w-3" />Publish</>}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete ${termName}`}
                                    onClick={() => setDeleteTermTarget(term)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Session Dialog */}
      <Dialog open={sessionDialog} onOpenChange={setSessionDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Academic Session</DialogTitle>
            <DialogDescription>e.g. 2025/2026</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateSession} className="space-y-4">
            <FormField label="Session Name" error={sessionForm.formState.errors.name?.message} required htmlFor="sname">
              <Input id="sname" placeholder="2025/2026" {...sessionForm.register('name')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Start Year" error={sessionForm.formState.errors.start_year?.message} required htmlFor="sy">
                <Input id="sy" type="number" placeholder="2025" {...sessionForm.register('start_year')} />
              </FormField>
              <FormField label="End Year" error={sessionForm.formState.errors.end_year?.message} required htmlFor="ey">
                <Input id="ey" type="number" placeholder="2026" {...sessionForm.register('end_year')} />
              </FormField>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSessionDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={createSession.isPending}>
                {createSession.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Term Dialog */}
      <Dialog open={!!termDialog} onOpenChange={open => !open && setTermDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create {termDialog?.name}</DialogTitle>
            <DialogDescription>Optionally set start and end dates</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateTerm} className="space-y-4">
            <FormGrid cols={2}>
              <FormField label="Start Date" htmlFor="tsd">
                <Input id="tsd" type="date" {...termForm.register('start_date')} />
              </FormField>
              <FormField label="End Date" htmlFor="ted">
                <Input id="ted" type="date" {...termForm.register('end_date')} />
              </FormField>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTermDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={createTerm.isPending}>
                {createTerm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Term
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Term Dates Dialog */}
      <Dialog open={!!editTermTarget} onOpenChange={open => !open && setEditTermTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTermTarget?.name} Dates</DialogTitle>
            <DialogDescription>Set or update the start and end dates for this term</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => {
            e.preventDefault()
            if (editTermTarget) updateTermDates.mutate({ id: editTermTarget.id, start_date: editStartDate, end_date: editEndDate })
          }} className="space-y-4">
            <FormGrid cols={2}>
              <FormField label="Start Date" htmlFor="etsd">
                <Input id="etsd" type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} />
              </FormField>
              <FormField label="End Date" htmlFor="eted">
                <Input id="eted" type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} />
              </FormField>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTermTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={updateTermDates.isPending}>
                {updateTermDates.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Term Confirm */}
      <AlertDialog open={!!deleteTermTarget} onOpenChange={open => !open && setDeleteTermTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTermTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This only succeeds if the term has no recorded scores, attendance, comments, or saved snapshots.
              If it does, those records must be removed first, or leave this term as historical record instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTerm.isPending}
              onClick={() => deleteTermTarget && deleteTerm.mutate(deleteTermTarget.id)}
            >
              {deleteTerm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Set Current Confirm */}
      <AlertDialog open={!!setCurrentConfirm} onOpenChange={open => !open && setSetCurrentConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set {setCurrentConfirm?.name} as current session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update the active session for all users in your school.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setCurrentConfirm && setCurrentSession.mutate(setCurrentConfirm.id)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the session record. It only succeeds if the session has no terms or
              classes under it — if it does, remove those first or leave this session as historical record instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSession.isPending}
              onClick={() => deleteTarget && deleteSession.mutate(deleteTarget.id)}
            >
              {deleteSession.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
