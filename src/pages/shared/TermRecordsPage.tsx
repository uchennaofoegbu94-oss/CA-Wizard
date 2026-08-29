import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ClipboardEdit, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type {
  Term, Class, Student, StudentEnrollment, TeacherAssignment,
  Attendance, Comment, AffectiveMetric, AffectiveScore,
  PsychomotorMetric, PsychomotorScore
} from '@/types'

const RATINGS = ['5', '4', '3', '2', '1'] as const

export default function TermRecordsPage() {
  const { schoolId, profile, role } = useAuth()
  const qc = useQueryClient()

  const [selectedClassId, setSelectedClassId] = useState('')
  const [recordsFor, setRecordsFor] = useState<Student | null>(null)

  const { data: currentSession } = useQuery({
    queryKey: ['records-current-session', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!schoolId
  })

  const { data: adminClasses = [] } = useQuery({
    queryKey: ['records-admin-classes', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*, class_level:class_levels(*), class_arm:class_arms(*)')
        .eq('school_id', schoolId!)
        .eq('session_id', currentSession!.id)
      if (error) throw error
      return data as Class[]
    },
    enabled: !!schoolId && !!currentSession?.id && role === 'school_admin'
  })

  const { data: teacherAssignments = [] } = useQuery({
    queryKey: ['records-teacher-assignments', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select('*, class:classes(*, class_level:class_levels(*), class_arm:class_arms(*))')
        .eq('teacher_id', profile!.id)
        .eq('scope', 'CLASS')
        .is('subject_id', null)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!profile?.id && role === 'teacher'
  })

  const selectableClasses = role === 'school_admin'
    ? adminClasses
    : (teacherAssignments.map(a => a.class).filter(Boolean) as Class[])

  const { data: term } = useQuery({
    queryKey: ['records-term', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Term | null
    },
    enabled: !!schoolId
  })

  const { data: enrollments = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['records-enrollments', selectedClassId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*, student:students(*)').eq('class_id', selectedClassId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student?.status === 'active')
    },
    enabled: !!selectedClassId
  })

  const students = enrollments.map(e => e.student!).filter(Boolean)

  const { data: affectiveMetrics = [] } = useQuery({
    queryKey: ['affective-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as AffectiveMetric[]
    },
    enabled: !!schoolId
  })

  const { data: psychomotorMetrics = [] } = useQuery({
    queryKey: ['psychomotor-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as PsychomotorMetric[]
    },
    enabled: !!schoolId
  })

  const { data: recordedStudentIds } = useQuery({
    queryKey: ['records-status', selectedClassId, term?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('comments').select('student_id').eq('class_id', selectedClassId).eq('term_id', term!.id)
      if (error) throw error
      return new Set((data ?? []).map(r => r.student_id))
    },
    enabled: !!selectedClassId && !!term?.id,
    initialData: new Set<string>()
  })

  const noSelection = !selectedClassId

  return (
    <div>
      <PageHeader
        title="Term Records"
        description={term ? `${term.name} — Attendance, comments, and character ratings` : 'No active term'}
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {selectableClasses.map(cls => (
                <SelectItem key={cls.id} value={cls.id}>
                  {cls.class_level?.name}{cls.class_arm ? ' ' + cls.class_arm.name : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {role === 'teacher' && selectableClasses.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              You need a Form Teacher assignment (no specific subject) to record attendance and comments for a class.
            </p>
          )}
        </CardContent>
      </Card>

      {noSelection ? (
        <EmptyState icon={<ClipboardEdit className="h-12 w-12" />} title="Select a class" />
      ) : !term ? (
        <EmptyState title="No active term" />
      ) : loadingStudents ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : students.length === 0 ? (
        <EmptyState icon={<Users className="h-12 w-12" />} title="No students enrolled" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Student</TableHead><TableHead>Status</TableHead><TableHead className="w-32" /></TableRow>
              </TableHeader>
              <TableBody>
                {students.map(student => (
                  <TableRow key={student.id}>
                    <TableCell className="text-sm font-medium">{student.last_name}, {student.first_name}</TableCell>
                    <TableCell>
                      {recordedStudentIds.has(student.id)
                        ? <Badge variant="success">Recorded</Badge>
                        : <Badge variant="outline" className="text-xs">Not yet</Badge>
                      }
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setRecordsFor(student)}>Edit Records</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {recordsFor && term && (
        <RecordsDialog
          student={recordsFor}
          classId={selectedClassId}
          term={term}
          affectiveMetrics={affectiveMetrics}
          psychomotorMetrics={psychomotorMetrics}
          onClose={() => setRecordsFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['records-status', selectedClassId, term.id] })
            setRecordsFor(null)
          }}
        />
      )}
    </div>
  )
}

interface RecordsDialogProps {
  student: Student
  classId: string
  term: Term
  affectiveMetrics: AffectiveMetric[]
  psychomotorMetrics: PsychomotorMetric[]
  onClose: () => void
  onSaved: () => void
}

function RecordsDialog({ student, classId, term, affectiveMetrics, psychomotorMetrics, onClose, onSaved }: RecordsDialogProps) {
  const { schoolId, profile } = useAuth()
  const [daysPresent, setDaysPresent] = useState('')
  const [daysAbsent, setDaysAbsent] = useState('')
  const [teacherComment, setTeacherComment] = useState('')
  const [managementComment, setManagementComment] = useState('')
  const [affectiveRatings, setAffectiveRatings] = useState<Record<string, string>>({})
  const [psychomotorRatings, setPsychomotorRatings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['records-existing', student.id, term.id],
    queryFn: async () => {
      const [att, comm, aff, psych] = await Promise.all([
        supabase.from('attendance').select('*').eq('student_id', student.id).eq('term_id', term.id).maybeSingle(),
        supabase.from('comments').select('*').eq('student_id', student.id).eq('term_id', term.id).maybeSingle(),
        supabase.from('affective_scores').select('*').eq('student_id', student.id).eq('term_id', term.id),
        supabase.from('psychomotor_scores').select('*').eq('student_id', student.id).eq('term_id', term.id)
      ])
      return {
        attendance: att.data as Attendance | null,
        comment: comm.data as Comment | null,
        affective: (aff.data ?? []) as AffectiveScore[],
        psychomotor: (psych.data ?? []) as PsychomotorScore[]
      }
    }
  })

  useEffect(() => {
    if (existing) {
      setDaysPresent(existing.attendance?.days_present?.toString() ?? '')
      setDaysAbsent(existing.attendance?.days_absent?.toString() ?? '')
      setTeacherComment(existing.comment?.teacher_comment ?? '')
      setManagementComment(existing.comment?.management_comment ?? '')
      const aff: Record<string, string> = {}
      existing.affective.forEach(a => { aff[a.metric_id] = a.rating })
      setAffectiveRatings(aff)
      const psych: Record<string, string> = {}
      existing.psychomotor.forEach(p => { psych[p.metric_id] = p.rating })
      setPsychomotorRatings(psych)
    }
  }, [existing])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (daysPresent || daysAbsent) {
        const { error } = await supabase.from('attendance').upsert({
          school_id: schoolId, student_id: student.id, class_id: classId, term_id: term.id,
          days_present: Number(daysPresent) || 0, days_absent: Number(daysAbsent) || 0,
          entered_by: profile?.id ?? null
        }, { onConflict: 'student_id,term_id' })
        if (error) throw error
      }

      if (teacherComment || managementComment) {
        const { error } = await supabase.from('comments').upsert({
          school_id: schoolId, student_id: student.id, class_id: classId, term_id: term.id,
          teacher_comment: teacherComment || null, management_comment: managementComment || null
        }, { onConflict: 'student_id,term_id' })
        if (error) throw error
      }

      for (const metric of affectiveMetrics) {
        const rating = affectiveRatings[metric.id]
        if (rating) {
          const { error } = await supabase.from('affective_scores').upsert({
            school_id: schoolId, student_id: student.id, metric_id: metric.id, term_id: term.id, class_id: classId,
            rating, entered_by: profile?.id ?? null
          }, { onConflict: 'student_id,metric_id,term_id' })
          if (error) throw error
        }
      }

      for (const metric of psychomotorMetrics) {
        const rating = psychomotorRatings[metric.id]
        if (rating) {
          const { error } = await supabase.from('psychomotor_scores').upsert({
            school_id: schoolId, student_id: student.id, metric_id: metric.id, term_id: term.id, class_id: classId,
            rating, entered_by: profile?.id ?? null
          }, { onConflict: 'student_id,metric_id,term_id' })
          if (error) throw error
        }
      }

      toast.success('Records saved')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{student.first_name} {student.last_name}</DialogTitle>
          <DialogDescription>{term.name} — Attendance, comments, and ratings</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <p className="text-sm font-semibold mb-2">Attendance</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Days Present" htmlFor="daysPresent">
                  <Input id="daysPresent" type="number" min="0" value={daysPresent} onChange={e => setDaysPresent(e.target.value)} />
                </FormField>
                <FormField label="Days Absent" htmlFor="daysAbsent">
                  <Input id="daysAbsent" type="number" min="0" value={daysAbsent} onChange={e => setDaysAbsent(e.target.value)} />
                </FormField>
              </div>
            </div>

            {affectiveMetrics.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Affective Domain</p>
                <div className="space-y-2">
                  {affectiveMetrics.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">{m.name}</span>
                      <Select value={affectiveRatings[m.id] ?? ''} onValueChange={v => setAffectiveRatings(prev => ({ ...prev, [m.id]: v }))}>
                        <SelectTrigger className="w-20"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {psychomotorMetrics.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Psychomotor Domain</p>
                <div className="space-y-2">
                  {psychomotorMetrics.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">{m.name}</span>
                      <Select value={psychomotorRatings[m.id] ?? ''} onValueChange={v => setPsychomotorRatings(prev => ({ ...prev, [m.id]: v }))}>
                        <SelectTrigger className="w-20"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-semibold mb-2">Comments</p>
              <FormField label="Teacher's Comment" htmlFor="teacherComment">
                <Textarea id="teacherComment" rows={2} value={teacherComment} onChange={e => setTeacherComment(e.target.value)} />
              </FormField>
              <div className="mt-3">
                <FormField label="Management's Comment" htmlFor="managementComment">
                  <Textarea id="managementComment" rows={2} value={managementComment} onChange={e => setManagementComment(e.target.value)} />
                </FormField>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Records
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
