import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, WifiOff, RefreshCw, GraduationCap, CheckCircle2, Sigma, FileDown, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNetwork } from '@/contexts/NetworkContext'
import { saveOfflineScore } from '@/lib/idb'
import { exportNodeToPdf } from '@/lib/pdfExport'
import { PreCaDocument, type PreCaColumn, type PreCaRow } from '@/components/PreCaDocument'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { clampScore } from '@/lib/utils'
import toast from 'react-hot-toast'
import type {
  Term, AssessmentCategory, Student, StudentEnrollment,
  StudentScore, TeacherAssignment, Subject, Class, ScoreFieldValue, School
} from '@/types'

type CellStatus = 'idle' | 'saving' | 'saved' | 'queued' | 'error'

export default function ScoreEntryPage() {
  const { schoolId, profile } = useAuth()
  const { isOnline, syncNow } = useNetwork()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()

  const classIdParam = searchParams.get('class')
  const subjectIdParam = searchParams.get('subject')

  const [selectedClassId, setSelectedClassId] = useState(classIdParam ?? '')
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjectIdParam ?? '')

  // Local optimistic scores + per-cell save status, so typing feels
  // instant regardless of network round-trip time
  const [localScores, setLocalScores] = useState<Record<string, number | null>>({})
  const [cellStatus, setCellStatus] = useState<Record<string, CellStatus>>({})
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // ── My assignments — drives the class/subject pickers ──
  const { data: assignments = [] } = useQuery({
    queryKey: ['my-assignments', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select('*, class:classes(*, class_level:class_levels(*), class_arm:class_arms(*)), subject:subjects(*)')
        .eq('teacher_id', profile!.id)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!profile?.id
  })

  const uniqueClasses = useMemo(() => {
    const map = new Map<string, Class>()
    assignments.forEach(a => { if (a.class) map.set(a.class_id, a.class) })
    return Array.from(map.values())
  }, [assignments])

  // Does the teacher hold a Form Teacher (CLASS-scope) assignment for
  // this class? That grants access to every subject offered at the
  // class's level, not just an individually-assigned one.
  const isFormTeacherForClass = useMemo(() =>
    assignments.some(a => a.class_id === selectedClassId && a.scope === 'CLASS' && !a.subject_id),
    [assignments, selectedClassId]
  )

  const selectedClassLevelId = uniqueClasses.find(c => c.id === selectedClassId)?.class_level_id

  const { data: levelOfferedSubjects = [] } = useQuery({
    queryKey: ['level-offered-subjects', selectedClassLevelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings')
        .select('subject:subjects(*)')
        .eq('class_level_id', selectedClassLevelId!)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!selectedClassLevelId && isFormTeacherForClass
  })

  const subjectsForClass = useMemo(() => {
    if (isFormTeacherForClass) return levelOfferedSubjects
    return assignments.filter(a => a.class_id === selectedClassId && a.subject).map(a => a.subject!) as Subject[]
  }, [assignments, selectedClassId, isFormTeacherForClass, levelOfferedSubjects])

  useEffect(() => {
    if (!selectedSubjectId && subjectsForClass.length === 1) {
      setSelectedSubjectId(subjectsForClass[0].id)
    }
  }, [subjectsForClass, selectedSubjectId])

  const { data: currentTerm } = useQuery({
    queryKey: ['current-term', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Term | null
    },
    enabled: !!schoolId
  })

  // Only needed for the Pre-CA PDF's letterhead — same branding fields
  // (logo/colors/motto) every other generated document already uses.
  const { data: school } = useQuery({
    queryKey: ['school-for-pre-ca', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  // Every INPUT field the school has configured — "Exam" is just
  // another one of these now, no special-casing needed anywhere below.
  const { data: inputFields = [] } = useQuery({
    queryKey: ['active-input-fields', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assessment_categories')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('is_active', true)
        .eq('field_type', 'input')
        .order('order_index')
      if (error) throw error
      return data as AssessmentCategory[]
    },
    enabled: !!schoolId
  })

  // The school's actual configured Total field (a computed field, not
  // necessarily a plain sum of the inputs above) — fetched purely so
  // this page can tell the teacher what the REAL report-card Total is
  // out of, since it can differ from a raw sum of input max_scores
  // (e.g. a weighted_percentage Total is always out of the sum of its
  // configured weights, commonly 100, regardless of how many input
  // fields exist or what their individual max_scores add up to).
  const { data: totalField } = useQuery({
    queryKey: ['configured-total-field', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assessment_categories')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('is_total_field', true)
        .maybeSingle()
      if (error) throw error
      return data as AssessmentCategory | null
    },
    enabled: !!schoolId
  })

  const { data: enrollments = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['enrolled-students', selectedClassId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('*, student:students(*)')
        .eq('class_id', selectedClassId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student?.is_active)
    },
    enabled: !!selectedClassId
  })

  const students = useMemo(() =>
    enrollments.map(e => e.student!).sort((a, b) => a.last_name.localeCompare(b.last_name)),
    [enrollments]
  )

  const { data: existingScores = [] } = useQuery({
    queryKey: ['existing-scores', selectedClassId, selectedSubjectId, currentTerm?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_scores')
        .select('*')
        .eq('class_id', selectedClassId)
        .eq('subject_id', selectedSubjectId)
        .eq('term_id', currentTerm!.id)
      if (error) throw error
      return data as StudentScore[]
    },
    enabled: !!selectedClassId && !!selectedSubjectId && !!currentTerm?.id
  })

  // Read-only computed-field preview (e.g. a live Total), admin-opted-in
  // per field via show_on_score_entry — see AssessmentsPage.tsx. Reuses
  // get_class_subject_term_results, the exact same RPC the school-admin
  // Broadsheet calls, so a previewed value is guaranteed to be computed
  // by the real engine (resolve_score_fields), not a separate
  // reimplementation — there is no second code path here that could
  // drift out of sync with what the broadsheet or report card shows.
  // One call for the whole class rather than one per student.
  const previewQueryKey = ['score-preview', selectedClassId, selectedSubjectId, currentTerm?.id]
  const { data: previewFields = [] } = useQuery({
    queryKey: previewQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_class_subject_term_results', {
        p_class_id: selectedClassId, p_subject_id: selectedSubjectId, p_term_id: currentTerm!.id
      })
      if (error) throw error
      return (data ?? []) as ScoreFieldValue[]
    },
    enabled: !!selectedClassId && !!selectedSubjectId && !!currentTerm?.id
  })

  // Column definitions (field_id/name/max/order_index) — every student
  // shares the same set of fields, so derive the column list once from
  // whichever rows happen to come back rather than requiring a specific
  // student. order_index is carried through so this column can be
  // slotted into the input fields at its configured position below,
  // instead of always trailing at the end of the table.
  const previewColumns = useMemo(() => {
    const seen = new Map<string, { field_id: string; field_name: string; max_value: number; order_index: number }>()
    previewFields.forEach(f => {
      if (f.field_type === 'computed' && f.show_on_score_entry && !seen.has(f.field_id)) {
        seen.set(f.field_id, { field_id: f.field_id, field_name: f.field_name, max_value: f.max_value, order_index: f.order_index })
      }
    })
    return Array.from(seen.values())
  }, [previewFields])

  // Unified, order_index-sorted column list — an editable input field
  // and a read-only computed preview field are rendered from the same
  // list/loop so a preview column lands exactly where its order_index
  // says relative to the input fields around it, rather than every
  // preview column being appended after all inputs regardless of
  // configured order. "Points Entered" (the raw running sum) stays a
  // separate, fixed trailing column — see its own header cell below —
  // since it isn't a real configured field and has no order_index of
  // its own to be sorted by.
  type ScoreColumn =
    | { kind: 'input'; order_index: number; field: AssessmentCategory }
    | { kind: 'preview'; order_index: number; col: typeof previewColumns[number] }

  const orderedColumns = useMemo<ScoreColumn[]>(() => {
    const cols: ScoreColumn[] = [
      ...inputFields.map(field => ({ kind: 'input' as const, order_index: field.order_index, field })),
      ...previewColumns.map(col => ({ kind: 'preview' as const, order_index: col.order_index, col }))
    ]
    return cols.sort((a, b) => a.order_index - b.order_index)
  }, [inputFields, previewColumns])

  const previewByStudentField = useMemo(() => {
    const map = new Map<string, number>()
    previewFields.forEach(f => {
      if (f.field_type === 'computed' && f.show_on_score_entry && f.student_id) {
        map.set(`${f.student_id}:${f.field_id}`, f.value)
      }
    })
    return map
  }, [previewFields])

  // ── Pre-CA PDF — a snapshot of exactly what's on screen right now ──
  // Deliberately reads localScores (the merged local+server state
  // that's actually rendered in the grid), not existingScores — a
  // score just typed but not yet past the 600ms debounce is still
  // "what's on screen at the time of generation" and belongs in the
  // snapshot. Columns mirror orderedColumns exactly (same order, same
  // input-vs-computed split) with "Points Entered" left out, since
  // that running total is a page-only convenience with no configured
  // field behind it, not something meant to appear on an issued sheet.
  const preCaRef = useRef<HTMLDivElement>(null)
  const [downloadingPreCa, setDownloadingPreCa] = useState(false)

  const preCaColumns = useMemo<PreCaColumn[]>(() =>
    orderedColumns.map(c => c.kind === 'input'
      ? { key: c.field.id, label: c.field.name, maxValue: c.field.max_score, isComputed: false }
      : { key: `preview:${c.col.field_id}`, label: c.col.field_name, maxValue: c.col.max_value, isComputed: true }
    ), [orderedColumns])

  const preCaRows = useMemo<PreCaRow[]>(() =>
    students.map(student => {
      const values: Record<string, number | null> = {}
      orderedColumns.forEach(c => {
        if (c.kind === 'input') {
          values[c.field.id] = localScores[`${student.id}:${c.field.id}`] ?? null
        } else {
          values[`preview:${c.col.field_id}`] = previewByStudentField.get(`${student.id}:${c.col.field_id}`) ?? null
        }
      })
      return { studentId: student.id, name: `${student.last_name}, ${student.first_name}`, admissionNumber: student.admission_number, values }
    }), [students, orderedColumns, localScores, previewByStudentField])

  const selectedClass = uniqueClasses.find(c => c.id === selectedClassId)
  const selectedSubject = subjectsForClass.find(s => s.id === selectedSubjectId)

  const downloadPreCa = async () => {
    if (!preCaRef.current) return
    setDownloadingPreCa(true)
    const filename = `${selectedClass?.class_level?.name ?? ''}${selectedClass?.class_arm ? '_' + selectedClass.class_arm.name : ''}_${selectedSubject?.name ?? ''}_PreCA`
      .replace(/\s+/g, '_') + '.pdf'
    toast.loading('Generating Pre-CA PDF…', { id: 'pre-ca-pdf' })
    try {
      await exportNodeToPdf(preCaRef.current, filename, 'landscape')
      toast.success('Pre-CA downloaded', { id: 'pre-ca-pdf' })
    } catch {
      toast.error('Could not generate the Pre-CA PDF', { id: 'pre-ca-pdf' })
    } finally {
      setDownloadingPreCa(false)
    }
  }

  const isLocked = currentTerm?.is_locked ?? false
  const inputMaxTotal = inputFields.reduce((sum, f) => sum + f.max_score, 0)

  const totalFor = (studentId: string): number => {
    let total = 0
    inputFields.forEach(f => { total += localScores[`${studentId}:${f.id}`] ?? 0 })
    return total
  }

  // classId/subjectId/termId are explicit parameters rather than read
  // from selectedClassId/selectedSubjectId/currentTerm — a flush (see
  // above) must be able to persist a pending edit using the values
  // that were current when it was QUEUED, not whatever is currently
  // selected by the time the flush actually runs.
  const persistScore = useCallback(async (studentId: string, fieldId: string, score: number | null, classId: string, subjectId: string, termId: string) => {
    const key = `${studentId}:${fieldId}`
    setCellStatus(prev => ({ ...prev, [key]: 'saving' }))

    if (!isOnline) {
      await saveOfflineScore({
        id: `${studentId}-${fieldId}-${termId}`,
        school_id: schoolId!,
        student_id: studentId,
        class_id: classId,
        subject_id: subjectId,
        term_id: termId,
        assessment_category_id: fieldId,
        score,
        entered_by: profile!.id,
        timestamp: Date.now(),
        sync_status: 'pending'
      })
      setCellStatus(prev => ({ ...prev, [key]: 'queued' }))
      return
    }

    const { error } = await supabase.from('student_scores').upsert({
      school_id: schoolId,
      student_id: studentId,
      class_id: classId,
      subject_id: subjectId,
      term_id: termId,
      assessment_category_id: fieldId,
      score,
      entered_by: profile!.id,
      is_synced: true
    }, { onConflict: 'student_id,subject_id,term_id,assessment_category_id' })

    setCellStatus(prev => ({ ...prev, [key]: error ? 'error' : 'saved' }))
    // Refresh the read-only computed-field preview (if any are
    // configured) so it reflects this save — cheap no-op when there's
    // nothing currently subscribed to previewQueryKey. Only worth
    // doing when the flushed save was for the class/subject still
    // being viewed — a flush for a class/subject just switched AWAY
    // from has no matching preview subscription left to invalidate.
    if (!error && classId === selectedClassId && subjectId === selectedSubjectId) {
      qc.invalidateQueries({ queryKey: previewQueryKey })
    }
  }, [isOnline, schoolId, profile, qc, previewQueryKey, selectedClassId, selectedSubjectId])

  // One in-flight-or-pending entry per cell, keyed the same as
  // localScores/debounceTimers, holding everything persistScore needs
  // so a flush doesn't have to guess it from current state.
  const pendingSaves = useRef<Record<string, { studentId: string; fieldId: string; score: number | null; classId: string; subjectId: string; termId: string }>>({})

  // Immediately persists one pending cell, bypassing whatever's left
  // of its debounce. Shared by onBlur (below), flushPendingSaves, and
  // the visibility/unload handlers — one place that actually talks to
  // persistScore so there's exactly one way a pending save gets
  // dispatched, however it was triggered.
  const flushKey = useCallback((key: string) => {
    const pending = pendingSaves.current[key]
    if (!pending) return
    clearTimeout(debounceTimers.current[key])
    delete debounceTimers.current[key]
    delete pendingSaves.current[key]
    persistScore(pending.studentId, pending.fieldId, pending.score, pending.classId, pending.subjectId, pending.termId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistScore])

  const flushPendingSaves = useCallback(() => {
    Object.keys(pendingSaves.current).forEach(key => flushKey(key))
  }, [flushKey])

  // Belt-and-suspenders beyond the 600ms debounce, aimed specifically
  // at "typed a score, then immediately left" — the single biggest
  // source of a save silently never happening, because switching
  // browser tabs does NOT unmount this component (the debounce timer
  // itself is still perfectly capable of firing later in a background
  // tab), but it's still a real gap: three separate moments where
  // "left" can mean "before the debounce ran":
  //  - onBlur (below, per-input): tabbing/clicking to the next cell,
  //    or clicking a nav link, blurs the field first — flush right
  //    then rather than trusting the remaining debounce time.
  //  - visibilitychange: switching to another browser tab or app
  //    doesn't blur a focused input reliably in every browser, so this
  //    catches that case at the document level regardless.
  //  - beforeunload: an actual tab close/refresh/external navigation
  //    can abort an in-flight request outright — warning the person
  //    lets them cancel and wait, rather than racing the teardown.
  useEffect(() => {
    const flushAllNow = () => flushPendingSaves()

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushAllNow()
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendingSaves.current).length === 0) return
      flushAllNow()
      e.preventDefault()
      e.returnValue = ''
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [flushPendingSaves])

  const handleChange = (studentId: string, fieldId: string, rawValue: string, max: number) => {
    const key = `${studentId}:${fieldId}`
    const parsed = rawValue === '' ? null : clampScore(Number(rawValue), max)
    setLocalScores(prev => ({ ...prev, [key]: parsed }))

    if (!currentTerm) return // shouldn't happen — inputs are disabled without a current term
    pendingSaves.current[key] = { studentId, fieldId, score: parsed, classId: selectedClassId, subjectId: selectedSubjectId, termId: currentTerm.id }

    clearTimeout(debounceTimers.current[key])
    debounceTimers.current[key] = setTimeout(() => flushKey(key), 600)
  }

  const noSelection = !selectedClassId || !selectedSubjectId

  useEffect(() => {
    const seeded: Record<string, number | null> = {}
    existingScores.forEach(s => { seeded[`${s.student_id}:${s.assessment_category_id}`] = s.score })
    setLocalScores(prev => ({ ...seeded, ...prev }))
  }, [existingScores])

  // Fields are school-wide, not per-subject — the same field id (e.g.
  // "CA Test") is reused across every subject. localScores is keyed
  // only by studentId:fieldId, with no subjectId in the key, so
  // switching subjects without clearing local state left the seeding
  // effect above merging fresh data UNDER stale values from whichever
  // subject was just being viewed (`{...seeded, ...prev}` lets prev
  // win) — the grid looked unchanged until a full reload. Clearing
  // local state on every class/subject change forces the seeding
  // effect to repopulate purely from the newly-fetched data for the
  // subject actually selected.
  //
  // flushPendingSaves() runs FIRST, before that clear — a save is
  // debounced 600ms after the last keystroke, so switching class/
  // subject (or navigating away) inside that window used to silently
  // drop whatever hadn't been persisted yet: the timer was still
  // scheduled, but the very next line here wiped the local state it
  // would have been reading, and if this whole page had since
  // unmounted, nothing was left to run it at all. Each pending entry
  // carries its own class/subject/term id from the moment it was
  // queued (captured in handleChange, not read from current state),
  // so flushing is correct however far selection has since moved on.
  useEffect(() => {
    flushPendingSaves()
    setLocalScores({})
    setCellStatus({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedSubjectId])

  // Same flush on navigating away from the page entirely (a plain
  // dependency array, not empty, so this always closes over the
  // current flushPendingSaves rather than a stale one from first
  // mount — cheap to re-run since flushing an already-empty
  // pendingSaves is a no-op).
  useEffect(() => {
    return () => { flushPendingSaves() }
  }, [flushPendingSaves])

  return (
    <div>
      <PageHeader
        title="Score Entry"
        description={currentTerm ? `${currentTerm.name} — Continuous Assessment` : 'No active term'}
      />

      {totalField && (
        <p className="text-xs text-muted-foreground mb-4 -mt-2">
          "Points Entered" below is a raw sum of what you've typed on this page — it isn't the report card Total.
          The report card Total ({totalField.name}) is computed separately and is out of {totalField.max_score}.
        </p>
      )}

      {!isOnline && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center gap-2 text-sm text-orange-800">
          <WifiOff className="h-4 w-4 shrink-0" />
          You're offline. Scores are saved on this device and will sync automatically when you reconnect.
        </div>
      )}

      {isLocked && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-center gap-2 text-sm text-red-800">
          <Lock className="h-4 w-4 shrink-0" />
          {currentTerm?.name} is locked. Scores cannot be edited until your school admin unlocks it.
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Select value={selectedClassId} onValueChange={v => { setSelectedClassId(v); setSelectedSubjectId('') }}>
              <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
              <SelectContent>
                {uniqueClasses.map(cls => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.class_level?.name}{cls.class_arm ? ' ' + cls.class_arm.name : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId} disabled={!selectedClassId}>
              <SelectTrigger><SelectValue placeholder="Select a subject" /></SelectTrigger>
              <SelectContent>
                {subjectsForClass.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!isOnline && (
            <Button variant="outline" onClick={() => syncNow()}>
              <RefreshCw className="mr-2 h-4 w-4" />Retry Sync
            </Button>
          )}
          {!noSelection && students.length > 0 && (
            <Button variant="outline" onClick={downloadPreCa} disabled={downloadingPreCa}>
              {downloadingPreCa ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              Download Pre-CA
            </Button>
          )}
        </CardContent>
      </Card>

      {noSelection ? (
        <EmptyState
          icon={<GraduationCap className="h-12 w-12" />}
          title="Select a class and subject"
          description="Choose which class and subject you'd like to enter scores for."
        />
      ) : !currentTerm ? (
        <EmptyState title="No active term" description="Ask your school admin to mark a term as current." />
      ) : inputFields.length === 0 ? (
        <EmptyState title="No score fields configured" description="Ask your school admin to set up assessment fields for this school." />
      ) : loadingStudents ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : students.length === 0 ? (
        <EmptyState title="No students enrolled" description="This class has no active enrolled students yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* containerClassName bounds the scroll frame so the sticky
                header row actually freezes in place instead of just
                scrolling away with the rest of the page — see the z-index
                note on the header row below for how this and the sticky
                Student column are kept from fighting each other. */}
            <Table containerClassName="max-h-[70vh]">
              <TableHeader>
                <TableRow>
                  {/* Top-left corner: sticky on BOTH axes, so it needs the
                      highest z-index of anything in this table — it has to
                      stay above ordinary sticky-top headers scrolling
                      horizontally past it AND above the sticky-left Student
                      column scrolling vertically underneath it. */}
                  <TableHead className="sticky left-0 top-0 z-30 bg-background">Student</TableHead>
                  {orderedColumns.map(c => c.kind === 'input' ? (
                    <TableHead key={`in-${c.field.id}`} className="sticky top-0 z-20 bg-background text-center whitespace-nowrap">
                      {c.field.name}<br /><span className="text-xs text-muted-foreground font-normal">/{c.field.max_score}</span>
                    </TableHead>
                  ) : (
                    <TableHead key={`pv-${c.col.field_id}`} className="sticky top-0 z-20 bg-muted/40 text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><Sigma className="h-3 w-3" />{c.col.field_name}</span>
                      <br /><span className="text-xs text-muted-foreground font-normal">/{c.col.max_value}</span>
                    </TableHead>
                  ))}
                  <TableHead className="sticky top-0 z-20 bg-background text-center whitespace-nowrap font-semibold">Points Entered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map(student => (
                  <TableRow key={student.id}>
                    {/* Sticky-left only (not top) — z-10, one tier below the
                        sticky-top headers above, so the header row always
                        wins when both would otherwise overlap at the
                        top-left corner during a diagonal scroll. */}
                    <TableCell className="sticky left-0 z-10 bg-background font-medium text-sm whitespace-nowrap">
                      {student.last_name}, {student.first_name}
                    </TableCell>
                    {orderedColumns.map(c => {
                      if (c.kind === 'input') {
                        const field = c.field
                        const key = `${student.id}:${field.id}`
                        const status = cellStatus[key]
                        return (
                          <TableCell key={`in-${field.id}`} className="p-1">
                            <div className="relative">
                              <input
                                type="number"
                                min={0}
                                max={field.max_score}
                                disabled={isLocked}
                                value={localScores[key] ?? ''}
                                onChange={e => handleChange(student.id, field.id, e.target.value, field.max_score)}
                                onBlur={() => flushKey(key)}
                                className="w-16 h-9 text-center rounded border border-input bg-background text-foreground text-sm disabled:bg-muted disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                              <CellIndicator status={status} />
                            </div>
                          </TableCell>
                        )
                      }
                      const col = c.col
                      const val = previewByStudentField.get(`${student.id}:${col.field_id}`)
                      return (
                        <TableCell key={`pv-${col.field_id}`} className="text-center text-sm bg-muted/20 text-muted-foreground" title="Computed automatically — read-only">
                          {val ?? '—'}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-center font-semibold text-sm">
                      {totalFor(student.id)}/{inputMaxTotal}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Off-screen, always kept in sync with the live grid above (same
          preCaColumns/preCaRows derivation) so a click just captures
          whatever's already rendered here — no separate fetch, no risk
          of it drifting from what's actually on screen. */}
      {!noSelection && students.length > 0 && (
        <div aria-hidden className="fixed left-[-9999px] top-0">
          <PreCaDocument
            ref={preCaRef}
            school={school} cls={selectedClass} subject={selectedSubject} term={currentTerm}
            teacherName={profile ? `${profile.first_name} ${profile.last_name}` : ''}
            generatedAt={new Date()}
            columns={preCaColumns} rows={preCaRows}
          />
        </div>
      )}
    </div>
  )
}

function CellIndicator({ status }: { status?: CellStatus }) {
  if (!status || status === 'idle') return null
  if (status === 'saving') return <Spinner size="sm" className="absolute -right-1 -top-1 h-3 w-3" />
  if (status === 'saved') return <CheckCircle2 className="absolute -right-1 -top-1 h-3.5 w-3.5 text-green-600 bg-background rounded-full" />
  if (status === 'queued') return <Badge variant="warning" className="absolute -right-2 -top-2 text-[9px] px-1 py-0 h-4">Queued</Badge>
  if (status === 'error') return <Badge variant="destructive" className="absolute -right-2 -top-2 text-[9px] px-1 py-0 h-4">Error</Badge>
  return null
}
