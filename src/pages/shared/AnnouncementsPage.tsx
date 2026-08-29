import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, Megaphone, Pin, Archive, Trash2, Users, Eye
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { notifyManyUsers } from '@/lib/notifications'
import { timeAgo, fullName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { Announcement, School, AdminGroup } from '@/types'

const ALL_SCHOOLS = '__all__'
const CUSTOM = '__custom__'

const composeSchema = z.object({
  title: z.string().min(4, 'Give it a short, clear title'),
  body: z.string().min(10, 'Add a bit more detail'),
  audienceMode: z.string()
})
type ComposeFormData = z.infer<typeof composeSchema>

export default function AnnouncementsPage() {
  const { profile, role, schoolId } = useAuth()
  const qc = useQueryClient()
  const isSender = role === 'super_admin' || role === 'group_admin'

  const [composeOpen, setComposeOpen] = useState(false)
  const [selectedSchoolIds, setSelectedSchoolIds] = useState<Set<string>>(new Set())
  const [archiveTarget, setArchiveTarget] = useState<Announcement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [statsFor, setStatsFor] = useState<Announcement | null>(null)

  const { register, handleSubmit, control, watch, reset, formState: { errors, isSubmitting } } = useForm<ComposeFormData>({
    resolver: zodResolver(composeSchema),
    defaultValues: { audienceMode: role === 'group_admin' ? ALL_SCHOOLS : ALL_SCHOOLS }
  })
  const audienceMode = watch('audienceMode')

  // ── Data: my group (group_admin only) ───────────────────────
  const { data: myGroup } = useQuery({
    queryKey: ['my-admin-group-announcements', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_groups')
        .select('*')
        .eq('group_admin_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data as AdminGroup | null
    },
    enabled: role === 'group_admin' && !!profile?.id
  })

  // ── Data: schools available to target ────────────────────────
  const { data: allSchools = [] } = useQuery({
    queryKey: ['schools-for-announcements', role, myGroup?.id],
    queryFn: async () => {
      let query = supabase.from('schools').select('id, name').order('name')
      if (role === 'group_admin' && myGroup) query = query.eq('group_id', myGroup.id)
      const { data, error } = await query
      if (error) throw error
      return data as Pick<School, 'id' | 'name'>[]
    },
    enabled: role === 'super_admin' || (role === 'group_admin' && !!myGroup)
  })

  // ── Data: groups (super_admin only, for the "specific group" option) ──
  const { data: groups = [] } = useQuery({
    queryKey: ['admin-groups-for-announcements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('admin_groups').select('id, name').order('name')
      if (error) throw error
      return data as Pick<AdminGroup, 'id' | 'name'>[]
    },
    enabled: role === 'super_admin'
  })

  // ── Data: announcements feed/list ────────────────────────────
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements', profile?.id],
    queryFn: async () => {
      if (isSender) {
        const { data, error } = await supabase
          .from('announcements')
          .select('*, targets:announcement_targets(id), reads:announcement_reads(id)')
          .eq('created_by', profile!.id)
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
        if (error) throw error
        return (data as Array<Announcement & { targets: { id: string }[]; reads: { id: string }[] }>).map(a => ({
          ...a,
          target_count: a.targets?.length ?? 0,
          read_count: a.reads?.length ?? 0
        }))
      } else {
        const { data, error } = await supabase
          .from('announcements')
          .select('*, creator:profiles(*), reads:announcement_reads(profile_id)')
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
        if (error) throw error
        return (data as Array<Announcement & { reads: { profile_id: string }[] }>).map(a => ({
          ...a,
          is_read: a.reads?.some(r => r.profile_id === profile!.id) ?? false
        }))
      }
    },
    enabled: !!profile
  })

  const unreadCount = useMemo(
    () => (!isSender ? announcements.filter(a => !a.is_read).length : 0),
    [announcements, isSender]
  )

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['announcements'] })

  // ── Mark read (school_admin only) ────────────────────────────
  const markRead = useMutation({
    mutationFn: async (announcementId: string) => {
      const { error } = await supabase
        .from('announcement_reads')
        .insert({ announcement_id: announcementId, profile_id: profile!.id })
      // A duplicate (already read) is fine — unique constraint, not a real error.
      if (error && !error.message.includes('duplicate')) throw error
    },
    onSuccess: invalidateAll
  })

  // ── Compose / send ────────────────────────────────────────────
  const sendAnnouncement = useMutation({
    mutationFn: async (data: ComposeFormData) => {
      let targetSchoolIds: string[]
      let audienceLabel: string

      if (data.audienceMode === ALL_SCHOOLS) {
        targetSchoolIds = allSchools.map(s => s.id)
        audienceLabel = role === 'group_admin' ? 'My Group' : 'All Schools'
      } else if (data.audienceMode === CUSTOM) {
        targetSchoolIds = Array.from(selectedSchoolIds)
        audienceLabel = `${targetSchoolIds.length} School${targetSchoolIds.length !== 1 ? 's' : ''}`
      } else {
        // super_admin picked a specific group id
        const { data: groupSchools, error: gsErr } = await supabase
          .from('schools')
          .select('id')
          .eq('group_id', data.audienceMode)
        if (gsErr) throw gsErr
        targetSchoolIds = (groupSchools ?? []).map(s => s.id)
        audienceLabel = groups.find(g => g.id === data.audienceMode)?.name ?? 'Group'
      }

      if (targetSchoolIds.length === 0) throw new Error('Select at least one school to send to')

      const { data: announcement, error: annErr } = await supabase
        .from('announcements')
        .insert({ created_by: profile!.id, title: data.title, body: data.body, audience_label: audienceLabel })
        .select()
        .single()
      if (annErr) throw annErr

      const { error: targetErr } = await supabase
        .from('announcement_targets')
        .insert(targetSchoolIds.map(school_id => ({ announcement_id: announcement.id, school_id })))
      if (targetErr) throw targetErr

      // Best-effort in-app notification fan-out, grouped by school
      // since notifyManyUsers takes one schoolId per call.
      const { data: admins } = await supabase
        .from('profiles')
        .select('id, school_id')
        .eq('role', 'school_admin')
        .in('school_id', targetSchoolIds)

      const bySchool = new Map<string, string[]>()
      for (const a of admins ?? []) {
        if (!a.school_id) continue
        bySchool.set(a.school_id, [...(bySchool.get(a.school_id) ?? []), a.id])
      }
      await Promise.all(
        Array.from(bySchool.entries()).map(([sid, recipientIds]) =>
          notifyManyUsers(recipientIds, {
            schoolId: sid,
            type: 'announcement_published',
            title: data.title,
            body: data.body.length > 140 ? `${data.body.slice(0, 140)}…` : data.body,
            linkPath: '/school/announcements'
          })
        )
      )

      return announcement as Announcement
    },
    onSuccess: (row) => {
      logAudit({ schoolId: null, userId: profile?.id ?? null, action: 'CREATE', entityType: 'announcement', entityId: row.id, newValue: { title: row.title } })
      toast.success('Announcement sent')
      setComposeOpen(false)
      setSelectedSchoolIds(new Set())
      reset()
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Pin / archive / delete ───────────────────────────────────
  const togglePin = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase.from('announcements').update({ pinned: !a.pinned }).eq('id', a.id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
    onError: (err: Error) => toast.error(err.message)
  })

  const archiveAnnouncement = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase.from('announcements').update({ is_active: false }).eq('id', a.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Announcement archived')
      setArchiveTarget(null)
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const deleteAnnouncement = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase.from('announcements').delete().eq('id', a.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Announcement deleted')
      setDeleteTarget(null)
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const toggleSchool = (id: string) => {
    setSelectedSchoolIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        description={
          isSender
            ? 'One-way broadcasts to school admins — they can read but not reply'
            : unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up"
        }
        action={isSender ? (
          <Button onClick={() => setComposeOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Announcement
          </Button>
        ) : undefined}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-10 w-10" />}
          title="No announcements"
          description={isSender ? 'Send your first announcement to keep schools in the loop.' : "Nothing's been sent your way yet."}
          action={isSender ? <Button onClick={() => setComposeOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Announcement</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {announcements.map(a => (
            <Card
              key={a.id}
              className={!isSender && !a.is_read ? 'border-primary/50 bg-primary/5' : undefined}
              onClick={() => { if (!isSender && !a.is_read) markRead.mutate(a.id) }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.pinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
                      <p className="font-semibold">{a.title}</p>
                      {!isSender && !a.is_read && <Badge variant="info">New</Badge>}
                      {!a.is_active && <Badge variant="secondary">Archived</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{a.body}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {isSender ? a.audience_label : (a.creator ? fullName(a.creator) : 'CA-Wizard Team')}
                      {' · '}{timeAgo(a.created_at)}
                    </p>
                  </div>

                  {isSender && (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); setStatsFor(a) }}
                      >
                        <Eye className="h-3.5 w-3.5" /> {a.read_count ?? 0}/{a.target_count ?? 0} read
                      </button>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title={a.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); togglePin.mutate(a) }}>
                          <Pin className={`h-4 w-4 ${a.pinned ? 'fill-current text-primary' : ''}`} />
                        </Button>
                        {a.is_active && (
                          <Button variant="ghost" size="icon" title="Archive" onClick={(e) => { e.stopPropagation(); setArchiveTarget(a) }}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget(a) }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Compose ────────────────────────────────────────── */}
      <Dialog open={composeOpen} onOpenChange={(o) => { setComposeOpen(o); if (!o) setSelectedSchoolIds(new Set()) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
            <DialogDescription>School admins will see this — they can't reply here.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => sendAnnouncement.mutate(d))} className="space-y-4">
            <FormField label="Title" required error={errors.title?.message} htmlFor="ann-title">
              <Input id="ann-title" placeholder="What's this about?" {...register('title')} />
            </FormField>
            <FormField label="Message" required error={errors.body?.message} htmlFor="ann-body">
              <Textarea id="ann-body" rows={4} placeholder="Write your announcement…" {...register('body')} />
            </FormField>

            <FormField label="Send to" htmlFor="ann-audience">
              <Controller
                control={control}
                name="audienceMode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="ann-audience"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SCHOOLS}>{role === 'group_admin' ? 'All my schools' : 'All Schools'}</SelectItem>
                      {role === 'super_admin' && groups.map(g => (
                        <SelectItem key={g.id} value={g.id}>Group: {g.name}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM}>Choose specific schools…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            {audienceMode === CUSTOM && (
              <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
                {allSchools.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">No schools available.</p>
                ) : (
                  allSchools.map(s => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent cursor-pointer text-sm">
                      <Checkbox checked={selectedSchoolIds.has(s.id)} onCheckedChange={() => toggleSchool(s.id)} />
                      {s.name}
                    </label>
                  ))
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || sendAnnouncement.isPending}>
                {sendAnnouncement.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Read stats ─────────────────────────────────────── */}
      <Dialog open={!!statsFor} onOpenChange={(o) => { if (!o) setStatsFor(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statsFor?.title}</DialogTitle>
            <DialogDescription>
              <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Sent to {statsFor?.audience_label}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted/50 p-4 text-center">
            <p className="text-2xl font-bold">{statsFor?.read_count ?? 0} / {statsFor?.target_count ?? 0}</p>
            <p className="text-sm text-muted-foreground mt-1">school admins have read this</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatsFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive confirm ───────────────────────────────────── */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => { if (!o) setArchiveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{archiveTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>It'll stop showing in school admins' feeds, but stays in your sent list.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveTarget && archiveAnnouncement.mutate(archiveTarget)}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirm ────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (deleteTarget.read_count ?? 0) > 0 ? (
                <>
                  <span className="font-medium text-destructive">
                    {deleteTarget.read_count} of {deleteTarget.target_count ?? 0} school admin{deleteTarget.target_count !== 1 ? 's have' : ' has'} already read this.
                  </span>{' '}
                  Deleting removes it — and their read history — for good. If you just want it off school admins' feeds but want to keep the record, archive it instead.
                </>
              ) : (
                'This cannot be undone, including its read receipts.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteTarget && (deleteTarget.read_count ?? 0) > 0 && deleteTarget.is_active && (
              <Button
                variant="outline"
                onClick={() => { archiveAnnouncement.mutate(deleteTarget); setDeleteTarget(null) }}
              >
                Archive instead
              </Button>
            )}
            <AlertDialogAction onClick={() => deleteTarget && deleteAnnouncement.mutate(deleteTarget)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
