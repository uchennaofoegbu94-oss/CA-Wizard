import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Copy, Ban, Users, KeyRound, Check, UserPlus, X, ChevronLeft, ChevronRight, Trash2, Archive, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import toast from 'react-hot-toast'
import { generateInviteCode, isExpired, formatDate, cn } from '@/lib/utils'
import { teacherLimit, tierLabel } from '@/lib/tierLimits'
import { logAudit } from '@/lib/audit'
import { notifyUser } from '@/lib/notifications'
import type { InviteCode, Profile, Class, TeacherAssignment, Session, Subject, SubjectOffering } from '@/types'

const NONE_VALUE = '__none__'

// Invites no longer target a class/arm/subject — they only bring a
// teacher into the school. All actual access (which class, which
// subject, or "form teacher for everything") is granted afterward
// by a school admin via the Assign dialog below. This also means a
// teacher can be assigned multiple subjects across multiple classes,
// which is normal in most schools and wasn't possible when an invite
// hard-coded a single class+subject.
const assignSchema = z.object({
  class_id:   z.string().uuid('Select a class'),
  subject_id: z.string().optional()
})

type AssignForm = z.infer<typeof assignSchema>

export default function TeachersPage() {
  const { schoolId, profile, subscriptionTier } = useAuth()
  const qc = useQueryClient()

  const [generatedCodes, setGeneratedCodes] = useState<InviteCode[]>([])
  const [quantityDialogOpen, setQuantityDialogOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<InviteCode | null>(null)
  const [deleteCodeTarget, setDeleteCodeTarget] = useState<InviteCode | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Profile | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [assignTeacher, setAssignTeacher] = useState<Profile | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [removeAssignmentTarget, setRemoveAssignmentTarget] = useState<TeacherAssignment | null>(null)
  const [activeTab, setActiveTab] = useState('teachers')

  const { data: currentSession } = useQuery({
    queryKey: ['current-session-teachers', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Session | null
    },
    enabled: !!schoolId
  })

  const { data: teachers = [], isLoading: loadingTeachers } = useQuery({
    queryKey: ['teachers', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('school_id', schoolId!).eq('role', 'teacher').order('first_name')
      if (error) throw error
      return data as Profile[]
    },
    enabled: !!schoolId
  })

  const { data: allAssignments = [] } = useQuery({
    queryKey: ['all-teacher-assignments', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select('*, class:classes(*, class_level:class_levels(*), class_arm:class_arms(*)), subject:subjects(*)')
        .eq('school_id', schoolId!)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!schoolId
  })

  const assignmentsFor = (teacherId: string) => allAssignments.filter(a => a.teacher_id === teacherId)

  const { data: inviteCodes = [], isLoading: loadingCodes } = useQuery({
    queryKey: ['invite-codes', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('invite_codes').select('*').eq('school_id', schoolId!).order('created_at', { ascending: false })
      if (error) throw error
      return data as InviteCode[]
    },
    enabled: !!schoolId
  })

  const { data: currentSessionClasses = [] } = useQuery({
    queryKey: ['classes-current-session', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*, class_level:class_levels(*), class_arm:class_arms(*)')
        .eq('school_id', schoolId!)
        .eq('session_id', currentSession!.id)
      if (error) throw error
      return data as Class[]
    },
    enabled: !!schoolId && !!currentSession?.id
  })

  const invalidateTeacherData = () => {
    qc.invalidateQueries({ queryKey: ['all-teacher-assignments', schoolId] })
    qc.invalidateQueries({ queryKey: ['teachers', schoolId] })
  }

  // ══════════════════════════════════════════════════════════
  // GENERATE INVITE — quantity chosen up front via a small dialog
  // ══════════════════════════════════════════════════════════
  const generateInvite = useMutation({
    mutationFn: async (count: number) => {
      // Generate `count` distinct codes client-side before inserting —
      // collision odds are astronomically low (32^8 combinations) but a
      // Set-based regen-on-collision is nearly free insurance against a
      // batch insert failing outright on a unique-constraint violation.
      const codes = new Set<string>()
      while (codes.size < count) codes.add(generateInviteCode(8))

      const { data, error } = await supabase
        .from('invite_codes')
        .insert(Array.from(codes).map(code => ({
          school_id: schoolId,
          code,
          label: 'Teacher Invite',
          created_by: profile?.id ?? null
        })))
        .select()
      if (error) throw error
      return data as InviteCode[]
    },
    onSuccess: (data) => {
      setGeneratedCodes(data)
      setQuantityDialogOpen(false)
      setInviteDialogOpen(true)
      qc.invalidateQueries({ queryKey: ['invite-codes', schoolId] })
      toast.success(data.length === 1 ? 'Invite code generated' : `${data.length} invite codes generated`)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'invite_code',
        newValue: { count: data.length, codes: data.map(c => c.code) }
      })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const revokeCode = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invite_codes').update({ is_active: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['invite-codes', schoolId] })
      setRevokeTarget(null)
      toast.success('Invite code revoked')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'invite_code', entityId: id, newValue: { is_active: false } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Separate from revoke: revoking disables an active code but keeps the
  // row (so there's still a record it existed); deleting actually removes
  // it, for codes that are simply cluttering the list — unneeded, expired,
  // or already revoked. Works regardless of current status.
  const deleteInviteCode = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invite_codes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['invite-codes', schoolId] })
      setDeleteCodeTarget(null)
      toast.success('Invite code deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'invite_code', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const copyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedId(id)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const copyAllCodes = async () => {
    await navigator.clipboard.writeText(generatedCodes.map(c => c.code).join('\n'))
    toast.success('All codes copied to clipboard')
  }

  // "Used" is deliberately NOT the same color as "Active" — they used
  // to both be green, which visually implied "still good," exactly
  // backwards for a code that can no longer be redeemed. Neutral/grey
  // reads as "done, no longer actionable," clearly distinct from the
  // green "ready to hand out" Active state.
  const codeStatus = (code: InviteCode): { label: string; variant: 'success' | 'secondary' | 'destructive' | 'warning' } => {
    if (code.used_at) return { label: 'Used', variant: 'secondary' }
    if (!code.is_active) return { label: 'Revoked', variant: 'destructive' }
    if (isExpired(code.expires_at)) return { label: 'Expired', variant: 'warning' }
    return { label: 'Active', variant: 'success' }
  }

  // ══════════════════════════════════════════════════════════
  // DIRECT ASSIGNMENT
  // ══════════════════════════════════════════════════════════
  const assignForm = useForm<AssignForm>({ resolver: zodResolver(assignSchema), defaultValues: { class_id: '', subject_id: NONE_VALUE } })
  const watchedAssignClass = assignForm.watch('class_id')
  const assignClassLevelId = currentSessionClasses.find(c => c.id === watchedAssignClass)?.class_level_id

  // Subjects offered at the selected class's level, via the new
  // global-catalog + offerings junction (Phase: global subjects)
  const { data: subjectsForAssignClass = [] } = useQuery({
    queryKey: ['subjects-for-assign-class', assignClassLevelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings')
        .select('subject:subjects(*)')
        .eq('class_level_id', assignClassLevelId!)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!assignClassLevelId
  })

  const openAssignDialog = (teacher: Profile) => {
    assignForm.reset({ class_id: '', subject_id: NONE_VALUE })
    setAssignTeacher(teacher)
  }

  const createAssignment = useMutation({
    mutationFn: async (values: AssignForm) => {
      const subjectId = values.subject_id && values.subject_id !== NONE_VALUE ? values.subject_id : null
      const { error } = await supabase.from('teacher_assignments').insert({
        school_id: schoolId,
        teacher_id: assignTeacher!.id,
        class_id: values.class_id,
        subject_id: subjectId,
        scope: subjectId ? 'SUBJECT' : 'CLASS'
      })
      if (error) throw error
    },
    onSuccess: (_data, values) => {
      invalidateTeacherData()
      setAssignTeacher(null)
      toast.success(`${assignTeacher?.first_name} assigned`)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'teacher_assignment',
        entityId: assignTeacher?.id, newValue: { teacher: `${assignTeacher?.first_name} ${assignTeacher?.last_name}` }
      })

      if (assignTeacher) {
        const subjectId = values.subject_id && values.subject_id !== NONE_VALUE ? values.subject_id : null
        const cls = currentSessionClasses.find(c => c.id === values.class_id)
        const subject = subjectId ? subjectsForAssignClass.find(s => s.id === subjectId) : null
        notifyUser({
          schoolId: schoolId!,
          recipientId: assignTeacher.id,
          type: 'teacher_assigned',
          title: subject ? `You've been assigned ${subject.name} — ${classLabel(cls)}` : `You've been made Form Teacher for ${classLabel(cls)}`,
          body: subject ? undefined : 'As Form Teacher, you have full access to all subjects and the class broadsheet.',
          linkPath: '/teacher/classes'
        })
      }
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'This teacher is already assigned to that class/subject.' : e.message
    )
  })

  const removeAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('teacher_assignments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      invalidateTeacherData()
      setRemoveAssignmentTarget(null)
      toast.success('Assignment removed')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'teacher_assignment', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Archiving is deliberately not the same as the "Remove Assignment"
  // action above — it's for a teacher who has actually left the school:
  // blocks login (is_active=false) and clears every assignment in one
  // step, while keeping the profile itself so past scores/comments/audit
  // entries still show who entered them.
  const archiveTeacher = useMutation({
    mutationFn: async (teacherId: string) => {
      const { error } = await supabase.rpc('archive_teacher', { p_teacher_id: teacherId })
      if (error) throw error
      return teacherId
    },
    onSuccess: (teacherId) => {
      invalidateTeacherData()
      setArchiveTarget(null)
      toast.success('Teacher archived')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'teacher_status', entityId: teacherId, newValue: { archived: true } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const restoreTeacher = useMutation({
    mutationFn: async (teacherId: string) => {
      const { error } = await supabase.rpc('restore_teacher', { p_teacher_id: teacherId })
      if (error) throw error
      return teacherId
    },
    onSuccess: (teacherId) => {
      invalidateTeacherData()
      toast.success('Teacher restored — reassign their classes/subjects as needed')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'teacher_status', entityId: teacherId, newValue: { archived: false } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const classLabel = (cls?: Class) =>
    cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : 'Unknown class'

  // Phase 5: client-side pagination — schools with many teachers or a long
  // invite-code history were rendering every row at once. Two independent
  // paginators since these are two unrelated lists on the same page.
  const PAGE_SIZE = 25
  const [teacherPage, setTeacherPage] = useState(1)
  const teacherTotalPages = Math.max(1, Math.ceil(teachers.length / PAGE_SIZE))
  const paginatedTeachers = teachers.slice((teacherPage - 1) * PAGE_SIZE, teacherPage * PAGE_SIZE)

  const [codePage, setCodePage] = useState(1)
  const codeTotalPages = Math.max(1, Math.ceil(inviteCodes.length / PAGE_SIZE))
  const paginatedCodes = inviteCodes.slice((codePage - 1) * PAGE_SIZE, codePage * PAGE_SIZE)

  const teacherCap = teacherLimit(subscriptionTier)
  const activeTeacherCount = teachers.filter(t => t.is_active).length
  const atTeacherCap = teacherCap !== null && activeTeacherCount >= teacherCap

  return (
    <div>
      {atTeacherCap && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          You've reached the {activeTeacherCount}/{teacherCap} teacher limit for the {tierLabel(subscriptionTier ?? 'free')} plan.
          Upgrade to add more teachers. (Generating a new invite code won't bypass this — redemption is blocked too.)
        </div>
      )}

      <PageHeader
        title="Teachers"
        description="Invite teachers, then assign them to classes and subjects"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="teachers"><Users className="mr-1.5 h-4 w-4" />Teachers</TabsTrigger>
          <TabsTrigger value="codes"><KeyRound className="mr-1.5 h-4 w-4" />Invite Codes</TabsTrigger>
        </TabsList>

        {/* ═══ TEACHERS TAB ═══ */}
        <TabsContent value="teachers">
      <div className="flex justify-end mb-3">
        <ViewToggle value={view} onChange={setView} />
      </div>
      <Card className="mb-6">
        <CardContent className="p-0">
          {loadingTeachers ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : teachers.length === 0 ? (
            <EmptyState icon={<Users className="h-12 w-12" />} title="No teachers yet" description="Generate an invite code below to bring your first teacher on board." />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {paginatedTeachers.map(t => {
                const teacherAssignments = assignmentsFor(t.id)
                return (
                  <div key={t.id} className={cn('rounded-lg border p-4 flex flex-col gap-3', !t.is_active && 'opacity-60 bg-muted/30')}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-sm">{t.first_name} {t.last_name}</p>
                          {!t.is_active && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Archived</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{t.email}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {t.is_active ? (
                          <>
                            <Button variant="ghost" size="sm" aria-label={`Assign class or subject to ${t.first_name} ${t.last_name}`} onClick={() => openAssignDialog(t)}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" aria-label={`Archive ${t.first_name} ${t.last_name}`} onClick={() => setArchiveTarget(t)}>
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" aria-label={`Restore ${t.first_name} ${t.last_name}`} onClick={() => restoreTeacher.mutate(t.id)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {teacherAssignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No assignments</span>
                      ) : (
                        teacherAssignments.map(a => (
                          <Badge key={a.id} variant="secondary" className="text-xs pr-1 gap-1">
                            {classLabel(a.class)}{a.subject ? ` — ${a.subject.name}` : ' — Form Teacher'}
                            <button onClick={() => setRemoveAssignmentTarget(a)} aria-label={`Remove assignment: ${classLabel(a.class)}${a.subject ? ' — ' + a.subject.name : ' — Form Teacher'}`} title="Remove assignment" className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead>Assignments</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedTeachers.map(t => {
                  const teacherAssignments = assignmentsFor(t.id)
                  return (
                    <TableRow key={t.id} className={cn(!t.is_active && 'opacity-60 bg-muted/30')}>
                      <TableCell className="font-medium text-sm whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {t.first_name} {t.last_name}
                          {!t.is_active && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Archived</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{t.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {teacherAssignments.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic">No assignments</span>
                          ) : (
                            teacherAssignments.map(a => (
                              <Badge key={a.id} variant="secondary" className="text-xs pr-1 gap-1">
                                {classLabel(a.class)}{a.subject ? ` — ${a.subject.name}` : ' — Form Teacher (all subjects)'}
                                <button onClick={() => setRemoveAssignmentTarget(a)} aria-label={`Remove assignment: ${classLabel(a.class)}${a.subject ? ' — ' + a.subject.name : ' — Form Teacher'}`} title="Remove assignment" className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5">
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {t.is_active ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openAssignDialog(t)}>
                              <UserPlus className="mr-1.5 h-3.5 w-3.5" />Assign
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" aria-label={`Archive ${t.first_name} ${t.last_name}`} onClick={() => setArchiveTarget(t)}>
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => restoreTeacher.mutate(t.id)}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Restore
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {teachers.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mb-6 -mt-3 text-sm text-muted-foreground">
          <p>Showing {(teacherPage - 1) * PAGE_SIZE + 1}–{Math.min(teacherPage * PAGE_SIZE, teachers.length)} of {teachers.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Previous page of teachers" onClick={() => setTeacherPage(p => Math.max(1, p - 1))} disabled={teacherPage === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span>Page {teacherPage} of {teacherTotalPages}</span>
            <Button variant="outline" size="sm" aria-label="Next page of teachers" onClick={() => setTeacherPage(p => Math.min(teacherTotalPages, p + 1))} disabled={teacherPage === teacherTotalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
        </TabsContent>

        {/* ═══ INVITE CODES TAB ═══ */}
        <TabsContent value="codes">
      <div className="flex justify-end mb-3">
        <Button onClick={() => { setQuantity(1); setQuantityDialogOpen(true) }} disabled={atTeacherCap}>
          <Plus className="mr-2 h-4 w-4" />
          Generate Invite
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {loadingCodes ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : inviteCodes.length === 0 ? (
            <EmptyState icon={<KeyRound className="h-12 w-12" />} title="No invite codes generated yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Expires</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedCodes.map(code => {
                  const status = codeStatus(code)
                  return (
                    <TableRow key={code.id}>
                      <TableCell className="font-mono text-sm font-semibold">{code.code}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{formatDate(code.expires_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={copiedId === code.id ? 'Copied' : 'Copy invite code'} onClick={() => copyCode(code.code, code.id)}>
                            {copiedId === code.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                          {status.label === 'Active' && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Revoke invite code" onClick={() => setRevokeTarget(code)}>
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete invite code" onClick={() => setDeleteCodeTarget(code)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {inviteCodes.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <p>Showing {(codePage - 1) * PAGE_SIZE + 1}–{Math.min(codePage * PAGE_SIZE, inviteCodes.length)} of {inviteCodes.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Previous page of invite codes" onClick={() => setCodePage(p => Math.max(1, p - 1))} disabled={codePage === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span>Page {codePage} of {codeTotalPages}</span>
            <Button variant="outline" size="sm" aria-label="Next page of invite codes" onClick={() => setCodePage(p => Math.min(codeTotalPages, p + 1))} disabled={codePage === codeTotalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
        </TabsContent>
      </Tabs>

      {/* Quantity picker — shown before generation so several codes can be minted at once */}
      <Dialog open={quantityDialogOpen} onOpenChange={setQuantityDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate Invite Codes</DialogTitle>
            <DialogDescription>How many codes do you need? Each one can be used by a different teacher to join your school.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="inviteQuantity" className="text-sm font-medium">Number of codes</label>
            <Input
              id="inviteQuantity"
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={e => setQuantity(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            />
            <p className="text-xs text-muted-foreground">Up to 50 at a time.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuantityDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => generateInvite.mutate(quantity)} disabled={generateInvite.isPending}>
              {generateInvite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate {quantity > 1 ? `${quantity} Codes` : 'Code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated code(s) dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={o => { setInviteDialogOpen(o); if (!o) setGeneratedCodes([]) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{generatedCodes.length === 1 ? 'Invite Code Ready' : `${generatedCodes.length} Invite Codes Ready`}</DialogTitle>
            <DialogDescription>Share these with teachers — they'll enter one each at the "Join Your School" screen. You'll assign their classes and subjects afterward.</DialogDescription>
          </DialogHeader>
          {generatedCodes.length > 0 && (
            <div className="space-y-4">
              {generatedCodes.length === 1 ? (
                <div className="rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 p-6 text-center">
                  <p className="text-xs text-brand-600 font-medium uppercase tracking-wide mb-2">Invite Code</p>
                  <p className="text-3xl font-mono font-bold tracking-widest text-brand-900">{generatedCodes[0].code}</p>
                </div>
              ) : (
                <div className="rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 max-h-64 overflow-y-auto divide-y divide-brand-200">
                  {generatedCodes.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="font-mono font-semibold tracking-widest text-brand-900">{c.code}</span>
                      <button onClick={() => copyCode(c.code, c.id)} className="text-brand-600 hover:text-brand-900" aria-label={`Copy code ${c.code}`} title={`Copy code ${c.code}`}>
                        {copiedId === c.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button className="w-full" onClick={() => generatedCodes.length === 1 ? copyCode(generatedCodes[0].code, generatedCodes[0].id) : copyAllCodes()}>
                <Copy className="mr-2 h-4 w-4" />{generatedCodes.length === 1 ? 'Copy Code' : 'Copy All Codes'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">Expires {formatDate(generatedCodes[0].expires_at)}.</p>
              <DialogFooter>
                <Button variant="outline" className="w-full" onClick={() => setInviteDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Direct Assign Dialog */}
      <Dialog open={!!assignTeacher} onOpenChange={o => !o && setAssignTeacher(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign {assignTeacher?.first_name} {assignTeacher?.last_name}</DialogTitle>
            <DialogDescription>{currentSession ? `Session: ${currentSession.name}` : 'No current session set'}</DialogDescription>
          </DialogHeader>
          {!currentSession ? (
            <p className="text-sm text-muted-foreground">Mark a session as current under Sessions before assigning teachers.</p>
          ) : currentSessionClasses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes exist for the current session yet. Create one under Classes first.</p>
          ) : (
            <form onSubmit={assignForm.handleSubmit(v => createAssignment.mutate(v))} className="space-y-4">
              <FormField label="Class" error={assignForm.formState.errors.class_id?.message} required htmlFor="assignClass">
                <Controller
                  control={assignForm.control}
                  name="class_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={v => { field.onChange(v); assignForm.setValue('subject_id', NONE_VALUE) }}>
                      <SelectTrigger id="assignClass"><SelectValue placeholder="Select a class" /></SelectTrigger>
                      <SelectContent>
                        {currentSessionClasses.map(cls => <SelectItem key={cls.id} value={cls.id}>{classLabel(cls)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField label="Subject" hint="Leave as 'Form Teacher' to grant access to every subject in this class" htmlFor="assignSubject">
                <Controller
                  control={assignForm.control}
                  name="subject_id"
                  render={({ field }) => (
                    <Select value={field.value ?? NONE_VALUE} onValueChange={field.onChange} disabled={!watchedAssignClass}>
                      <SelectTrigger id="assignSubject"><SelectValue placeholder="Form Teacher (all subjects)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>Form Teacher (all subjects)</SelectItem>
                        {subjectsForAssignClass.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAssignTeacher(null)}>Cancel</Button>
                <Button type="submit" disabled={createAssignment.isPending}>
                  {createAssignment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Assign
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={o => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite code?</AlertDialogTitle>
            <AlertDialogDescription><strong>{revokeTarget?.code}</strong> will no longer work if someone tries to use it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => revokeTarget && revokeCode.mutate(revokeTarget.id)}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete invite code confirmation */}
      <AlertDialog open={!!deleteCodeTarget} onOpenChange={o => !o && setDeleteCodeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this invite code?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteCodeTarget?.code}</strong> will be permanently removed from the list. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={deleteInviteCode.isPending}
              onClick={() => deleteCodeTarget && deleteInviteCode.mutate(deleteCodeTarget.id)}
            >
              {deleteInviteCode.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive teacher confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={o => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.first_name} {archiveTarget?.last_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This blocks their login and removes all their current class/subject assignments. Their profile and
              past records (scores entered, comments, audit history) are kept — this can be reversed with Restore,
              though assignments will need to be set up again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={archiveTeacher.isPending}
              onClick={() => archiveTarget && archiveTeacher.mutate(archiveTarget.id)}
            >
              {archiveTeacher.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove assignment confirmation */}
      <AlertDialog open={!!removeAssignmentTarget} onOpenChange={o => !o && setRemoveAssignmentTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              The teacher will lose access to {classLabel(removeAssignmentTarget?.class)}
              {removeAssignmentTarget?.subject ? ` — ${removeAssignmentTarget.subject.name}` : ' (all subjects)'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => removeAssignmentTarget && removeAssignment.mutate(removeAssignmentTarget.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
