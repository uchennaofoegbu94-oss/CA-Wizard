import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, ShieldCheck, Trash2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { Profile, SchoolSection, SectionAdmin } from '@/types'

const grantSchema = z.object({
  teacher_id: z.string().uuid('Select a teacher'),
  section_id: z.string().uuid('Select a section')
})
type GrantForm = z.infer<typeof grantSchema>

// The 3 toggleable permissions this feature currently supports.
// Adding a 4th later (schema: migration 049's comment) means adding
// one more entry here plus a matching column — nothing else about
// this page's layout needs to change.
const PERMISSIONS: { key: keyof Pick<SectionAdmin, 'can_add_students' | 'can_enroll_students' | 'can_assign_teachers' | 'can_download_documents'>; label: string; hint: string }[] = [
  { key: 'can_add_students', label: 'Add students', hint: 'Create new student records (school-wide, not section-scoped — a student has no section until enrolled)' },
  { key: 'can_enroll_students', label: 'Enroll students', hint: 'Enroll a student into a class within this section' },
  { key: 'can_assign_teachers', label: 'Assign teachers', hint: 'Assign a teacher to a class within this section' },
  { key: 'can_download_documents', label: 'Download documents', hint: 'Generate/download report cards and transcripts for classes within this section' }
]

export default function SectionAdminsPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<SectionAdmin | null>(null)

  const { data: sections = [], isLoading: loadingSections } = useQuery({
    queryKey: ['school-sections-for-admins', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('school_sections').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as SchoolSection[]
    },
    enabled: !!schoolId
  })

  const { data: teachers = [] } = useQuery({
    queryKey: ['active-teachers-for-section-admins', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('school_id', schoolId!).eq('role', 'teacher').eq('is_active', true).order('first_name')
      if (error) throw error
      return data as Profile[]
    },
    enabled: !!schoolId
  })

  const { data: grants = [], isLoading: loadingGrants, isError: grantsError } = useQuery({
    queryKey: ['section-admin-grants', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('section_admins')
        .select('*, section:school_sections(*), teacher:profiles!section_admins_teacher_id_fkey(*)')
        .eq('school_id', schoolId!)
      if (error) throw error
      return data as SectionAdmin[]
    },
    enabled: !!schoolId
  })

  const form = useForm<GrantForm>({ resolver: zodResolver(grantSchema) })

  const openNew = () => {
    form.reset({ teacher_id: '', section_id: '' })
    setDialogOpen(true)
  }

  const createGrant = useMutation({
    mutationFn: async (values: GrantForm) => {
      const { error } = await supabase.from('section_admins').insert({
        school_id: schoolId,
        teacher_id: values.teacher_id,
        section_id: values.section_id,
        granted_by: profile?.id ?? null
      })
      if (error) throw error
    },
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ['section-admin-grants', schoolId] })
      setDialogOpen(false)
      toast.success('Section admin added — toggle their permissions below')
      const teacher = teachers.find(t => t.id === values.teacher_id)
      const section = sections.find(s => s.id === values.section_id)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'PROMOTE', entityType: 'section_admin_grant',
        newValue: { teacher: teacher ? `${teacher.first_name} ${teacher.last_name}` : undefined, section: section?.name }
      })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'This teacher already has a grant for that section — edit it below instead.' : e.message
    )
  })

  const togglePermission = useMutation({
    mutationFn: async ({ grant, key, value }: { grant: SectionAdmin; key: string; value: boolean }) => {
      const { error } = await supabase.from('section_admins').update({ [key]: value }).eq('id', grant.id)
      if (error) throw error
    },
    onMutate: async ({ grant, key, value }) => {
      // Optimistic update so the switch doesn't visually snap back
      // while the request is in flight.
      await qc.cancelQueries({ queryKey: ['section-admin-grants', schoolId] })
      const previous = qc.getQueryData<SectionAdmin[]>(['section-admin-grants', schoolId])
      qc.setQueryData<SectionAdmin[]>(['section-admin-grants', schoolId], old =>
        old?.map(g => g.id === grant.id ? { ...g, [key]: value } : g)
      )
      return { previous }
    },
    onError: (e: Error, _vars, context) => {
      if (context?.previous) qc.setQueryData(['section-admin-grants', schoolId], context.previous)
      toast.error(e.message)
    },
    onSuccess: (_data, { grant, key, value }) => {
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'section_admin_grant',
        entityId: grant.id, newValue: { [key]: value }
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['section-admin-grants', schoolId] })
  })

  const revokeGrant = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('section_admins').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['section-admin-grants', schoolId] })
      toast.success('Section admin access revoked')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'section_admin_grant', entityId: id })
      setRevokeTarget(null)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  if (!loadingSections && sections.length === 0) {
    return (
      <div>
        <PageHeader title="Section Admins" description="Delegate limited admin permissions to teachers, scoped to a school section" />
        <EmptyState
          icon={<ShieldCheck className="h-12 w-12" />}
          title="Set up School Sections first"
          description="Section admin permissions are scoped to a section (e.g. Basic School, High School). Create at least one under Classes → Sections before granting anyone access here."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Section Admins"
        description={`${grants.length} grant${grants.length !== 1 ? 's' : ''} across ${sections.length} section${sections.length !== 1 ? 's' : ''}`}
        action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add Section Admin</Button>}
      />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        A section admin is still a teacher — they keep their normal teacher dashboard. These toggles only add the ability to add students, enroll students, assign teachers to classes, and/or download report cards/transcripts, scoped to the section(s) below. They can never delete anything or touch score entry.
      </div>

      <Card>
        <CardContent className="p-0">
          {loadingGrants ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : grantsError ? (
            <EmptyState
              icon={<ShieldCheck className="h-12 w-12" />}
              title="Couldn't load section admins"
              description="Something went wrong fetching this list — try refreshing the page."
            />
          ) : grants.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-12 w-12" />}
              title="No section admins yet"
              action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add Section Admin</Button>}
            />
          ) : (
            <Table containerClassName="max-h-[70vh]">
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Section</TableHead>
                  {PERMISSIONS.map(p => <TableHead key={p.key} className="text-center">{p.label}</TableHead>)}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map(grant => (
                  <TableRow key={grant.id}>
                    <TableCell className="font-medium">{grant.teacher?.first_name} {grant.teacher?.last_name}</TableCell>
                    <TableCell><Badge variant="info">{grant.section?.name}</Badge></TableCell>
                    {PERMISSIONS.map(p => (
                      <TableCell key={p.key} className="text-center">
                        <Switch
                          checked={grant[p.key]}
                          disabled={togglePermission.isPending}
                          onCheckedChange={value => togglePermission.mutate({ grant, key: p.key, value })}
                          aria-label={`${p.label} for ${grant.teacher?.first_name}`}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRevokeTarget(grant)} aria-label="Revoke">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Grant Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Section Admin</DialogTitle>
            <DialogDescription>Pick a teacher and a section. Permissions default to off — toggle them on afterward.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(v => createGrant.mutate(v))} className="space-y-4">
            <FormField label="Teacher" required error={form.formState.errors.teacher_id?.message}>
              <Controller name="teacher_id" control={form.control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select a teacher" /></SelectTrigger>
                  <SelectContent>
                    {teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField label="Section" required error={form.formState.errors.section_id?.message}>
              <Controller name="section_id" control={form.control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                  <SelectContent>
                    {sections.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createGrant.isPending}>
                {createGrant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke section admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.teacher?.first_name} {revokeTarget?.teacher?.last_name} will lose all delegated permissions for {revokeTarget?.section?.name}. They remain a normal teacher.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => revokeTarget && revokeGrant.mutate(revokeTarget.id)}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
