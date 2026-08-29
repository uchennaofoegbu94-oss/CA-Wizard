import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, Users, Clock3, Quote, Pencil, Trash2, ImagePlus,
  ChevronUp, ChevronDown, Star
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { uploadTeamMemberPhoto, uploadTestimonialPhoto } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import type { TeamMember, HistoryEvent, Testimonial } from '@/types'

// ── Schemas ──────────────────────────────────────────────────
const teamSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  role_title: z.string().min(2, 'Role/title is required'),
  bio: z.string().max(500, 'Keep it under 500 characters').optional(),
  linkedin_url: z.string().url('Enter a full URL').or(z.literal('')).optional(),
  twitter_url: z.string().url('Enter a full URL').or(z.literal('')).optional()
})
type TeamFormData = z.infer<typeof teamSchema>

const historySchema = z.object({
  date_label: z.string().min(1, 'e.g. "2024" or "Q1 2025"'),
  title: z.string().min(2, 'Title is required'),
  description: z.string().max(500, 'Keep it under 500 characters').optional()
})
type HistoryFormData = z.infer<typeof historySchema>

const testimonialSchema = z.object({
  quote: z.string().min(10, 'Quote must be at least 10 characters'),
  author_name: z.string().min(2, 'Author name is required'),
  author_role: z.string().optional(),
  rating: z.string().optional()
})
type TestimonialFormData = z.infer<typeof testimonialSchema>

// ── Small shared bits ────────────────────────────────────────
function ReorderButtons({ onUp, onDown, disabledUp, disabledDown }: { onUp: () => void; onDown: () => void; disabledUp: boolean; disabledDown: boolean }) {
  return (
    <div className="flex flex-col">
      <Button variant="ghost" size="icon" className="h-5 w-6" onClick={onUp} disabled={disabledUp} title="Move up">
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-5 w-6" onClick={onDown} disabled={disabledDown} title="Move down">
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export default function CompanyContentPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  return (
    <div>
      <PageHeader
        title="Company Content"
        description="Meet the Team, History, and Testimonials — each shown on the public site only if it has entries"
      />
      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team"><Users className="mr-1.5 h-4 w-4" /> Team</TabsTrigger>
          <TabsTrigger value="history"><Clock3 className="mr-1.5 h-4 w-4" /> History</TabsTrigger>
          <TabsTrigger value="testimonials"><Quote className="mr-1.5 h-4 w-4" /> Testimonials</TabsTrigger>
        </TabsList>
        <TabsContent value="team"><TeamTab profileId={profile?.id ?? null} qc={qc} /></TabsContent>
        <TabsContent value="history"><HistoryTab profileId={profile?.id ?? null} qc={qc} /></TabsContent>
        <TabsContent value="testimonials"><TestimonialsTab profileId={profile?.id ?? null} qc={qc} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Team
// ════════════════════════════════════════════════════════════
function TeamTab({ profileId, qc }: { profileId: string | null; qc: ReturnType<typeof useQueryClient> }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TeamFormData>({
    resolver: zodResolver(teamSchema)
  })

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').order('display_order')
      if (error) throw error
      return data as TeamMember[]
    }
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['team-members-admin'] })

  const openCreate = () => {
    setEditing(null); setPhotoFile(null); setPhotoPreview(null)
    reset({ name: '', role_title: '', bio: '', linkedin_url: '', twitter_url: '' })
    setDialogOpen(true)
  }
  const openEdit = (m: TeamMember) => {
    setEditing(m); setPhotoFile(null); setPhotoPreview(m.photo_url)
    reset({ name: m.name, role_title: m.role_title, bio: m.bio ?? '', linkedin_url: m.linkedin_url ?? '', twitter_url: m.twitter_url ?? '' })
    setDialogOpen(true)
  }

  const save = useMutation({
    mutationFn: async (data: TeamFormData) => {
      const payload = {
        name: data.name,
        role_title: data.role_title,
        bio: data.bio || null,
        linkedin_url: data.linkedin_url || null,
        twitter_url: data.twitter_url || null
      }
      let id = editing?.id
      if (editing) {
        const { error } = await supabase.from('team_members').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const maxOrder = members.reduce((m, x) => Math.max(m, x.display_order), -1)
        const { data: row, error } = await supabase.from('team_members').insert({ ...payload, display_order: maxOrder + 1 }).select().single()
        if (error) throw error
        id = row.id
      }
      if (photoFile && id) {
        setUploadingPhoto(true)
        const { url, error: upErr } = await uploadTeamMemberPhoto(id, photoFile)
        setUploadingPhoto(false)
        if (!upErr && url) await supabase.from('team_members').update({ photo_url: url }).eq('id', id)
      }
      return id
    },
    onSuccess: (id) => {
      logAudit({ schoolId: null, userId: profileId, action: editing ? 'UPDATE' : 'CREATE', entityType: 'team_member', entityId: id ?? null })
      toast.success(editing ? 'Team member updated' : 'Team member added')
      setDialogOpen(false)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const toggleActive = useMutation({
    mutationFn: async (m: TeamMember) => {
      const { error } = await supabase.from('team_members').update({ is_active: !m.is_active }).eq('id', m.id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message)
  })

  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: TeamMember; b: TeamMember }) => {
      await Promise.all([
        supabase.from('team_members').update({ display_order: b.display_order }).eq('id', a.id),
        supabase.from('team_members').update({ display_order: a.display_order }).eq('id', b.id)
      ])
    },
    onSuccess: invalidate
  })

  const remove = useMutation({
    mutationFn: async (m: TeamMember) => {
      const { error } = await supabase.from('team_members').delete().eq('id', m.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Removed'); setDeleteTarget(null); invalidate() },
    onError: (err: Error) => toast.error(err.message)
  })

  return (
    <div className="pt-4">
      <div className="flex justify-end mb-3">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add Team Member</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : members.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" />} title="No team members yet" description="Add your first team member — the public page just won't show this section until you do." />
      ) : (
        <div className="space-y-2">
          {members.map((m, i) => (
            <Card key={m.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <ReorderButtons
                  onUp={() => i > 0 && reorder.mutate({ a: m, b: members[i - 1] })}
                  onDown={() => i < members.length - 1 && reorder.mutate({ a: m, b: members[i + 1] })}
                  disabledUp={i === 0}
                  disabledDown={i === members.length - 1}
                />
                {m.photo_url ? (
                  <img src={m.photo_url} alt="" className="h-12 w-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{m.name}</p>
                    {!m.is_active && <Badge variant="secondary">Hidden</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{m.role_title}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={m.is_active} onCheckedChange={() => toggleActive.mutate(m)} aria-label="Visible on site" />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(m)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Team Member' : 'Add Team Member'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => save.mutate(d))} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {photoPreview ? <img src={photoPreview} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}>
                {uploadingPhoto ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-2 h-3.5 w-3.5" />}
                {photoPreview ? 'Replace photo' : 'Add photo'}
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0]; if (!f) return
                setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f))
              }} />
            </div>
            <FormField label="Name" required error={errors.name?.message} htmlFor="tm-name">
              <Input id="tm-name" {...register('name')} />
            </FormField>
            <FormField label="Role / Title" required error={errors.role_title?.message} htmlFor="tm-role">
              <Input id="tm-role" placeholder="e.g. Founder & CEO" {...register('role_title')} />
            </FormField>
            <FormField label="Bio" error={errors.bio?.message} htmlFor="tm-bio">
              <Textarea id="tm-bio" rows={3} {...register('bio')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="LinkedIn URL" error={errors.linkedin_url?.message} htmlFor="tm-linkedin">
                <Input id="tm-linkedin" placeholder="https://linkedin.com/in/…" {...register('linkedin_url')} />
              </FormField>
              <FormField label="Twitter/X URL" error={errors.twitter_url?.message} htmlFor="tm-twitter">
                <Input id="tm-twitter" placeholder="https://x.com/…" {...register('twitter_url')} />
              </FormField>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || save.isPending || uploadingPhoto}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save Changes' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// History
// ════════════════════════════════════════════════════════════
function HistoryTab({ profileId, qc }: { profileId: string | null; qc: ReturnType<typeof useQueryClient> }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<HistoryEvent | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HistoryEvent | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<HistoryFormData>({
    resolver: zodResolver(historySchema)
  })

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['history-events-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('history_events').select('*').order('display_order')
      if (error) throw error
      return data as HistoryEvent[]
    }
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['history-events-admin'] })

  const openCreate = () => { setEditing(null); reset({ date_label: '', title: '', description: '' }); setDialogOpen(true) }
  const openEdit = (e: HistoryEvent) => { setEditing(e); reset({ date_label: e.date_label, title: e.title, description: e.description ?? '' }); setDialogOpen(true) }

  const save = useMutation({
    mutationFn: async (data: HistoryFormData) => {
      const payload = { date_label: data.date_label, title: data.title, description: data.description || null }
      if (editing) {
        const { error } = await supabase.from('history_events').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const maxOrder = events.reduce((m, x) => Math.max(m, x.display_order), -1)
        const { error } = await supabase.from('history_events').insert({ ...payload, display_order: maxOrder + 1 })
        if (error) throw error
      }
    },
    onSuccess: () => {
      logAudit({ schoolId: null, userId: profileId, action: editing ? 'UPDATE' : 'CREATE', entityType: 'history_event', entityId: editing?.id ?? null })
      toast.success(editing ? 'Entry updated' : 'Entry added')
      setDialogOpen(false)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const toggleActive = useMutation({
    mutationFn: async (e: HistoryEvent) => {
      const { error } = await supabase.from('history_events').update({ is_active: !e.is_active }).eq('id', e.id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message)
  })

  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: HistoryEvent; b: HistoryEvent }) => {
      await Promise.all([
        supabase.from('history_events').update({ display_order: b.display_order }).eq('id', a.id),
        supabase.from('history_events').update({ display_order: a.display_order }).eq('id', b.id)
      ])
    },
    onSuccess: invalidate
  })

  const remove = useMutation({
    mutationFn: async (e: HistoryEvent) => {
      const { error } = await supabase.from('history_events').delete().eq('id', e.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Removed'); setDeleteTarget(null); invalidate() },
    onError: (err: Error) => toast.error(err.message)
  })

  return (
    <div className="pt-4">
      <div className="flex justify-end mb-3">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add Milestone</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon={<Clock3 className="h-10 w-10" />} title="No history entries yet" description="Add milestones as they happen — this section stays off the public page until there's at least one." />
      ) : (
        <div className="space-y-2">
          {events.map((e, i) => (
            <Card key={e.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <ReorderButtons
                  onUp={() => i > 0 && reorder.mutate({ a: e, b: events[i - 1] })}
                  onDown={() => i < events.length - 1 && reorder.mutate({ a: e, b: events[i + 1] })}
                  disabledUp={i === 0}
                  disabledDown={i === events.length - 1}
                />
                <Badge variant="outline" className="shrink-0">{e.date_label}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{e.title}</p>
                    {!e.is_active && <Badge variant="secondary">Hidden</Badge>}
                  </div>
                  {e.description && <p className="text-xs text-muted-foreground truncate">{e.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={e.is_active} onCheckedChange={() => toggleActive.mutate(e)} aria-label="Visible on site" />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Milestone' : 'Add Milestone'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => save.mutate(d))} className="space-y-4">
            <FormField label="Date" required error={errors.date_label?.message} htmlFor="he-date">
              <Input id="he-date" placeholder='e.g. "2024" or "Q1 2025"' {...register('date_label')} />
            </FormField>
            <FormField label="Title" required error={errors.title?.message} htmlFor="he-title">
              <Input id="he-title" {...register('title')} />
            </FormField>
            <FormField label="Description" error={errors.description?.message} htmlFor="he-description">
              <Textarea id="he-description" rows={3} {...register('description')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save Changes' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Testimonials
// ════════════════════════════════════════════════════════════
function TestimonialsTab({ profileId, qc }: { profileId: string | null; qc: ReturnType<typeof useQueryClient> }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Testimonial | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Testimonial | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TestimonialFormData>({
    resolver: zodResolver(testimonialSchema)
  })

  const { data: testimonials = [], isLoading } = useQuery({
    queryKey: ['testimonials-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('testimonials').select('*').order('display_order')
      if (error) throw error
      return data as Testimonial[]
    }
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['testimonials-admin'] })

  const openCreate = () => {
    setEditing(null); setPhotoFile(null); setPhotoPreview(null)
    reset({ quote: '', author_name: '', author_role: '', rating: '' })
    setDialogOpen(true)
  }
  const openEdit = (t: Testimonial) => {
    setEditing(t); setPhotoFile(null); setPhotoPreview(t.photo_url)
    reset({ quote: t.quote, author_name: t.author_name, author_role: t.author_role ?? '', rating: t.rating ? String(t.rating) : '' })
    setDialogOpen(true)
  }

  const save = useMutation({
    mutationFn: async (data: TestimonialFormData) => {
      const payload = {
        quote: data.quote,
        author_name: data.author_name,
        author_role: data.author_role || null,
        rating: data.rating ? Number(data.rating) : null
      }
      let id = editing?.id
      if (editing) {
        const { error } = await supabase.from('testimonials').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const maxOrder = testimonials.reduce((m, x) => Math.max(m, x.display_order), -1)
        const { data: row, error } = await supabase.from('testimonials').insert({ ...payload, display_order: maxOrder + 1 }).select().single()
        if (error) throw error
        id = row.id
      }
      if (photoFile && id) {
        setUploadingPhoto(true)
        const { url, error: upErr } = await uploadTestimonialPhoto(id, photoFile)
        setUploadingPhoto(false)
        if (!upErr && url) await supabase.from('testimonials').update({ photo_url: url }).eq('id', id)
      }
      return id
    },
    onSuccess: (id) => {
      logAudit({ schoolId: null, userId: profileId, action: editing ? 'UPDATE' : 'CREATE', entityType: 'testimonial', entityId: id ?? null })
      toast.success(editing ? 'Testimonial updated' : 'Testimonial added')
      setDialogOpen(false)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const toggleActive = useMutation({
    mutationFn: async (t: Testimonial) => {
      const { error } = await supabase.from('testimonials').update({ is_active: !t.is_active }).eq('id', t.id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message)
  })

  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: Testimonial; b: Testimonial }) => {
      await Promise.all([
        supabase.from('testimonials').update({ display_order: b.display_order }).eq('id', a.id),
        supabase.from('testimonials').update({ display_order: a.display_order }).eq('id', b.id)
      ])
    },
    onSuccess: invalidate
  })

  const remove = useMutation({
    mutationFn: async (t: Testimonial) => {
      const { error } = await supabase.from('testimonials').delete().eq('id', t.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Removed'); setDeleteTarget(null); invalidate() },
    onError: (err: Error) => toast.error(err.message)
  })

  return (
    <div className="pt-4">
      <div className="flex justify-end mb-3">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add Testimonial</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : testimonials.length === 0 ? (
        <EmptyState icon={<Quote className="h-10 w-10" />} title="No testimonials yet" description="Add one whenever a school gives you a good quote — this section stays off the public page until there's at least one." />
      ) : (
        <div className="space-y-2">
          {testimonials.map((t, i) => (
            <Card key={t.id}>
              <CardContent className="p-4 flex items-start gap-3">
                <ReorderButtons
                  onUp={() => i > 0 && reorder.mutate({ a: t, b: testimonials[i - 1] })}
                  onDown={() => i < testimonials.length - 1 && reorder.mutate({ a: t, b: testimonials[i + 1] })}
                  disabledUp={i === 0}
                  disabledDown={i === testimonials.length - 1}
                />
                {t.photo_url ? (
                  <img src={t.photo_url} alt="" className="h-12 w-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Quote className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm italic truncate">"{t.quote}"</p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <p className="text-xs font-medium">{t.author_name}{t.author_role ? ` · ${t.author_role}` : ''}</p>
                    {t.rating && (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: t.rating }).map((_, idx) => <Star key={idx} className="h-3 w-3 fill-current text-amber-500" />)}
                      </span>
                    )}
                    {!t.is_active && <Badge variant="secondary">Hidden</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={t.is_active} onCheckedChange={() => toggleActive.mutate(t)} aria-label="Visible on site" />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Testimonial' : 'Add Testimonial'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => save.mutate(d))} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {photoPreview ? <img src={photoPreview} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}>
                {uploadingPhoto ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-2 h-3.5 w-3.5" />}
                {photoPreview ? 'Replace photo' : 'Add photo (optional)'}
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0]; if (!f) return
                setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f))
              }} />
            </div>
            <FormField label="Quote" required error={errors.quote?.message} htmlFor="t-quote">
              <Textarea id="t-quote" rows={3} {...register('quote')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Author Name" required error={errors.author_name?.message} htmlFor="t-name">
                <Input id="t-name" {...register('author_name')} />
              </FormField>
              <FormField label="Author Role" error={errors.author_role?.message} htmlFor="t-role">
                <Input id="t-role" placeholder="e.g. Principal, Jesuit High School" {...register('author_role')} />
              </FormField>
            </FormGrid>
            <FormField label="Rating (optional)" htmlFor="t-rating">
              <Input id="t-rating" type="number" min={1} max={5} placeholder="1–5" {...register('rating')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || save.isPending || uploadingPhoto}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save Changes' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this testimonial?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
