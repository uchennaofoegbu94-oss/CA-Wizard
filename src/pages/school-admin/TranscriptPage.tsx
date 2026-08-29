import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileStack, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { exportNodeToPdf } from '@/lib/pdfExport'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { TranscriptDocument, type SnapshotRow } from '@/components/TranscriptDocument'
import toast from 'react-hot-toast'
import type { Student, School } from '@/types'

const TERM_ORDER: Record<string, number> = { 'First Term': 0, 'Second Term': 1, 'Third Term': 2 }

// Deliberately built from report_snapshots (the frozen historical
// record), not recomputed live — a transcript should reflect what
// was actually issued at the time, not today's live data for terms
// that may have since had categories or grading systems changed.
export default function TranscriptPage() {
  const { schoolId } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)

  const [search, setSearch] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')

  const { data: school } = useQuery({
    queryKey: ['transcript-school', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  // Search students directly, school-wide — deliberately NOT scoped to
  // any session or class. A student who graduated, transferred out, or
  // simply isn't in whichever session you'd otherwise browse first must
  // still be findable; a transcript's whole purpose is to span every
  // session they've ever been enrolled in, so the picker can't depend
  // on picking the "right" one first.
  const { data: searchResults = [] } = useQuery({
    queryKey: ['transcript-search', schoolId, search],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('school_id', schoolId!)
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,admission_number.ilike.%${search}%`)
        .order('last_name')
        .limit(20)
      if (error) throw error
      return data as Student[]
    },
    enabled: !!schoolId && search.length > 0
  })

  const { data: selectedStudent } = useQuery({
    queryKey: ['transcript-selected-student', selectedStudentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*').eq('id', selectedStudentId).single()
      if (error) throw error
      return data as Student
    },
    enabled: !!selectedStudentId
  })

  // ── Every saved snapshot for this student, across every session —
  //    filtered ONLY by student_id, with no session/term restriction
  //    whatsoever. ──
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['transcript-snapshots', selectedStudentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_snapshots')
        .select('*, term_info:terms(name, session:sessions(id, name, start_year))')
        .eq('student_id', selectedStudentId)
      if (error) throw error
      return data as unknown as SnapshotRow[]
    },
    enabled: !!selectedStudentId
  })

  const groupedBySessions = useMemo(() => {
    const map = new Map<string, { name: string; startYear: number; rows: SnapshotRow[] }>()
    snapshots.forEach(snap => {
      const sess = snap.term_info?.session
      if (!sess) return
      if (!map.has(sess.id)) map.set(sess.id, { name: sess.name, startYear: sess.start_year, rows: [] })
      map.get(sess.id)!.rows.push(snap)
    })
    map.forEach(group => group.rows.sort((a, b) => (TERM_ORDER[a.term_info.name] ?? 0) - (TERM_ORDER[b.term_info.name] ?? 0)))
    return Array.from(map.values()).sort((a, b) => a.startYear - b.startYear)
  }, [snapshots])

  const overallAverage = useMemo(() => {
    if (snapshots.length === 0) return 0
    const total = snapshots.reduce((sum, s) => sum + (s.snapshot_data.average ?? 0), 0)
    return Math.round((total / snapshots.length) * 100) / 100
  }, [snapshots])

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

  const compiledAffective = useMemo(() => compileDomain('affective'), [snapshots])
  const compiledPsychomotor = useMemo(() => compileDomain('psychomotor'), [snapshots])

  const studentPhoto = selectedStudent?.photo_url ?? snapshots[0]?.snapshot_data.student?.photo_url ?? null

  const downloadPdf = async () => {
    if (!printRef.current || !selectedStudent) return
    // groupedBySessions is already sorted ascending by startYear, so the
    // first/last entries give the enrolled/graduated year span directly.
    // +1 on the graduated year: a session's start_year of 2025 represents
    // the "2025/2026" academic year, which concludes in 2026.
    const enrolledYear = groupedBySessions[0]?.startYear
    const graduatedYear = groupedBySessions.length > 0
      ? groupedBySessions[groupedBySessions.length - 1].startYear + 1
      : undefined
    const yearSpan = enrolledYear && graduatedYear ? `${enrolledYear}-${graduatedYear}` : 'Transcript'
    const filename = `${selectedStudent.first_name}_${selectedStudent.last_name}_Transcript_${yearSpan}.pdf`.replace(/\s+/g, '_')
    toast.loading('Generating PDF…', { id: 'transcript-pdf' })
    try {
      await exportNodeToPdf(printRef.current, filename)
      toast.success('PDF downloaded', { id: 'transcript-pdf' })
    } catch {
      toast.error('Could not generate PDF', { id: 'transcript-pdf' })
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Transcript"
          description="Compiled academic record across every saved term"
          action={selectedStudent && (
            <Button variant="outline" onClick={downloadPdf}>
              <Download className="mr-2 h-4 w-4" />Download PDF
            </Button>
          )}
        />

        <Card className="mb-4">
          <CardContent className="pt-4 pb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or admission number…"
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedStudentId('') }}
                className="pl-9"
              />
            </div>
            {search && !selectedStudentId && searchResults.length > 0 && (
              <div className="mt-2 border rounded-md divide-y max-h-56 overflow-y-auto max-w-md">
                {searchResults.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedStudentId(s.id); setSearch(`${s.first_name} ${s.last_name}`) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
                  >
                    <span>{s.last_name}, {s.first_name} <span className="text-muted-foreground font-mono text-xs">({s.admission_number})</span></span>
                    {s.status !== 'active' && <span className="text-xs text-muted-foreground capitalize">{s.status.replace('_', ' ')}</span>}
                  </button>
                ))}
              </div>
            )}
            {search && !selectedStudentId && searchResults.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">No students match that search.</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Searches every student ever enrolled at this school — the compiled transcript includes every session they've been part of, regardless of current status.
            </p>
          </CardContent>
        </Card>
      </div>

      {!selectedStudentId ? (
        <EmptyState icon={<FileStack className="h-12 w-12" />} title="Search for a student" description="A transcript compiles every saved report card snapshot for that student, across every session they've ever been enrolled in." />
      ) : isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : snapshots.length === 0 ? (
        <EmptyState title="No saved report cards yet" description="Save at least one report card snapshot for this student (Reports → Report Card → Save Snapshot) before a transcript can be compiled." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <TranscriptDocument
              ref={printRef}
              school={school}
              student={selectedStudent}
              groupedBySessions={groupedBySessions}
              overallAverage={overallAverage}
              snapshotCount={snapshots.length}
              compiledAffective={compiledAffective}
              compiledPsychomotor={compiledPsychomotor}
              studentPhoto={studentPhoto}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
