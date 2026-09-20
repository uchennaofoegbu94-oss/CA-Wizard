import { useMemo, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Printer, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { exportNodeToPdf } from '@/lib/pdfExport'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, Spinner, EmptyState } from '@/components/ui/table'
import { ReportCardDocument, type ReportCardRow } from '@/components/ReportCardDocument'
import toast from 'react-hot-toast'
import type {
  Student, Class, Term, School, Subject, AssessmentCategory, ScoreFieldValue,
  GradingSystem, GradeRange, Attendance, Comment,
  AffectiveMetric, AffectiveScore, PsychomotorMetric, PsychomotorScore
} from '@/types'

function gradeFor(percentage: number, ranges: GradeRange[]): { grade: string; remark: string } {
  const match = ranges.find(r => percentage >= r.min_score && percentage <= r.max_score)
  return match ? { grade: match.grade, remark: match.remark ?? '' } : { grade: '—', remark: '—' }
}

export default function ReportCardPage() {
  const { schoolId, profile, role } = useAuth()
  const [params] = useSearchParams()
  const studentId = params.get('student') ?? ''
  const classId = params.get('class') ?? ''
  const termId = params.get('term') ?? ''
  const sessionId = params.get('session') ?? ''
  // Carries the same session/class/term straight back to Reports so
  // the view an admin was on (not a blank one) is what they land on —
  // except for a section admin (still role 'teacher'), who reaches
  // this page from their own Documents tab and has no access to the
  // school-admin Reports route to go back to.
  const backToReportsUrl = role === 'teacher'
    ? '/teacher/section-admin'
    : `/school/reports?session=${sessionId}&class=${classId}&term=${termId}`
  const printRef = useRef<HTMLDivElement>(null)

  const ready = !!studentId && !!classId && !!termId

  const { data: school } = useQuery({
    queryKey: ['reportcard-school', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  const { data: student } = useQuery({
    queryKey: ['reportcard-student', studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*').eq('id', studentId).single()
      if (error) throw error
      return data as Student
    },
    enabled: ready
  })

  const { data: cls } = useQuery({
    queryKey: ['reportcard-class', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, class_level:class_levels(*), class_arm:class_arms(*), session:sessions(*)').eq('id', classId).single()
      if (error) throw error
      return data as Class
    },
    enabled: ready
  })

  const { data: term } = useQuery({
    queryKey: ['reportcard-term', termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('id', termId).single()
      if (error) throw error
      return data as Term
    },
    enabled: ready
  })

  const { data: subjects = [] } = useQuery({
    queryKey: ['reportcard-subjects', cls?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subject_offerings').select('subject:subjects(*)').eq('class_level_id', cls!.class_level_id)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!cls?.class_level_id
  })

  // The school's report-card-visible fields (excluding the total field,
  // which is rendered as its own dedicated Total column), in
  // order_index order — these become this report card's dynamic
  // columns, and are the same across every subject since fields are
  // configured school-wide, not per subject.
  const { data: fieldColumns = [] } = useQuery({
    queryKey: ['reportcard-field-columns', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assessment_categories')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('is_active', true)
        .eq('show_on_report_card', true)
        .eq('is_total_field', false)
        .order('order_index')
      if (error) throw error
      return (data as AssessmentCategory[]).map(f => ({ id: f.id, name: f.name }))
    },
    enabled: !!schoolId
  })

  // One get_score_fields RPC call per subject this student takes —
  // each returns every field's value for that subject (input fields +
  // the computed Total), which we then filter down to what's
  // show_on_report_card for the table plus the is_total_field row for
  // Total/percentage/grade.
  const { data: fieldsBySubject = {} } = useQuery({
    queryKey: ['reportcard-fields', studentId, termId, subjects.map(s => s.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(subjects.map(async subj => {
        const { data, error } = await supabase.rpc('get_score_fields', {
          p_student_id: studentId, p_subject_id: subj.id, p_term_id: termId
        })
        if (error) throw error
        return [subj.id, (data ?? []) as ScoreFieldValue[]] as const
      }))
      return Object.fromEntries(entries) as Record<string, ScoreFieldValue[]>
    },
    enabled: ready && subjects.length > 0
  })

  const { data: gradingSystem } = useQuery({
    queryKey: ['reportcard-grading', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('grading_systems').select('*, grade_ranges(*)').eq('school_id', schoolId!).eq('is_default', true).maybeSingle()
      if (error) throw error
      return data as (GradingSystem & { grade_ranges: GradeRange[] }) | null
    },
    enabled: !!schoolId
  })

  const { data: attendance } = useQuery({
    queryKey: ['reportcard-attendance', studentId, termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('*').eq('student_id', studentId).eq('term_id', termId).maybeSingle()
      if (error) throw error
      return data as Attendance | null
    },
    enabled: ready
  })

  const { data: comment } = useQuery({
    queryKey: ['reportcard-comment', studentId, termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('comments').select('*').eq('student_id', studentId).eq('term_id', termId).maybeSingle()
      if (error) throw error
      return data as Comment | null
    },
    enabled: ready
  })

  const { data: affectiveMetrics = [] } = useQuery({
    queryKey: ['reportcard-affective-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as AffectiveMetric[]
    },
    enabled: !!schoolId
  })

  const { data: affectiveScores = [] } = useQuery({
    queryKey: ['reportcard-affective-scores', studentId, termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_scores').select('*').eq('student_id', studentId).eq('term_id', termId)
      if (error) throw error
      return data as AffectiveScore[]
    },
    enabled: ready
  })

  const { data: psychomotorMetrics = [] } = useQuery({
    queryKey: ['reportcard-psychomotor-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as PsychomotorMetric[]
    },
    enabled: !!schoolId
  })

  const { data: psychomotorScores = [] } = useQuery({
    queryKey: ['reportcard-psychomotor-scores', studentId, termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_scores').select('*').eq('student_id', studentId).eq('term_id', termId)
      if (error) throw error
      return data as PsychomotorScore[]
    },
    enabled: ready
  })

  // Ranking: for every subject, get every classmate's field breakdown
  // via get_class_subject_term_results, then sum each student's
  // is_total_field value (raw points, same combined-total basis the
  // old term_total ranking used) across subjects.
  const { data: classmateTotals = [] } = useQuery({
    queryKey: ['reportcard-classmates', classId, termId, subjects.map(s => s.id).join(',')],
    queryFn: async () => {
      const perSubject = await Promise.all(subjects.map(async subj => {
        const { data, error } = await supabase.rpc('get_class_subject_term_results', {
          p_class_id: classId, p_subject_id: subj.id, p_term_id: termId
        })
        if (error) throw error
        return (data ?? []) as ScoreFieldValue[]
      }))
      const totalsByStudent = new Map<string, number>()
      perSubject.flat().forEach(row => {
        if (!row.is_total_field || !row.student_id) return
        totalsByStudent.set(row.student_id, (totalsByStudent.get(row.student_id) ?? 0) + row.value)
      })
      return Array.from(totalsByStudent.entries())
        .map(([studentId, total]) => ({ studentId, total }))
        .sort((a, b) => b.total - a.total)
    },
    enabled: ready && subjects.length > 0
  })

  const position = useMemo(() => {
    const idx = classmateTotals.findIndex(c => c.studentId === studentId)
    return idx === -1 ? null : { rank: idx + 1, outOf: classmateTotals.length }
  }, [classmateTotals, studentId])

  const rows: ReportCardRow[] = useMemo(() => {
    const ranges = gradingSystem?.grade_ranges ?? []
    return subjects.map(subj => {
      const fields = fieldsBySubject[subj.id] ?? []
      const totalField = fields.find(f => f.is_total_field)
      const percentage = totalField && totalField.max_value > 0
        ? Math.round((totalField.value / totalField.max_value) * 10000) / 100
        : 0
      const { grade, remark } = gradeFor(percentage, ranges)
      const visibleFields = fields.filter(f => f.show_on_report_card && !f.is_total_field)
      return {
        subject: subj,
        fields: visibleFields.map(f => ({ field_id: f.field_id, value: f.value })),
        total: totalField?.value ?? 0,
        totalMax: totalField?.max_value ?? 0,
        percentage,
        grade,
        remark
      }
    })
  }, [subjects, fieldsBySubject, gradingSystem])

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
  const average = rows.length > 0 ? Math.round((rows.reduce((s, r) => s + r.percentage, 0) / rows.length) * 100) / 100 : 0

  const saveSnapshot = useMutation({
    mutationFn: async () => {
      const snapshotData = {
        school: { name: school?.name, motto: school?.motto, address: school?.address },
        student: { name: `${student?.first_name} ${student?.last_name}`, admission_number: student?.admission_number, photo_url: student?.photo_url ?? null },
        class: `${cls?.class_level?.name ?? ''}${cls?.class_arm ? ' ' + cls.class_arm.name : ''}`,
        term: term?.name,
        fieldColumns,
        subjects: rows,
        grandTotal,
        average,
        position,
        attendance: attendance ? { present: attendance.days_present, absent: attendance.days_absent, total: attendance.total_days } : null,
        comment: comment ? { teacher: comment.teacher_comment, management: comment.management_comment } : null,
        affective: affectiveMetrics.map(m => ({ name: m.name, rating: affectiveScores.find(s => s.metric_id === m.id)?.rating ?? null })),
        psychomotor: psychomotorMetrics.map(m => ({ name: m.name, rating: psychomotorScores.find(s => s.metric_id === m.id)?.rating ?? null })),
        generatedAt: new Date().toISOString()
      }
      const { error } = await supabase.from('report_snapshots').upsert({
        school_id: schoolId, student_id: studentId, term_id: termId, class_id: classId,
        snapshot_data: snapshotData, generated_by: profile?.id ?? null, generated_at: new Date().toISOString()
      }, { onConflict: 'student_id,term_id' })
      if (error) throw error
    },
    onSuccess: () => toast.success('Report card snapshot saved — preserved even if scores change later'),
    onError: (e: Error) => toast.error(e.message)
  })

  const downloadPdf = async () => {
    if (!printRef.current || !student) return
    const termSession = [term?.name, cls?.session?.name].filter(Boolean).join('-')
    const filename = `${student.first_name}_${student.last_name}_${termSession || 'ReportCard'}.pdf`.replace(/\s+/g, '_')
    toast.loading('Generating PDF…', { id: 'pdf-gen' })
    try {
      await exportNodeToPdf(printRef.current, filename)
      toast.success('PDF downloaded', { id: 'pdf-gen' })
    } catch {
      toast.error('Could not generate PDF', { id: 'pdf-gen' })
    }
  }

  if (!ready) {
    return (
      <div>
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <EmptyState title="Missing information" description="Open this page from the Reports broadsheet by clicking a student's report icon." />
      </div>
    )
  }

  const isLoading = !student || !cls || !term
  const gradeRanges = gradingSystem?.grade_ranges ?? []

  return (
    <div>
      <div className="no-print">
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <PageHeader
          title="Report Card"
          description={student ? `${student.first_name} ${student.last_name}` : 'Loading…'}
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadPdf}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
              <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
              <Button onClick={() => saveSnapshot.mutate()} disabled={saveSnapshot.isPending}>
                {saveSnapshot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Snapshot
              </Button>
            </div>
          }
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <Card className="print:shadow-none print:border-none overflow-hidden w-fit mx-auto">
          <CardContent className="p-0">
            <ReportCardDocument
              ref={printRef}
              school={school}
              student={student}
              cls={cls}
              term={term}
              fieldColumns={fieldColumns}
              rows={rows}
              grandTotal={grandTotal}
              average={average}
              position={position}
              attendance={attendance}
              comment={comment}
              gradeRanges={gradeRanges}
              affectiveMetrics={affectiveMetrics}
              affectiveScores={affectiveScores}
              psychomotorMetrics={psychomotorMetrics}
              psychomotorScores={psychomotorScores}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
