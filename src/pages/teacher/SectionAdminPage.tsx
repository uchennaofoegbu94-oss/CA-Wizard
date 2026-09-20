import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShieldCheck, UserPlus, GraduationCap, Users, Loader2, FileText, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { Class, GenderType, Profile, Session, SectionAdmin, Student, StudentEnrollment, Subject, TeacherAssignment, Term } from '@/types'

const NONE_VALUE = '__none__'

// A section admin only ever acts within the section(s) they hold a
// grant for — everything below filters classes down to those, rather
// than trusting the picker and letting RLS be the only thing that
// stops a wider selection. RLS is still the real boundary (see
// migration 049); this filtering is just so the picker itself never
// offers a class the action would be rejected for.
export default function SectionAdminPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()

  const { data: myGrants = [], isLoading: loadingGrants } = useQuery({
    queryKey: ['my-section-admin-grants', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('section_admins').select('*, section:school_sections(*)').eq('teacher_id', profile!.id)
      if (error) throw error
      return data as SectionAdmin[]
    },
    enabled: !!profile?.id
  })

  const canAddStudents = myGrants.some(g => g.can_add_students)
  const canEnrollStudents = myGrants.some(g => g.can_enroll_students)
  const canAssignTeachers = myGrants.some(g => g.can_assign_teachers)
  const canDownloadDocuments = myGrants.some(g => g.can_download_documents)
  const managedSectionIds = new Set(myGrants.map(g => g.section_id))

  const { data: currentSession } = useQuery({
    queryKey: ['current-session-for-section-admin', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Session | null
    },
    enabled: !!schoolId
  })

  const { data: currentTerm } = useQuery({
    queryKey: ['current-term-for-section-admin', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Term | null
    },
    enabled: !!schoolId
  })

  // Every class in the current session, tagged with its section, so
  // each tab below can filter to only the classes this teacher is
  // actually permitted to act on.
  const { data: allClasses = [] } = useQuery({
    queryKey: ['classes-for-section-admin', schoolId, currentSession?.id],
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
  const classInManagedSection = (cls: Class) => !!cls.class_level?.section_id && managedSectionIds.has(cls.class_level.section_id)
  const classLabel = (cls?: Class) => cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  if (loadingGrants) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (myGrants.length === 0) {
    return (
      <div>
        <PageHeader title="Section Admin" description="Delegated admin permissions" />
        <EmptyState
          icon={<ShieldCheck className="h-12 w-12" />}
          title="No section admin permissions"
          description="You haven't been granted any delegated admin permissions. Ask your school admin if you believe this is a mistake."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Section Admin"
        description={`Delegated permissions for: ${myGrants.map(g => g.section?.name).filter(Boolean).join(', ')}`}
      />

      <Tabs defaultValue={canAddStudents ? 'add' : canEnrollStudents ? 'enroll' : canAssignTeachers ? 'assign' : 'documents'}>
        <TabsList>
          {canAddStudents && <TabsTrigger value="add"><UserPlus className="mr-1.5 h-4 w-4" />Add Student</TabsTrigger>}
          {canEnrollStudents && <TabsTrigger value="enroll"><GraduationCap className="mr-1.5 h-4 w-4" />Enroll Student</TabsTrigger>}
          {canAssignTeachers && <TabsTrigger value="assign"><Users className="mr-1.5 h-4 w-4" />Assign Teacher</TabsTrigger>}
          {canDownloadDocuments && <TabsTrigger value="documents"><FileText className="mr-1.5 h-4 w-4" />Documents</TabsTrigger>}
        </TabsList>

        {canAddStudents && (
          <TabsContent value="add">
            <AddStudentPanel schoolId={schoolId!} profile={profile} currentSession={currentSession} qc={qc} />
          </TabsContent>
        )}

        {canEnrollStudents && (
          <TabsContent value="enroll">
            <EnrollStudentPanel
              schoolId={schoolId!} profile={profile} currentSession={currentSession} qc={qc}
              managedClasses={allClasses.filter(classInManagedSection)} classLabel={classLabel}
            />
          </TabsContent>
        )}

        {canAssignTeachers && (
          <TabsContent value="assign">
            <AssignTeacherPanel
              schoolId={schoolId!} profile={profile} qc={qc}
              managedClasses={allClasses.filter(classInManagedSection)} classLabel={classLabel}
            />
          </TabsContent>
        )}

        {canDownloadDocuments && (
          <TabsContent value="documents">
            <DocumentsPanel
              currentSession={currentSession} currentTerm={currentTerm}
              managedClasses={allClasses.filter(classInManagedSection)} classLabel={classLabel}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ADD STUDENT — trimmed-down version of StudentsPage's form (just
// the core identity fields; transfer-student details and photo
// upload stay an admin-only capability, not part of this grant).
// ══════════════════════════════════════════════════════════
const addStudentSchema = z.object({
  admission_number: z.string().min(1, 'Required'),
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  middle_name: z.string().optional(),
  gender: z.enum(['Male', 'Female']).optional(),
  date_of_birth: z.string().optional()
})
type AddStudentForm = z.infer<typeof addStudentSchema>

function AddStudentPanel({ schoolId, profile, currentSession, qc }: {
  schoolId: string; profile: Profile | null; currentSession: Session | null | undefined; qc: ReturnType<typeof useQueryClient>
}) {
  const form = useForm<AddStudentForm>({ resolver: zodResolver(addStudentSchema) })

  const prefillAdmissionNumber = async () => {
    if (!schoolId || !currentSession) return
    const { data, error } = await supabase.rpc('generate_admission_number', { p_school_id: schoolId, p_year: currentSession.start_year })
    if (!error && data) form.setValue('admission_number', data as string)
  }

  const addStudent = useMutation({
    mutationFn: async (values: AddStudentForm) => {
      const { data, error } = await supabase.from('students').insert({
        school_id: schoolId,
        admission_number: values.admission_number,
        first_name: values.first_name,
        last_name: values.last_name,
        middle_name: values.middle_name || null,
        gender: values.gender || null,
        date_of_birth: values.date_of_birth || null
      }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success(`${data.first_name} ${data.last_name} added`)
      logAudit({
        schoolId, userId: profile?.id ?? null, action: 'CREATE', entityType: 'student', entityId: data.id,
        newValue: { admission_number: data.admission_number, name: `${data.first_name} ${data.last_name}`, via: 'section_admin' }
      })
      form.reset({})
      qc.invalidateQueries({ queryKey: ['students', schoolId] })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'A student with this admission number already exists.' : e.message
    )
  })

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={form.handleSubmit(v => addStudent.mutate(v))} className="space-y-4 max-w-lg">
          <FormGrid>
            <FormField label="First Name" required error={form.formState.errors.first_name?.message}>
              <Input {...form.register('first_name')} />
            </FormField>
            <FormField label="Last Name" required error={form.formState.errors.last_name?.message}>
              <Input {...form.register('last_name')} />
            </FormField>
          </FormGrid>
          <FormField label="Middle Name">
            <Input {...form.register('middle_name')} />
          </FormField>
          <FormField label="Admission Number" required error={form.formState.errors.admission_number?.message}
            hint={currentSession ? 'Leave blank to auto-generate' : undefined}>
            <div className="flex gap-2">
              <Input {...form.register('admission_number')} />
              {currentSession && <Button type="button" variant="outline" onClick={prefillAdmissionNumber}>Auto</Button>}
            </div>
          </FormField>
          <FormGrid>
            <FormField label="Gender">
              <Controller name="gender" control={form.control} render={({ field }) => (
                <Select value={field.value ?? NONE_VALUE} onValueChange={v => field.onChange(v === NONE_VALUE ? undefined : v as GenderType)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>—</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField label="Date of Birth">
              <Input type="date" {...form.register('date_of_birth')} />
            </FormField>
          </FormGrid>
          <Button type="submit" disabled={addStudent.isPending}>
            {addStudent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Student
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ══════════════════════════════════════════════════════════
// ENROLL STUDENT — only lets a section admin enroll a student who
// isn't already enrolled this session, into one of their managed
// classes. Changing an existing enrollment (or unenrolling) stays
// admin-only — this grant only covers INSERT, per spec.
// ══════════════════════════════════════════════════════════
function EnrollStudentPanel({ schoolId, profile, currentSession, qc, managedClasses, classLabel }: {
  schoolId: string; profile: Profile | null; currentSession: Session | null | undefined; qc: ReturnType<typeof useQueryClient>
  managedClasses: Class[]; classLabel: (cls?: Class) => string
}) {
  const [studentId, setStudentId] = useState('')
  const [classId, setClassId] = useState('')

  const { data: students = [], isLoading: loadingStudents, isError: studentsError } = useQuery({
    queryKey: ['active-students-for-section-admin', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*').eq('school_id', schoolId).eq('status', 'active').order('last_name')
      if (error) throw error
      return data as Student[]
    },
    enabled: !!schoolId
  })

  const { data: enrollments = [], isLoading: loadingEnrollments } = useQuery({
    queryKey: ['enrollments-for-section-admin', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*').eq('school_id', schoolId).eq('session_id', currentSession!.id)
      if (error) throw error
      return data as StudentEnrollment[]
    },
    enabled: !!currentSession?.id
  })

  // Excludes a student only if they're already enrolled in one of
  // the classes THIS section admin actually manages — not every
  // active student in the school. The earlier version excluded any
  // student with an enrollment anywhere, which meant the picker went
  // empty the moment the school's roster was fully placed (the normal
  // steady state mid-term), even though most of those students were
  // never in a class this grant covers. A student already sitting in
  // one of the section admin's own managed classes is still excluded
  // — re-enrolling them elsewhere isn't something this INSERT-only
  // grant can do safely (it can't first remove the old enrollment),
  // so that case is left for a school_admin.
  const managedClassIds = new Set(managedClasses.map(c => c.id))
  const enrolledInManagedClassIds = new Set(enrollments.filter(e => managedClassIds.has(e.class_id)).map(e => e.student_id))
  const enrollableStudents = students.filter(s => !enrolledInManagedClassIds.has(s.id))
  const loadingPickers = loadingStudents || loadingEnrollments

  const enroll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('student_enrollments').insert({
        school_id: schoolId, student_id: studentId, class_id: classId, session_id: currentSession!.id
      })
      if (error) throw error
    },
    onSuccess: () => {
      const student = students.find(s => s.id === studentId)
      const cls = managedClasses.find(c => c.id === classId)
      toast.success(`${student?.first_name} enrolled in ${classLabel(cls)}`)
      logAudit({
        schoolId, userId: profile?.id ?? null, action: 'CREATE', entityType: 'student_enrollment',
        newValue: { student: student ? `${student.first_name} ${student.last_name}` : undefined, class: classLabel(cls), via: 'section_admin' }
      })
      setStudentId('')
      setClassId('')
      qc.invalidateQueries({ queryKey: ['enrollments-for-section-admin', schoolId] })
      qc.invalidateQueries({ queryKey: ['enrollments', schoolId] })
    },
    onError: (e: Error) => toast.error(e.message.includes('duplicate key') ? 'Already enrolled in that class.' : e.message)
  })

  if (!currentSession) {
    return <p className="text-sm text-muted-foreground">No current session is set — ask your school admin to mark one as current under Sessions.</p>
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4 max-w-lg">
        <FormField label="Student" required
          hint={studentsError ? undefined : `${enrollableStudents.length} student${enrollableStudents.length !== 1 ? 's' : ''} available to enroll into your managed section(s)`}>
          <Select value={studentId} onValueChange={setStudentId} disabled={loadingPickers || !!studentsError}>
            <SelectTrigger>
              <SelectValue placeholder={
                studentsError ? "Couldn't load students — try refreshing" :
                loadingPickers ? 'Loading…' :
                enrollableStudents.length === 0 ? 'No students available to enroll' :
                'Select a student'
              } />
            </SelectTrigger>
            <SelectContent>
              {enrollableStudents.map(s => <SelectItem key={s.id} value={s.id}>{s.last_name}, {s.first_name} ({s.admission_number})</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Class" required hint="Only classes in your managed section(s) are shown">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {managedClasses.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <Button disabled={!studentId || !classId || enroll.isPending} onClick={() => enroll.mutate()}>
          {enroll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enroll
        </Button>
      </CardContent>
    </Card>
  )
}

// ══════════════════════════════════════════════════════════
// ASSIGN TEACHER TO CLASS — same shape as the school_admin "Direct
// Assignment" flow in TeachersPage, restricted to managed classes.
// ══════════════════════════════════════════════════════════
function AssignTeacherPanel({ schoolId, profile, qc, managedClasses, classLabel }: {
  schoolId: string; profile: Profile | null; qc: ReturnType<typeof useQueryClient>
  managedClasses: Class[]; classLabel: (cls?: Class) => string
}) {
  const [teacherId, setTeacherId] = useState('')
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState(NONE_VALUE)

  const { data: teachers = [] } = useQuery({
    queryKey: ['teachers-for-section-admin', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('school_id', schoolId).eq('role', 'teacher').eq('is_active', true).order('first_name')
      if (error) throw error
      return data as Profile[]
    }
  })

  const selectedClassLevelId = managedClasses.find(c => c.id === classId)?.class_level_id

  const { data: subjectsForClass = [] } = useQuery({
    queryKey: ['subjects-for-section-admin-assign', selectedClassLevelId],
    queryFn: async () => {
      const { data, error } = await supabase.from('subject_offerings').select('subject:subjects(*)').eq('class_level_id', selectedClassLevelId!)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!selectedClassLevelId
  })

  const assign = useMutation({
    mutationFn: async () => {
      const finalSubjectId = subjectId !== NONE_VALUE ? subjectId : null
      const { error } = await supabase.from('teacher_assignments').insert({
        school_id: schoolId, teacher_id: teacherId, class_id: classId, subject_id: finalSubjectId,
        scope: finalSubjectId ? 'SUBJECT' : 'CLASS'
      } satisfies Partial<TeacherAssignment>)
      if (error) throw error
    },
    onSuccess: () => {
      const teacher = teachers.find(t => t.id === teacherId)
      const cls = managedClasses.find(c => c.id === classId)
      toast.success(`${teacher?.first_name} assigned to ${classLabel(cls)}`)
      logAudit({
        schoolId, userId: profile?.id ?? null, action: 'CREATE', entityType: 'teacher_assignment',
        entityId: teacherId, newValue: { teacher: teacher ? `${teacher.first_name} ${teacher.last_name}` : undefined, class: classLabel(cls), via: 'section_admin' }
      })
      setTeacherId('')
      setClassId('')
      setSubjectId(NONE_VALUE)
      qc.invalidateQueries({ queryKey: ['teacher-assignments'] })
    },
    onError: (e: Error) => toast.error(e.message.includes('duplicate key') ? 'Already assigned to that class/subject.' : e.message)
  })

  return (
    <Card>
      <CardContent className="pt-6 space-y-4 max-w-lg">
        <FormField label="Teacher" required>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger><SelectValue placeholder="Select a teacher" /></SelectTrigger>
            <SelectContent>
              {teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Class" required hint="Only classes in your managed section(s) are shown">
          <Select value={classId} onValueChange={v => { setClassId(v); setSubjectId(NONE_VALUE) }}>
            <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {managedClasses.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Subject" hint="Leave as Form Teacher (whole class) or pick a specific subject">
          <Select value={subjectId} onValueChange={setSubjectId} disabled={!classId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Form Teacher (whole class)</SelectItem>
              {subjectsForClass.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <Button disabled={!teacherId || !classId || assign.isPending} onClick={() => assign.mutate()}>
          {assign.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Assign
        </Button>
      </CardContent>
    </Card>
  )
}

// ══════════════════════════════════════════════════════════
// DOCUMENTS — bulk report cards / transcripts for a managed class.
// Deliberately offers only the BULK, class-scoped actions (which the
// class picker below keeps within managedClasses) rather than also
// linking to the single-student Report Card / Transcript pages — both
// of those have their own school-wide student search built in with no
// class/section awareness, and exposing that here would hand out a
// "browse every student in the school" picker through a feature meant
// to stay scoped to the section(s) actually granted. The routes exist
// (/teacher/section-admin/report-card, /transcript) if that's ever
// wanted later, just not linked from this panel yet.
// ══════════════════════════════════════════════════════════
function DocumentsPanel({ currentSession, currentTerm, managedClasses, classLabel }: {
  currentSession: Session | null | undefined; currentTerm: Term | null | undefined
  managedClasses: Class[]; classLabel: (cls?: Class) => string
}) {
  const [classId, setClassId] = useState('')

  if (!currentSession || !currentTerm) {
    return <p className="text-sm text-muted-foreground">No current session/term is set — ask your school admin to mark one as current.</p>
  }

  const bulkReportCardsUrl = `/teacher/section-admin/bulk-report-cards?class=${classId}&term=${currentTerm.id}&session=${currentSession.id}`
  const bulkTranscriptsUrl = `/teacher/section-admin/bulk-transcripts?class=${classId}&session=${currentSession.id}`

  return (
    <Card>
      <CardContent className="pt-6 space-y-4 max-w-lg">
        <FormField label="Class" required hint="Only classes in your managed section(s) are shown">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {managedClasses.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <div className="flex flex-wrap gap-3">
          <Button asChild disabled={!classId} variant={classId ? 'default' : 'outline'}>
            <Link to={classId ? bulkReportCardsUrl : '#'} aria-disabled={!classId}>
              <Download className="mr-2 h-4 w-4" />Bulk Report Cards ({currentTerm.name})
            </Link>
          </Button>
          <Button asChild disabled={!classId} variant={classId ? 'default' : 'outline'}>
            <Link to={classId ? bulkTranscriptsUrl : '#'} aria-disabled={!classId}>
              <Download className="mr-2 h-4 w-4" />Bulk Transcripts
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
