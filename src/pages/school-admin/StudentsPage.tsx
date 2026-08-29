import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, Pencil, Search, MoreVertical, Users, UserX, UserCheck,
  GraduationCap, LogOut, ArrowRightLeft, Camera, ChevronLeft, ChevronRight, Trash2
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { uploadStudentPhoto } from '@/lib/storage'
import { logAudit } from '@/lib/audit'
import { studentLimit, tierLabel } from '@/lib/tierLimits'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField, FormGrid, FormSection } from '@/components/ui/form-field'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import toast from 'react-hot-toast'
import { formatDate, initials } from '@/lib/utils'
import type { Student, Class, StudentEnrollment, Session, StudentStatus } from '@/types'

const studentSchema = z.object({
  admission_number: z.string().min(1, 'Required'),
  first_name:       z.string().min(1, 'Required'),
  last_name:        z.string().min(1, 'Required'),
  middle_name:      z.string().optional(),
  gender:           z.enum(['Male', 'Female']).optional(),
  date_of_birth:    z.string().optional(),
  is_transfer_student:  z.boolean().optional(),
  previous_school_name: z.string().optional(),
  transfer_in_date:     z.string().optional()
})

type StudentForm = z.infer<typeof studentSchema>

const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'Active',
  graduated: 'Graduated',
  transferred_out: 'Transferred Out',
  withdrawn: 'Withdrawn'
}

const STATUS_VARIANT: Record<StudentStatus, 'success' | 'info' | 'warning' | 'destructive'> = {
  active: 'success',
  graduated: 'info',
  transferred_out: 'warning',
  withdrawn: 'destructive'
}

export default function StudentsPage() {
  const { schoolId, profile, subscriptionTier } = useAuth()
  const qc = useQueryClient()
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [view, setView] = useState<ViewMode>('list')
  const [studentDialog, setStudentDialog] = useState<Student | 'new' | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ student: Student; action: 'deactivate' | 'graduate' | 'transfer_out' } | null>(null)
  const [transferReason, setTransferReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [enrollTarget, setEnrollTarget] = useState<Student | null>(null)
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null)

  const { data: currentSession } = useQuery({
    queryKey: ['current-session', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Session | null
    },
    enabled: !!schoolId
  })

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['students', schoolId, showInactive],
    queryFn: async () => {
      let query = supabase.from('students').select('*').eq('school_id', schoolId!)
      if (!showInactive) query = query.eq('status', 'active')
      const { data, error } = await query.order('last_name')
      if (error) throw error
      return data as Student[]
    },
    enabled: !!schoolId
  })

  const { data: enrollments = [] } = useQuery({
    queryKey: ['enrollments', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('*, class:classes(*, class_level:class_levels(*), class_arm:class_arms(*))')
        .eq('school_id', schoolId!)
        .eq('session_id', currentSession!.id)
      if (error) throw error
      return data as StudentEnrollment[]
    },
    enabled: !!schoolId && !!currentSession?.id
  })

  const { data: classesForEnrollment = [] } = useQuery({
    queryKey: ['classes-for-enroll', schoolId, currentSession?.id],
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

  const enrollmentFor = (studentId: string) => enrollments.find(e => e.student_id === studentId)
  const classLabel = (cls?: Class) =>
    cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  // ══════════════════════════════════════════════════════════
  // ADD / EDIT STUDENT
  // ══════════════════════════════════════════════════════════
  const form = useForm<StudentForm>({ resolver: zodResolver(studentSchema), defaultValues: { is_transfer_student: false } })
  const isTransferChecked = form.watch('is_transfer_student')

  const openNew = async () => {
    form.reset({ is_transfer_student: false })
    setStudentDialog('new')
    if (schoolId && currentSession) {
      const { data, error } = await supabase.rpc('generate_admission_number', {
        p_school_id: schoolId,
        p_year: currentSession.start_year
      })
      // Best-effort prefill only — if this fails, the field is simply
      // left blank for manual entry, same as before this feature existed.
      if (!error && data) form.setValue('admission_number', data as string)
    }
  }
  const openEdit = (s: Student) => {
    form.reset({
      admission_number: s.admission_number,
      first_name: s.first_name,
      last_name: s.last_name,
      middle_name: s.middle_name ?? '',
      gender: s.gender ?? undefined,
      date_of_birth: s.date_of_birth ?? '',
      is_transfer_student: s.is_transfer_student,
      previous_school_name: s.previous_school_name ?? '',
      transfer_in_date: s.transfer_in_date ?? ''
    })
    setStudentDialog(s)
  }

  const upsertStudent = useMutation({
    mutationFn: async (values: StudentForm) => {
      const payload = {
        admission_number: values.admission_number,
        first_name: values.first_name,
        last_name: values.last_name,
        middle_name: values.middle_name || null,
        gender: values.gender || null,
        date_of_birth: values.date_of_birth || null,
        is_transfer_student: values.is_transfer_student ?? false,
        previous_school_name: values.is_transfer_student ? (values.previous_school_name || null) : null,
        transfer_in_date: values.is_transfer_student ? (values.transfer_in_date || null) : null
      }
      if (studentDialog === 'new') {
        const { data, error } = await supabase.from('students').insert({ ...payload, school_id: schoolId }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id, payload }
      } else if (studentDialog && typeof studentDialog === 'object') {
        const { error } = await supabase.from('students').update(payload).eq('id', studentDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: studentDialog.id, payload }
      }
      return null
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['students', schoolId] })
      setStudentDialog(null)
      toast.success('Saved')
      if (result) {
        logAudit({
          schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'student',
          entityId: result.id, newValue: { admission_number: result.payload.admission_number, name: `${result.payload.first_name} ${result.payload.last_name}` }
        })
      }
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'A student with this admission number already exists.' : e.message
    )
  })

  // ══════════════════════════════════════════════════════════
  // PHOTO UPLOAD
  // ══════════════════════════════════════════════════════════
  const handlePhotoUpload = async (studentId: string, file: File) => {
    if (!schoolId) return
    setUploadingPhotoFor(studentId)
    const { url, error } = await uploadStudentPhoto(schoolId, studentId, file)
    setUploadingPhotoFor(null)
    if (error || !url) {
      toast.error(error ?? 'Upload failed')
      return
    }
    const { error: dbError } = await supabase.from('students').update({ photo_url: url }).eq('id', studentId)
    if (dbError) {
      toast.error(dbError.message)
      return
    }
    qc.invalidateQueries({ queryKey: ['students', schoolId] })
    toast.success('Photo updated')
  }

  // ══════════════════════════════════════════════════════════
  // LIFECYCLE: deactivate / reactivate / graduate / transfer out
  // ══════════════════════════════════════════════════════════
  const reactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('students').update({ status: 'active' }).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['students', schoolId] })
      toast.success('Student reactivated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'student_status', entityId: id, newValue: { status: 'active' } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Hard delete — genuinely removes the row, not a status change. Every
  // dependent record (enrollments, scores, attendance, comments,
  // transcript snapshots) cascades with it via ON DELETE CASCADE, which
  // is why this is gated behind a type-to-confirm dialog rather than a
  // plain "are you sure" — unlike Withdraw/Transfer/Graduate, this
  // cannot be undone by reactivating. RLS also restricts this to
  // school_admin (migration 013); the role check below is UX, not the
  // real boundary.
  const deleteStudent = useMutation({
    mutationFn: async (student: Student) => {
      const { error } = await supabase.from('students').delete().eq('id', student.id)
      if (error) throw error
      return student
    },
    onSuccess: (student) => {
      qc.invalidateQueries({ queryKey: ['students', schoolId] })
      setDeleteTarget(null)
      setDeleteConfirmText('')
      toast.success(`${student.first_name} ${student.last_name} deleted`)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'student',
        entityId: student.id, oldValue: { name: `${student.first_name} ${student.last_name}`, admission_number: student.admission_number }
      })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const applyStatusChange = useMutation({
    mutationFn: async () => {
      if (!statusTarget) return null
      const { student, action } = statusTarget
      if (action === 'deactivate') {
        const { error } = await supabase.from('students').update({ status: 'withdrawn' }).eq('id', student.id)
        if (error) throw error
        return { id: student.id, newValue: { status: 'withdrawn' } }
      } else if (action === 'graduate') {
        const { error } = await supabase.from('students').update({ status: 'graduated' }).eq('id', student.id)
        if (error) throw error
        return { id: student.id, newValue: { status: 'graduated' } }
      } else if (action === 'transfer_out') {
        const { error } = await supabase.from('students').update({
          status: 'transferred_out',
          transfer_out_date: new Date().toISOString().slice(0, 10),
          transfer_out_reason: transferReason || null
        }).eq('id', student.id)
        if (error) throw error
        return { id: student.id, newValue: { status: 'transferred_out', reason: transferReason || null } }
      }
      return null
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['students', schoolId] })
      setStatusTarget(null)
      setTransferReason('')
      toast.success('Updated')
      if (result) {
        logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'student_status', entityId: result.id, newValue: result.newValue })
      }
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // ══════════════════════════════════════════════════════════
  // ENROLLMENT
  // ══════════════════════════════════════════════════════════
  const openEnroll = (student: Student) => {
    const existing = enrollmentFor(student.id)
    setSelectedClassId(existing?.class_id ?? '')
    setEnrollTarget(student)
  }

  const enrollStudent = useMutation({
    mutationFn: async () => {
      if (!enrollTarget || !currentSession) throw new Error('Missing student or session context')
      const existing = enrollmentFor(enrollTarget.id)
      if (existing && existing.class_id === selectedClassId) return { unchanged: true, action: null as null }

      if (existing) {
        const { error } = await supabase.from('student_enrollments').update({ class_id: selectedClassId }).eq('id', existing.id)
        if (error) throw error
        return { unchanged: false, action: 'UPDATE' as const }
      } else {
        const { error } = await supabase.from('student_enrollments').insert({
          school_id: schoolId, student_id: enrollTarget.id, class_id: selectedClassId, session_id: currentSession.id
        })
        if (error) throw error
        return { unchanged: false, action: 'CREATE' as const }
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['enrollments', schoolId] })
      const cls = classesForEnrollment.find(c => c.id === selectedClassId)
      if (!result.unchanged) {
        toast.success(`${enrollTarget?.first_name} ${enrollTarget?.last_name} enrolled in ${classLabel(cls)}`)
        if (result.action) {
          logAudit({
            schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'student_enrollment',
            entityId: enrollTarget?.id, newValue: { student: `${enrollTarget?.first_name} ${enrollTarget?.last_name}`, class: classLabel(cls) }
          })
        }
      }
      setEnrollTarget(null)
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'Already enrolled in that class.' : e.message
    )
  })

  const unenrollStudent = useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await supabase.from('student_enrollments').delete().eq('id', enrollmentId)
      if (error) throw error
      return enrollmentId
    },
    onSuccess: (enrollmentId) => {
      qc.invalidateQueries({ queryKey: ['enrollments', schoolId] })
      toast.success('Student unenrolled')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'student_enrollment', entityId: enrollmentId })
      setEnrollTarget(null)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const filtered = students.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  )

  // Phase 5: simple client-side pagination — schools with large
  // rosters (300+ students) were rendering every row at once
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const renderActions = (student: Student) => {
    const enrollment = enrollmentFor(student.id)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${student.first_name} ${student.last_name}`}><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(student)}>
            <Pencil className="mr-2 h-4 w-4" />Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openEnroll(student)} disabled={!currentSession || student.status !== 'active'}>
            <GraduationCap className="mr-2 h-4 w-4" />
            {enrollment ? 'Change Class' : 'Enroll in Class'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {student.status === 'active' ? (
            <>
              <DropdownMenuItem onClick={() => setStatusTarget({ student, action: 'graduate' })}>
                <GraduationCap className="mr-2 h-4 w-4" />Graduate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusTarget({ student, action: 'transfer_out' })}>
                <ArrowRightLeft className="mr-2 h-4 w-4" />Transfer Out
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusTarget({ student, action: 'deactivate' })} className="text-destructive">
                <UserX className="mr-2 h-4 w-4" />Withdraw
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={() => reactivate.mutate(student.id)} className="text-green-600">
              <UserCheck className="mr-2 h-4 w-4" />Reactivate
            </DropdownMenuItem>
          )}
          {profile?.role === 'school_admin' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteTarget(student)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />Delete Permanently
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const studentCap = studentLimit(subscriptionTier)
  const activeStudentCount = students.filter(s => s.is_active).length
  const atStudentCap = studentCap !== null && activeStudentCount >= studentCap

  return (
    <div>
      {atStudentCap && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          You've reached the {activeStudentCount}/{studentCap} active student limit for the {tierLabel(subscriptionTier ?? 'free')} plan.
          Upgrade to add more students.
        </div>
      )}

      <PageHeader
        title="Students"
        description={`${students.length} student${students.length !== 1 ? 's' : ''}${showInactive ? ' (all statuses)' : ''}`}
        action={
          <Button onClick={openNew} disabled={atStudentCap}>
            <Plus className="mr-2 h-4 w-4" />Add Student
          </Button>
        }
      />

      {!currentSession && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          No current session is set — enrollment is disabled until you mark a session as current under Sessions.
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name or admission number…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
              Show all statuses
            </label>
            <ViewToggle value={view} onChange={setView} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loadingStudents ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title={search ? 'No students match your search' : 'No students yet'}
              action={!search && !atStudentCap ? <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add Student</Button> : undefined}
            />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {paginated.map(student => {
                const enrollment = enrollmentFor(student.id)
                return (
                  <div key={student.id} className="rounded-lg border p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={student.photo_url ?? ''} />
                          <AvatarFallback className="bg-brand-100 text-brand-700 text-xs">
                            {initials(student.first_name, student.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{student.last_name}, {student.first_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{student.admission_number}</p>
                        </div>
                      </div>
                      {renderActions(student)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {enrollment
                        ? <Badge variant="info">{classLabel(enrollment.class)}</Badge>
                        : <Badge variant="outline" className="text-xs">Not enrolled</Badge>
                      }
                      <Badge variant={STATUS_VARIANT[student.status]}>{STATUS_LABEL[student.status]}</Badge>
                      {student.is_transfer_student && <Badge variant="outline" className="text-xs">Transfer-In</Badge>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden sm:table-cell">Adm. No.</TableHead>
                  <TableHead>Current Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(student => {
                  const enrollment = enrollmentFor(student.id)
                  return (
                    <TableRow key={student.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={student.photo_url ?? ''} />
                            <AvatarFallback className="bg-brand-100 text-brand-700 text-xs">
                              {initials(student.first_name, student.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{student.last_name}, {student.first_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-sm text-muted-foreground">{student.admission_number}</TableCell>
                      <TableCell>
                        {enrollment
                          ? <Badge variant="info">{classLabel(enrollment.class)}</Badge>
                          : <Badge variant="outline" className="text-xs">Not enrolled</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant={STATUS_VARIANT[student.status]}>{STATUS_LABEL[student.status]}</Badge>
                          {student.is_transfer_student && <Badge variant="outline" className="text-xs">Transfer-In</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{renderActions(student)}</TableCell>
                    </TableRow>
                  )
                })}
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

      {/* Add/Edit Dialog */}
      <Dialog open={!!studentDialog} onOpenChange={o => !o && setStudentDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{studentDialog === 'new' ? 'Add Student' : 'Edit Student'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(v => upsertStudent.mutate(v))} className="space-y-5">
            {studentDialog && typeof studentDialog === 'object' && (() => {
              const editingStudent = studentDialog
              return (
                <div className="flex items-center gap-3">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={editingStudent.photo_url ?? ''} />
                    <AvatarFallback className="bg-brand-100 text-brand-700">
                      {initials(editingStudent.first_name, editingStudent.last_name)}
                    </AvatarFallback>
                  </Avatar>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) handlePhotoUpload(editingStudent.id, file)
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhotoFor === editingStudent.id}>
                    {uploadingPhotoFor === editingStudent.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-2 h-3.5 w-3.5" />}
                    Change Photo
                  </Button>
                </div>
              )
            })()}

            <FormField label="Admission Number" error={form.formState.errors.admission_number?.message} required htmlFor="admNo">
              <Input id="admNo" {...form.register('admission_number')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="First Name" error={form.formState.errors.first_name?.message} required htmlFor="fname">
                <Input id="fname" {...form.register('first_name')} />
              </FormField>
              <FormField label="Last Name" error={form.formState.errors.last_name?.message} required htmlFor="lname">
                <Input id="lname" {...form.register('last_name')} />
              </FormField>
            </FormGrid>
            <FormField label="Middle Name" htmlFor="mname">
              <Input id="mname" {...form.register('middle_name')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Gender" htmlFor="gender">
                <Controller
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="gender"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField label="Date of Birth" htmlFor="dob">
                <Input id="dob" type="date" {...form.register('date_of_birth')} />
              </FormField>
            </FormGrid>

            <FormSection title="Transfer Student" description="Did this student join from another school?">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Controller
                  control={form.control}
                  name="is_transfer_student"
                  render={({ field }) => (
                    <input type="checkbox" checked={field.value ?? false} onChange={e => field.onChange(e.target.checked)} className="rounded" />
                  )}
                />
                This is a transfer student
              </label>
              {isTransferChecked && (
                <FormGrid cols={2}>
                  <FormField label="Previous School" htmlFor="prevSchool">
                    <Input id="prevSchool" placeholder="e.g. Bright Stars Academy" {...form.register('previous_school_name')} />
                  </FormField>
                  <FormField label="Transfer Date" htmlFor="transferDate">
                    <Input id="transferDate" type="date" {...form.register('transfer_in_date')} />
                  </FormField>
                </FormGrid>
              )}
            </FormSection>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStudentDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertStudent.isPending}>
                {upsertStudent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Enroll Dialog */}
      <Dialog open={!!enrollTarget} onOpenChange={o => !o && setEnrollTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll {enrollTarget?.first_name} {enrollTarget?.last_name}</DialogTitle>
            <DialogDescription>Session: <strong>{currentSession?.name}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {classesForEnrollment.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classes exist for the current session yet.</p>
            ) : (
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                <SelectContent>
                  {classesForEnrollment.map(cls => <SelectItem key={cls.id} value={cls.id}>{classLabel(cls)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter className="mt-4">
            {enrollTarget && enrollmentFor(enrollTarget.id) && (
              <Button type="button" variant="ghost" className="text-destructive mr-auto"
                onClick={() => { const e = enrollmentFor(enrollTarget.id); if (e) unenrollStudent.mutate(e.id) }}>
                <LogOut className="mr-2 h-4 w-4" />Unenroll
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setEnrollTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!selectedClassId || enrollStudent.isPending} onClick={() => enrollStudent.mutate()}>
              {enrollStudent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm Enrollment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status change confirmation */}
      <AlertDialog open={!!statusTarget} onOpenChange={o => { if (!o) { setStatusTarget(null); setTransferReason('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.action === 'graduate' && `Graduate ${statusTarget.student.first_name}?`}
              {statusTarget?.action === 'transfer_out' && `Transfer ${statusTarget.student.first_name} out?`}
              {statusTarget?.action === 'deactivate' && `Withdraw ${statusTarget.student.first_name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.action === 'graduate' && 'This marks them as a graduate. Their historical records are preserved.'}
              {statusTarget?.action === 'transfer_out' && 'This marks them as having left for another school. Their historical records are preserved.'}
              {statusTarget?.action === 'deactivate' && 'They\'ll be hidden from the active roster. You can reactivate them anytime.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {statusTarget?.action === 'transfer_out' && (
            <Textarea
              placeholder="Reason (optional)"
              value={transferReason}
              onChange={e => setTransferReason(e.target.value)}
              rows={2}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => applyStatusChange.mutate()}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete — type-to-confirm, since unlike the status actions above
          this is genuinely irreversible and takes every score, attendance
          record, and transcript snapshot for this student with it. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) { setDeleteTarget(null); setDeleteConfirmText('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {deleteTarget?.first_name} {deleteTarget?.last_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. It permanently deletes this student along with all of their scores, attendance,
              comments, and transcript history — not just their enrollment. If they left the school, use{' '}
              <strong>Withdraw</strong> or <strong>Transfer Out</strong> instead, which preserve their records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="deleteConfirmInput" className="text-sm text-muted-foreground">
              Type <strong className="font-mono text-foreground">{deleteTarget?.admission_number}</strong> to confirm
            </label>
            <Input
              id="deleteConfirmInput"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={deleteConfirmText !== deleteTarget?.admission_number || deleteStudent.isPending}
              onClick={() => deleteTarget && deleteStudent.mutate(deleteTarget)}
            >
              {deleteStudent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
