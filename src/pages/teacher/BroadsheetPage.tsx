import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Trophy, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { ordinalSuffix, round2, sum2 } from '@/lib/utils'
import { useClassSubjectRoster, indexRoster, rankEntries } from '@/lib/subjectRoster'
import { groupBySection } from '@/lib/sections'
import type { Term, Subject, Student, StudentEnrollment, ScoreFieldValue, TeacherAssignment, Class, SchoolSection } from '@/types'

interface StudentTotals {
  student: Student
  // null = the student doesn't take this (optional) subject
  perSubject: Record<string, number | null>
  grandTotal: number
  average: number
}

export default function BroadsheetPage() {
  const { schoolId, profile } = useAuth()
  const [selectedClassId, setSelectedClassId] = useState('')

  const { data: assignments = [] } = useQuery({
    queryKey: ['my-assignments-broadsheet', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select('*, class:classes(*, class_level:class_levels(*, section:school_sections(*)), class_arm:class_arms(*)), subject:subjects(*)')
        .eq('teacher_id', profile!.id)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!profile?.id
  })

  const { data: sections = [] } = useQuery({
    queryKey: ['broadsheet-sections', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('school_sections').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as SchoolSection[]
    },
    enabled: !!schoolId
  })

  const uniqueClasses = useMemo(() => {
    const map = new Map<string, Class>()
    assignments.forEach(a => { if (a.class) map.set(a.class_id, a.class) })
    return Array.from(map.values())
  }, [assignments])

  // Form Teacher (CLASS-scope) assignment for the selected class means
  // full visibility — every subject, grand total, and class ranking.
  // A Subject Teacher (SUBJECT-scope only) can only see their own
  // subject's column: ranking and grand total require knowing every
  // student's performance across ALL subjects, which they don't have
  // visibility into, so showing a rank to them would be misleading.
  const isFormTeacherForClass = useMemo(() =>
    assignments.some(a => a.class_id === selectedClassId && a.scope === 'CLASS' && !a.subject_id),
    [assignments, selectedClassId]
  )

  const mySubjectIdsForClass = useMemo(() =>
    assignments.filter(a => a.class_id === selectedClassId && a.subject_id).map(a => a.subject_id!),
    [assignments, selectedClassId]
  )

  const { data: currentTerm } = useQuery({
    queryKey: ['current-term', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Term | null
    },
    enabled: !!schoolId
  })

  const selectedClass = uniqueClasses.find(c => c.id === selectedClassId)

  const { data: allLevelSubjects = [] } = useQuery({
    queryKey: ['broadsheet-level-subjects', selectedClass?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings')
        .select('subject:subjects(*)')
        .eq('class_level_id', selectedClass!.class_level_id)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!selectedClass?.class_level_id
  })

  // Visible subject columns: everything if Form Teacher, only their
  // own assigned subject(s) otherwise
  const visibleSubjects = useMemo(() => {
    if (isFormTeacherForClass) return allLevelSubjects
    return allLevelSubjects.filter(s => mySubjectIdsForClass.includes(s.id))
  }, [allLevelSubjects, isFormTeacherForClass, mySubjectIdsForClass])

  const { data: enrollments = [] } = useQuery({
    queryKey: ['broadsheet-enrollments', selectedClassId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*, student:students(*)').eq('class_id', selectedClassId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student?.is_active)
    },
    enabled: !!selectedClassId
  })

  // One get_class_subject_term_results RPC call per subject at this
  // class's level — grand total / average need every subject
  // regardless of what's visible to this teacher, so this always
  // covers allLevelSubjects, not just visibleSubjects.
  const { data: resultsBySubject = {}, isLoading: loadingResults } = useQuery({
    queryKey: ['broadsheet-results', selectedClassId, currentTerm?.id, allLevelSubjects.map(s => s.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(allLevelSubjects.map(async subj => {
        const { data, error } = await supabase.rpc('get_class_subject_term_results', {
          p_class_id: selectedClassId, p_subject_id: subj.id, p_term_id: currentTerm!.id
        })
        if (error) throw error
        return [subj.id, (data ?? []) as ScoreFieldValue[]] as const
      }))
      return Object.fromEntries(entries) as Record<string, ScoreFieldValue[]>
    },
    enabled: !!selectedClassId && !!currentTerm?.id && allLevelSubjects.length > 0
  })

  // Who takes which subject (optional subjects) — the database rule shared with Score Entry and report cards
  const { data: rosterRows, isError: rosterFailed } = useClassSubjectRoster(selectedClassId || null)
  const roster = useMemo(() => indexRoster(rosterRows), [rosterRows])

  const rows: StudentTotals[] = useMemo(() => {
    const students = enrollments.map(e => e.student!).filter(Boolean)
    const computed = students.map(student => {
      const perSubject: Record<string, number | null> = {}
      const takes = roster.subjectsByStudent.get(student.id)
      const totals: number[] = []
      // Grand total / average are only meaningful across ALL of the student's subjects,
      // so they're computed from allLevelSubjects regardless of what's visible — but only
      // ever rendered on screen when isFormTeacherForClass.
      allLevelSubjects.forEach(subj => {
        const takesIt = rosterFailed || !rosterRows ? true : !!takes?.has(subj.id)
        if (!takesIt) { perSubject[subj.id] = null; return }
        const subjResults = resultsBySubject[subj.id] ?? []
        const totalRow = subjResults.find(r => r.student_id === student.id && r.is_total_field)
        const total = round2(totalRow?.value ?? 0)
        perSubject[subj.id] = total
        totals.push(total)
      })
      // 2dp rule: sum2/round2 remove float noise like 120.52000000000001
      const grandTotal = sum2(totals)
      // Average over the subjects THIS student takes, not every subject the level offers
      const average = totals.length > 0 ? round2(grandTotal / totals.length) : 0
      return { student, perSubject, grandTotal, average, count: totals.length }
    })
    // Same total-points order as before unless electives make subject counts differ; then by average
    const order = new Map(rankEntries(computed.map(c => ({ studentId: c.student.id, total: c.grandTotal, average: c.average, count: c.count }))).map((e, i) => [e.studentId, i]))
    const sorted = computed.sort((a, b) => order.get(a.student.id)! - order.get(b.student.id)!)
    // A subject teacher only sees students who actually take one of THEIR subjects
    // (a Physics teacher shouldn't see arts students as blank rows). The Form Teacher sees everyone.
    if (isFormTeacherForClass) return sorted
    return sorted.filter(r => visibleSubjects.some(s => r.perSubject[s.id] !== null))
  }, [enrollments, allLevelSubjects, resultsBySubject, roster, rosterRows, rosterFailed, isFormTeacherForClass, visibleSubjects])

  const noSelection = !selectedClassId

  return (
    <div>
      <PageHeader
        title="Broadsheet"
        description={currentTerm ? `${currentTerm.name} — Class Results Summary` : 'No active term'}
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {sections.length > 0 ? (
                groupBySection(uniqueClasses, c => c.class_level, sections).map(group => (
                  <SelectGroup key={group.section?.id ?? 'ungrouped'}>
                    <SelectLabel>{group.section?.name ?? 'Ungrouped'}</SelectLabel>
                    {group.items.map(cls => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.class_level?.name}{cls.class_arm ? ' ' + cls.class_arm.name : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              ) : (
                uniqueClasses.map(cls => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.class_level?.name}{cls.class_arm ? ' ' + cls.class_arm.name : ''}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!noSelection && !isFormTeacherForClass && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center gap-2 text-sm text-blue-800">
          <Lock className="h-4 w-4 shrink-0" />
          You're viewing your own subject{visibleSubjects.length !== 1 ? 's' : ''} only. Full class ranking is visible to this class's Form Teacher.
        </div>
      )}

      {noSelection ? (
        <EmptyState icon={<ClipboardList className="h-12 w-12" />} title="Select a class" description="Choose a class to view its broadsheet." />
      ) : !currentTerm ? (
        <EmptyState title="No active term" description="Ask your school admin to mark a term as current." />
      ) : visibleSubjects.length === 0 ? (
        <EmptyState title="No subjects to show" description="You have no subject assigned for this class yet." />
      ) : loadingResults ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No students enrolled" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table containerClassName="max-h-[70vh]">
              <TableHeader>
                <TableRow>
                  {/* Both corner cells (Pos + Student when present) are
                      sticky on both axes — highest z-index tier, same
                      reasoning as ScoreEntryPage. */}
                  {isFormTeacherForClass && <TableHead className="sticky left-0 top-0 z-30 bg-background w-10">Pos</TableHead>}
                  <TableHead className={isFormTeacherForClass ? 'sticky left-10 top-0 z-30 bg-background' : 'sticky left-0 top-0 z-30 bg-background'}>Student</TableHead>
                  {visibleSubjects.map(s => (
                    <TableHead key={s.id} className="sticky top-0 z-20 bg-background text-center whitespace-nowrap">{s.code ?? s.name.slice(0, 3).toUpperCase()}</TableHead>
                  ))}
                  {isFormTeacherForClass && (
                    <>
                      <TableHead className="sticky top-0 z-20 bg-background text-center font-semibold">Total</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center font-semibold">Average</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.student.id}>
                    {isFormTeacherForClass && (
                      <TableCell className="sticky left-0 z-10 bg-background">
                        <div className="flex items-center gap-1">
                          {idx === 0 && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                          <span className="text-sm font-medium">{ordinalSuffix(idx + 1)}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className={`sticky z-10 bg-background font-medium text-sm whitespace-nowrap ${isFormTeacherForClass ? 'left-10' : 'left-0'}`}>
                      {row.student.last_name}, {row.student.first_name}
                    </TableCell>
                    {visibleSubjects.map(s => (
                      row.perSubject[s.id] === null
                        ? <TableCell key={s.id} className="text-center text-xs text-muted-foreground/60" title="Doesn't take this optional subject">n/a</TableCell>
                        : <TableCell key={s.id} className="text-center text-sm">{row.perSubject[s.id] || '—'}</TableCell>
                    ))}
                    {isFormTeacherForClass && (
                      <>
                        <TableCell className="text-center font-semibold text-sm">{row.grandTotal}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.average >= 50 ? 'success' : 'destructive'}>{row.average}</Badge>
                        </TableCell>
                      </>
                    )}
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
