import { useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, FileArchive, Loader2 } from 'lucide-react'
import JSZip from 'jszip'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { canUseBulkGeneration } from '@/lib/tierLimits'
import { combineNodesToPdf, nodeToPdfBlob } from '@/lib/pdfExport'
import { Button } from '@/components/ui/button'
import { PageHeader, Spinner, EmptyState } from '@/components/ui/table'
import { TranscriptDocument, type SnapshotRow } from '@/components/TranscriptDocument'
import toast from 'react-hot-toast'
import type { Student, Class, School, StudentEnrollment } from '@/types'

const TERM_ORDER: Record<string, number> = { 'First Term': 0, 'Second Term': 1, 'Third Term': 2 }

// Bulk transcript generation — deliberately scoped differently from bulk
// report cards. A report card is a single term/class snapshot, so "bulk"
// naturally means "everyone in this class, this term." A transcript spans
// a student's ENTIRE enrollment history regardless of term, so "bulk"
// here means "everyone currently in this class" (e.g. a graduating
// cohort), with each student's full multi-session history compiled
// independently — the class/term only pick WHO, not WHAT data goes in.
export default function BulkTranscriptPage() {
  const { schoolId, subscriptionTier, role } = useAuth()
  const [params] = useSearchParams()
  const classId = params.get('class') ?? ''
  const sessionId = params.get('session') ?? ''
  // No term param here — a transcript spans a student's entire history
  // regardless of term (see the comment above), so there's nothing to
  // carry back for term; ReportsPage falls back to its own current-term
  // default when it's absent. A section admin (still role 'teacher')
  // has no access to that route at all — send them back to their own
  // Documents tab instead.
  const backToReportsUrl = role === 'teacher'
    ? '/teacher/section-admin'
    : `/school/reports?session=${sessionId}&class=${classId}`
  const ready = !!classId

  const [generating, setGenerating] = useState<'combined' | 'zip' | null>(null)
  const [progress, setProgress] = useState(0)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { data: school } = useQuery({
    queryKey: ['bulk-transcript-school', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  const { data: cls } = useQuery({
    queryKey: ['bulk-transcript-class', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, class_level:class_levels(*), class_arm:class_arms(*)').eq('id', classId).single()
      if (error) throw error
      return data as Class
    },
    enabled: ready
  })

  const { data: enrollments = [] } = useQuery({
    queryKey: ['bulk-transcript-enrollments', classId],
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

  // Every student's ENTIRE snapshot history, batched into one query rather
  // than one query per student — a class of 40 students each with 6+ terms
  // of history would otherwise mean 40 separate round trips.
  const { data: allSnapshots = [], isLoading: loadingSnapshots } = useQuery({
    queryKey: ['bulk-transcript-snapshots', studentIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_snapshots')
        .select('*, term_info:terms(name, session:sessions(id, name, start_year))')
        .in('student_id', studentIds)
      if (error) throw error
      return data as unknown as (SnapshotRow & { student_id: string })[]
    },
    enabled: ready && studentIds.length > 0
  })

  interface PerStudentData {
    student: Student
    groupedBySessions: { name: string; startYear: number; rows: SnapshotRow[] }[]
    overallAverage: number
    snapshotCount: number
    compiledAffective: { name: string; average: number }[]
    compiledPsychomotor: { name: string; average: number }[]
    studentPhoto: string | null
  }

  const perStudent: PerStudentData[] = useMemo(() => {
    return students.map(student => {
      const snapshots = allSnapshots.filter(s => s.student_id === student.id)

      const map = new Map<string, { name: string; startYear: number; rows: SnapshotRow[] }>()
      snapshots.forEach(snap => {
        const sess = snap.term_info?.session
        if (!sess) return
        if (!map.has(sess.id)) map.set(sess.id, { name: sess.name, startYear: sess.start_year, rows: [] })
        map.get(sess.id)!.rows.push(snap)
      })
      map.forEach(group => group.rows.sort((a, b) => (TERM_ORDER[a.term_info.name] ?? 0) - (TERM_ORDER[b.term_info.name] ?? 0)))
      const groupedBySessions = Array.from(map.values()).sort((a, b) => a.startYear - b.startYear)

      const overallAverage = snapshots.length > 0
        ? Math.round((snapshots.reduce((sum, s) => sum + (s.snapshot_data.average ?? 0), 0) / snapshots.length) * 100) / 100
        : 0

      const compileDomain = (key: 'affective' | 'psychomotor') => {
        const byName = new Map<string, number[]>()
        snapshots.forEach(snap => {
          (snap.snapshot_data[key] ?? []).forEach(d => {
            if (d.rating) {
              const list = byName.get(d.name) ?? []
              list.push(Number(d.rating))
              byName.set(d.name, list)
            }
          })
        })
        return Array.from(byName.entries()).map(([name, ratings]) => ({
          name,
          average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        }))
      }

      return {
        student,
        groupedBySessions,
        overallAverage,
        snapshotCount: snapshots.length,
        compiledAffective: compileDomain('affective'),
        compiledPsychomotor: compileDomain('psychomotor'),
        studentPhoto: student.photo_url ?? snapshots[0]?.snapshot_data.student?.photo_url ?? null
      }
    }).filter(p => p.snapshotCount > 0) // skip students with no saved snapshots at all — nothing to compile
  }, [students, allSnapshots])

  const isLoading = !cls || (studentIds.length > 0 && loadingSnapshots)
  const classLabel = cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''
  const baseFilename = `${classLabel}_Transcripts_Batch`.replace(/\s+/g, '_')

  const yearSpan = (p: PerStudentData) => {
    const enrolledYear = p.groupedBySessions[0]?.startYear
    const graduatedYear = p.groupedBySessions.length > 0
      ? p.groupedBySessions[p.groupedBySessions.length - 1].startYear + 1
      : undefined
    return enrolledYear && graduatedYear ? `${enrolledYear}-${graduatedYear}` : 'Transcript'
  }

  const generateCombined = async () => {
    if (perStudent.length === 0) return
    setGenerating('combined')
    toast.loading('Generating combined PDF…', { id: 'bulk-transcript-combined' })
    try {
      const nodes = perStudent.map(p => nodeRefs.current[p.student.id]).filter((n): n is HTMLDivElement => !!n)
      const pdf = await combineNodesToPdf(nodes)
      pdf.save(`${baseFilename}.pdf`)
      toast.success(`Combined PDF ready — ${perStudent.length} transcripts`, { id: 'bulk-transcript-combined' })
    } catch {
      toast.error('Could not generate the combined PDF', { id: 'bulk-transcript-combined' })
    } finally {
      setGenerating(null)
    }
  }

  const generateZip = async () => {
    if (perStudent.length === 0) return
    setGenerating('zip')
    setProgress(0)
    toast.loading(`Generating 0 of ${perStudent.length}…`, { id: 'bulk-transcript-zip' })
    try {
      const zip = new JSZip()
      for (let i = 0; i < perStudent.length; i++) {
        const p = perStudent[i]
        const node = nodeRefs.current[p.student.id]
        if (!node) continue
        const blob = await nodeToPdfBlob(node)
        const filename = `${p.student.first_name}_${p.student.last_name}_Transcript_${yearSpan(p)}.pdf`.replace(/\s+/g, '_')
        zip.file(filename, blob)
        setProgress(i + 1)
        toast.loading(`Generating ${i + 1} of ${perStudent.length}…`, { id: 'bulk-transcript-zip' })
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseFilename}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Zip ready — ${perStudent.length} transcripts`, { id: 'bulk-transcript-zip' })
    } catch {
      toast.error('Could not generate the zip', { id: 'bulk-transcript-zip' })
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
        <EmptyState title="Missing information" description="Open this page from Reports by choosing a class, then clicking Bulk Transcripts." />
      </div>
    )
  }

  if (!canUseBulkGeneration(subscriptionTier)) {
    return (
      <div>
        <Link to={backToReportsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Reports
        </Link>
        <EmptyState title="Upgrade required" description="Batch transcript generation requires the Professional plan or higher." />
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
          title="Bulk Transcripts"
          description={cls ? `${classLabel} — every enrolled student's full academic history` : 'Loading…'}
          action={
            <div className="flex gap-2">
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
        <EmptyState
          title="No saved transcripts to compile"
          description="None of this class's students have a saved report card snapshot yet. Save at least one snapshot per student (Reports → Report Card → Save Snapshot) before bulk-generating transcripts."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {perStudent.length} of {students.length} student{students.length === 1 ? '' : 's'} have saved history to compile
            {perStudent.length < students.length && ' — the rest have no saved snapshots yet and are skipped'}.
            Each transcript below is rendered off-screen purely for PDF capture.
          </p>

          <div aria-hidden className="fixed left-[-9999px] top-0" style={{ width: '780px' }}>
            {perStudent.map(p => (
              <div key={p.student.id} className="mb-8 bg-white" style={{ width: '780px' }}>
                <TranscriptDocument
                  ref={el => { nodeRefs.current[p.student.id] = el }}
                  school={school}
                  student={p.student}
                  groupedBySessions={p.groupedBySessions}
                  overallAverage={p.overallAverage}
                  snapshotCount={p.snapshotCount}
                  compiledAffective={p.compiledAffective}
                  compiledPsychomotor={p.compiledPsychomotor}
                  studentPhoto={p.studentPhoto}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
