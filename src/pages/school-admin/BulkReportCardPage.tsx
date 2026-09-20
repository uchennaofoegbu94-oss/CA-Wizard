import { useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, FileArchive, Loader2, Save } from 'lucide-react'
import JSZip from 'jszip'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { canUseBulkGeneration } from '@/lib/tierLimits'
import { combineNodesToPdf, nodeToPdfBlob } from '@/lib/pdfExport'
import { Button } from '@/components/ui/button'
import { PageHeader, Spinner, EmptyState } from '@/components/ui/table'
import { ReportCardDocument, type ReportCardRow } from '@/components/ReportCardDocument'
import toast from 'react-hot-toast'
import type {
  Student, Class, Term, School, Subject, AssessmentCategory, ScoreFieldValue, StudentEnrollment,
  GradingSystem, GradeRange, Attendance, Comment,
  AffectiveMetric, AffectiveScore, PsychomotorMetric, PsychomotorScore
} from '@/types'

function gradeFor(percentage: number, ranges: GradeRange[]): { grade: string; remark: string } {
  const match = ranges.find(r => percentage >= r.min_score && percentage <= r.max_score)
  return match ? { grade: match.grade, remark: match.remark ?? '' } : { grade: '—', remark: '—' }
}

// Bulk generation for an entire class/term at once. Every query below is
// batched by class/term rather than looped per student — a class of 40
// students would otherwise mean 40x the round trips of the single
// ReportCardPage. get_class_all_fields is one RPC call for every
// student x subject x field in the class, replacing what would
// otherwise be hundreds of individual queries. Each student's report
// card is rendered off-screen (once all data has arrived) using the
// same ReportCardDocument used by the single-student page, then
// captured to PDF. Output is both a single combined multi-page PDF
// (for printing the whole class as a batch) and a zip of
// individually-named PDFs (for emailing/distributing per student).
export default function BulkReportCardPage() {
  const { schoolId, subscriptionTier, profile, role } = useAuth()
  const [params] = useSearchParams()
  const classId = params.get('class') ?? ''
  const termId = params.get('term') ?? ''
  const sessionId = params.get('session') ?? ''
  // A section admin (still role 'teacher') reaches this same page via
  // their own Documents tab rather than the school-admin Reports
  // picker — send "back" there instead, or the link would 404 into a
  // route they don't have access to.
  const backToReportsUrl = role === 'teacher'
    ? '/teacher/section-admin'
    : `/school/reports?session=${sessionId}&class=${classId}&term=${termId}`
  const ready = !!classId && !!termId

  const [generating, setGenerating] = useState<'combined' | 'zip' | null>(null)
  const [progress, setProgress] = useState(0)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { data: school } = useQuery({
    queryKey: ['bulk-reportcard-school', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  const { data: cls } = useQuery({
    queryKey: ['bulk-reportcard-class', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, class_level:class_levels(*), class_arm:class_arms(*), session:sessions(*)').eq('id', classId).single()
      if (error) throw error
      return data as Class
    },
    enabled: ready
  })

  const { data: term } = useQuery({
    queryKey: ['bulk-reportcard-term', termId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('id', termId).single()
      if (error) throw error
      return data as Term
    },
    enabled: ready
  })

  const { data: subjects = [] } = useQuery({
    queryKey: ['bulk-reportcard-subjects', cls?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subject_offerings').select('subject:subjects(*)').eq('class_level_id', cls!.class_level_id)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!cls?.class_level_id
  })

  const { data: enrollments = [] } = useQuery({
    queryKey: ['bulk-reportcard-enrollments', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*, student:students(*)').eq('class_id', classId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student).sort((a, b) =>
        (a.student!.last_name + a.student!.first_name).localeCompare(b.student!.last_name + b.student!.first_name)
      )
    },
    enabled: ready
  })

  const students = useMemo(() => enrollments.map(e => e.student!).filter(Boolean), [enrollments])
  const studentIds = useMemo(() => students.map(s => s.id), [students])

  // The school's report-card-visible fields (excluding the total field),
  // in order_index order — same dynamic columns as ReportCardPage.
  const { data: fieldColumns = [] } = useQuery({
    queryKey: ['bulk-reportcard-field-columns', schoolId],
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

  const { data: gradingSystem } = useQuery({
    queryKey: ['bulk-reportcard-grading', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('grading_systems').select('*, grade_ranges(*)').eq('school_id', schoolId!).eq('is_default', true).maybeSingle()
      if (error) throw error
      return data as (GradingSystem & { grade_ranges: GradeRange[] }) | null
    },
    enabled: !!schoolId
  })

  // One bulk call for every student x subject x field in the class.
  const { data: allFields = [] } = useQuery({
    queryKey: ['bulk-reportcard-fields', classId, termId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_class_all_fields', { p_class_id: classId, p_term_id: termId })
      if (error) throw error
      return (data ?? []) as ScoreFieldValue[]
    },
    enabled: ready
  })

  const { data: attendanceRows = [] } = useQuery({
    queryKey: ['bulk-reportcard-attendance', termId, studentIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('*').eq('term_id', termId).in('student_id', studentIds)
      if (error) throw error
      return data as Attendance[]
    },
    enabled: ready && studentIds.length > 0
  })

  const { data: comments = [] } = useQuery({
    queryKey: ['bulk-reportcard-comments', termId, studentIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('comments').select('*').eq('term_id', termId).in('student_id', studentIds)
      if (error) throw error
      return data as Comment[]
    },
    enabled: ready && studentIds.length > 0
  })

  const { data: affectiveMetrics = [] } = useQuery({
    queryKey: ['bulk-reportcard-affective-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as AffectiveMetric[]
    },
    enabled: !!schoolId
  })

  const { data: affectiveScores = [] } = useQuery({
    queryKey: ['bulk-reportcard-affective-scores', termId, studentIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_scores').select('*').eq('term_id', termId).in('student_id', studentIds)
      if (error) throw error
      return data as AffectiveScore[]
    },
    enabled: ready && studentIds.length > 0
  })

  const { data: psychomotorMetrics = [] } = useQuery({
    queryKey: ['bulk-reportcard-psychomotor-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as PsychomotorMetric[]
    },
    enabled: !!schoolId
  })

  const { data: psychomotorScores = [] } = useQuery({
    queryKey: ['bulk-reportcard-psychomotor-scores', termId, studentIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_scores').select('*').eq('term_id', termId).in('student_id', studentIds)
      if (error) throw error
      return data as PsychomotorScore[]
    },
    enabled: ready && studentIds.length > 0
  })

  // Class-wide totals per student, for ranking — sum of each student's
  // is_total_field value across every subject.
  const totalsByStudent = useMemo(() => {
    const map = new Map<string, number>()
    allFields.forEach(row => {
      if (!row.is_total_field || !row.student_id) return
      map.set(row.student_id, (map.get(row.student_id) ?? 0) + row.value)
    })
    return map
  }, [allFields])

  const ranking = useMemo(() => {
    return [...students].sort((a, b) => (totalsByStudent.get(b.id) ?? 0) - (totalsByStudent.get(a.id) ?? 0)).map(s => s.id)
  }, [students, totalsByStudent])

  const gradeRanges = gradingSystem?.grade_ranges ?? []

  interface PerStudentData {
    student: Student
    rows: ReportCardRow[]
    grandTotal: number
    average: number
    position: { rank: number; outOf: number } | null
    attendance: Attendance | undefined
    comment: Comment | undefined
  }

  const perStudent: PerStudentData[] = useMemo(() => {
    return students.map(student => {
      const rows: ReportCardRow[] = subjects.map(subj => {
        const fieldsForCell = allFields.filter(f => f.student_id === student.id && f.subject_id === subj.id)
        const totalField = fieldsForCell.find(f => f.is_total_field)
        const percentage = totalField && totalField.max_value > 0
          ? Math.round((totalField.value / totalField.max_value) * 10000) / 100
          : 0
        const { grade, remark } = gradeFor(percentage, gradeRanges)
        const visibleFields = fieldsForCell.filter(f => f.show_on_report_card && !f.is_total_field)
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
      const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
      const average = rows.length > 0 ? Math.round((rows.reduce((s, r) => s + r.percentage, 0) / rows.length) * 100) / 100 : 0
      const rankIdx = ranking.indexOf(student.id)
      const position = rankIdx === -1 ? null : { rank: rankIdx + 1, outOf: ranking.length }
      return {
        student,
        rows,
        grandTotal,
        average,
        position,
        attendance: attendanceRows.find(a => a.student_id === student.id),
        comment: comments.find(c => c.student_id === student.id)
      }
    })
  }, [students, subjects, allFields, gradeRanges, ranking, attendanceRows, comments])

  const isLoading = !cls || !term || (studentIds.length > 0 && allFields.length === 0 && totalsByStudent.size === 0)
  const classLabel = cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''
  const baseFilename = `${classLabel}_${term?.name ?? ''}_ReportCards`.replace(/\s+/g, '_')

  // Bulk-save every student's report card snapshot in one round trip —
  // Supabase's upsert() accepts an array, so this is a single query
  // regardless of class size, not N individual saves. Builds the exact
  // same snapshot_data shape ReportCardPage.tsx's single-student
  // saveSnapshot does (school/student/class/term/fieldColumns/subjects/
  // grandTotal/average/position/attendance/comment/affective/
  // psychomotor), just sourced from perStudent (already computed above
  // for the PDF render) instead of single-student query results.
  const [savingSnapshots, setSavingSnapshots] = useState(false)

  const saveBulkSnapshots = async () => {
    if (perStudent.length === 0) return
    setSavingSnapshots(true)
    toast.loading(`Saving ${perStudent.length} snapshot${perStudent.length === 1 ? '' : 's'}…`, { id: 'bulk-snapshots' })
    try {
      const now = new Date().toISOString()
      const rows = perStudent.map(p => {
        const snapshotData = {
          school: { name: school?.name, motto: school?.motto, address: school?.address },
          student: { name: `${p.student.first_name} ${p.student.last_name}`, admission_number: p.student.admission_number, photo_url: p.student.photo_url ?? null },
          class: classLabel,
          term: term?.name,
          fieldColumns,
          subjects: p.rows,
          grandTotal: p.grandTotal,
          average: p.average,
          position: p.position,
          attendance: p.attendance ? { present: p.attendance.days_present, absent: p.attendance.days_absent, total: p.attendance.total_days } : null,
          comment: p.comment ? { teacher: p.comment.teacher_comment, management: p.comment.management_comment } : null,
          affective: affectiveMetrics.map(m => ({ name: m.name, rating: affectiveScores.find(s => s.metric_id === m.id && s.student_id === p.student.id)?.rating ?? null })),
          psychomotor: psychomotorMetrics.map(m => ({ name: m.name, rating: psychomotorScores.find(s => s.metric_id === m.id && s.student_id === p.student.id)?.rating ?? null })),
          generatedAt: now
        }
        return {
          school_id: schoolId, student_id: p.student.id, term_id: termId, class_id: classId,
          snapshot_data: snapshotData, generated_by: profile?.id ?? null, generated_at: now
        }
      })
      const { error } = await supabase.from('report_snapshots').upsert(rows, { onConflict: 'student_id,term_id' })
      if (error) throw error
      toast.success(`${perStudent.length} report card snapshot${perStudent.length === 1 ? '' : 's'} saved — preserved even if scores change later`, { id: 'bulk-snapshots' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save snapshots', { id: 'bulk-snapshots' })
    } finally {
      setSavingSnapshots(false)
    }
  }

  const generateCombined = async () => {
    if (perStudent.length === 0) return
    setGenerating('combined')
    setProgress(0)
    toast.loading('Generating combined PDF…', { id: 'bulk-combined' })
    try {
      const nodes = perStudent
        .map(p => nodeRefs.current[p.student.id])
        .filter((n): n is HTMLDivElement => !!n)
      const pdf = await combineNodesToPdf(nodes)
      pdf.save(`${baseFilename}.pdf`)
      toast.success(`Combined PDF ready — ${perStudent.length} report cards`, { id: 'bulk-combined' })
    } catch {
      toast.error('Could not generate the combined PDF', { id: 'bulk-combined' })
    } finally {
      setGenerating(null)
      setProgress(0)
    }
  }

  const generateZip = async () => {
    if (perStudent.length === 0) return
    setGenerating('zip')
    setProgress(0)
    toast.loading(`Generating 0 of ${perStudent.length}…`, { id: 'bulk-zip' })
    try {
      const zip = new JSZip()
      for (let i = 0; i < perStudent.length; i++) {
        const { student } = perStudent[i]
        const node = nodeRefs.current[student.id]
        if (!node) continue
        const blob = await nodeToPdfBlob(node)
        const termSession = [term?.name, cls?.session?.name].filter(Boolean).join('-')
        const filename = `${student.first_name}_${student.last_name}_${termSession || 'ReportCard'}.pdf`.replace(/\s+/g, '_')
        zip.file(filename, blob)
        setProgress(i + 1)
        toast.loading(`Generating ${i + 1} of ${perStudent.length}…`, { id: 'bulk-zip' })
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseFilename}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Zip ready — ${perStudent.length} report cards`, { id: 'bulk-zip' })
    } catch {
      toast.error('Could not generate the zip', { id: 'bulk-zip' })
    } finally {
      setGenerating(null)
      setProgress(0)
    }
  }

  if (!ready) {
    return (
      <div>
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <EmptyState title="Missing information" description="Open this page from Reports by choosing a class and term, then clicking Bulk Generate." />
      </div>
    )
  }

  if (!canUseBulkGeneration(subscriptionTier)) {
    return (
      <div>
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <EmptyState title="Upgrade required" description="Batch report card generation requires the Professional plan or higher." />
      </div>
    )
  }

  return (
    <div>
      <div className="no-print">
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <PageHeader
          title="Bulk Report Cards"
          description={cls && term ? `${classLabel} — ${term.name}` : 'Loading…'}
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={saveBulkSnapshots} disabled={savingSnapshots || perStudent.length === 0}>
                {savingSnapshots ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Bulk Save Snapshots
              </Button>
              <Button variant="outline" onClick={generateZip} disabled={!!generating || perStudent.length === 0}>
                {generating === 'zip' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
                {generating === 'zip' ? `Zipping ${progress}/${perStudent.length}…` : 'Download Zip (per student)'}
              </Button>
              <Button onClick={generateCombined} disabled={!!generating || perStudent.length === 0}>
                {generating === 'combined' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Combined PDF
              </Button>
            </div>
          }
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : perStudent.length === 0 ? (
        <EmptyState title="No students enrolled" description="This class has no active enrollments for this session." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {perStudent.length} student{perStudent.length === 1 ? '' : 's'} ready. Each report card below is rendered off-screen purely
            for PDF capture — this preview area is intentionally not meant to be read directly; use Download Combined PDF or Download Zip.
          </p>

          {/* Off-screen render target: every student's report card, one per hidden
              container, captured individually by html2canvas when generating. */}
          <div aria-hidden className="fixed left-[-9999px] top-0" style={{ width: '780px' }}>
            {perStudent.map(p => (
              <div key={p.student.id} className="mb-8 bg-white" style={{ width: '780px' }}>
                <ReportCardDocument
                  ref={el => { nodeRefs.current[p.student.id] = el }}
                  school={school}
                  student={p.student}
                  cls={cls}
                  term={term}
                  fieldColumns={fieldColumns}
                  rows={p.rows}
                  grandTotal={p.grandTotal}
                  average={p.average}
                  position={p.position}
                  attendance={p.attendance}
                  comment={p.comment}
                  gradeRanges={gradeRanges}
                  affectiveMetrics={affectiveMetrics}
                  affectiveScores={affectiveScores}
                  psychomotorMetrics={psychomotorMetrics}
                  psychomotorScores={psychomotorScores}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
