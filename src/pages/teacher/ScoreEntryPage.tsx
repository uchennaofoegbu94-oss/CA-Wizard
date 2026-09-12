import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, WifiOff, RefreshCw, GraduationCap, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNetwork } from '@/contexts/NetworkContext'
import { saveOfflineScore } from '@/lib/idb'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { clampScore } from '@/lib/utils'
import type {
  Term, AssessmentCategory, Student, StudentEnrollment,
  StudentScore, TeacherAssignment, Subject, Class
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
  useEffect(() => {
    setLocalScores({})
    setCellStatus({})
  }, [selectedClassId, selectedSubjectId])

  const isLocked = currentTerm?.is_locked ?? false
  const inputMaxTotal = inputFields.reduce((sum, f) => sum + f.max_score, 0)

  const totalFor = (studentId: string): number => {
    let total = 0
    inputFields.forEach(f => { total += localScores[`${studentId}:${f.id}`] ?? 0 })
    return total
  }

  const persistScore = useCallback(async (studentId: string, fieldId: string, score: number | null) => {
    const key = `${studentId}:${fieldId}`
    setCellStatus(prev => ({ ...prev, [key]: 'saving' }))

    if (!isOnline) {
      await saveOfflineScore({
        id: `${studentId}-${fieldId}-${currentTerm!.id}`,
        school_id: schoolId!,
        student_id: studentId,
        class_id: selectedClassId,
        subject_id: selectedSubjectId,
        term_id: currentTerm!.id,
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
      class_id: selectedClassId,
      subject_id: selectedSubjectId,
      term_id: currentTerm!.id,
      assessment_category_id: fieldId,
      score,
      entered_by: profile!.id,
      is_synced: true
    }, { onConflict: 'student_id,subject_id,term_id,assessment_category_id' })

    setCellStatus(prev => ({ ...prev, [key]: error ? 'error' : 'saved' }))
  }, [isOnline, schoolId, selectedClassId, selectedSubjectId, currentTerm, profile])

  const handleChange = (studentId: string, fieldId: string, rawValue: string, max: number) => {
    const key = `${studentId}:${fieldId}`
    const parsed = rawValue === '' ? null : clampScore(Number(rawValue), max)
    setLocalScores(prev => ({ ...prev, [key]: parsed }))

    clearTimeout(debounceTimers.current[key])
    debounceTimers.current[key] = setTimeout(() => {
      persistScore(studentId, fieldId, parsed)
    }, 600)
  }

  const noSelection = !selectedClassId || !selectedSubjectId

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
                  {inputFields.map(field => (
                    <TableHead key={field.id} className="sticky top-0 z-20 bg-background text-center whitespace-nowrap">
                      {field.name}<br /><span className="text-xs text-muted-foreground font-normal">/{field.max_score}</span>
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
                    {inputFields.map(field => {
                      const key = `${student.id}:${field.id}`
                      const status = cellStatus[key]
                      return (
                        <TableCell key={field.id} className="p-1">
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={field.max_score}
                              disabled={isLocked}
                              value={localScores[key] ?? ''}
                              onChange={e => handleChange(student.id, field.id, e.target.value, field.max_score)}
                              className="w-16 h-9 text-center rounded border border-input bg-background text-foreground text-sm disabled:bg-muted disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <CellIndicator status={status} />
                          </div>
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
