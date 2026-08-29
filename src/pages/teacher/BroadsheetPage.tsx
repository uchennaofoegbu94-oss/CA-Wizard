import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Trophy, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ordinalSuffix } from '@/lib/utils'
import type { Term, Subject, Student, StudentEnrollment, ScoreFieldValue, TeacherAssignment, Class } from '@/types'

interface StudentTotals {
  student: Student
  perSubject: Record<string, number>
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

  const rows: StudentTotals[] = useMemo(() => {
    const students = enrollments.map(e => e.student!).filter(Boolean)
    const computed = students.map(student => {
      const perSubject: Record<string, number> = {}
      let grandTotal = 0
      // Grand total / average are only meaningful across ALL subjects,
      // so they're computed from allLevelSubjects regardless of what's
      // visible — but only ever rendered on screen when isFormTeacherForClass.
      allLevelSubjects.forEach(subj => {
        const subjResults = resultsBySubject[subj.id] ?? []
        const totalRow = subjResults.find(r => r.student_id === student.id && r.is_total_field)
        const total = totalRow?.value ?? 0
        perSubject[subj.id] = total
        grandTotal += total
      })
      const average = allLevelSubjects.length > 0 ? Math.round((grandTotal / allLevelSubjects.length) * 100) / 100 : 0
      return { student, perSubject, grandTotal, average }
    })
    return computed.sort((a, b) => b.grandTotal - a.grandTotal)
  }, [enrollments, allLevelSubjects, resultsBySubject])

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
              {uniqueClasses.map(cls => (
                <SelectItem key={cls.id} value={cls.id}>
                  {cls.class_level?.name}{cls.class_arm ? ' ' + cls.class_arm.name : ''}
                </SelectItem>
              ))}
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
            <Table>
              <TableHeader>
                <TableRow>
                  {isFormTeacherForClass && <TableHead className="sticky left-0 bg-background z-10 w-10">Pos</TableHead>}
                  <TableHead className={isFormTeacherForClass ? 'sticky left-10 bg-background z-10' : 'sticky left-0 bg-background z-10'}>Student</TableHead>
                  {visibleSubjects.map(s => (
                    <TableHead key={s.id} className="text-center whitespace-nowrap">{s.code ?? s.name.slice(0, 3).toUpperCase()}</TableHead>
                  ))}
                  {isFormTeacherForClass && (
                    <>
                      <TableHead className="text-center font-semibold">Total</TableHead>
                      <TableHead className="text-center font-semibold">Average</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.student.id}>
                    {isFormTeacherForClass && (
                      <TableCell className="sticky left-0 bg-background">
                        <div className="flex items-center gap-1">
                          {idx === 0 && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                          <span className="text-sm font-medium">{ordinalSuffix(idx + 1)}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className={`sticky bg-background font-medium text-sm whitespace-nowrap ${isFormTeacherForClass ? 'left-10' : 'left-0'}`}>
                      {row.student.last_name}, {row.student.first_name}
                    </TableCell>
                    {visibleSubjects.map(s => (
                      <TableCell key={s.id} className="text-center text-sm">{row.perSubject[s.id] || '—'}</TableCell>
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
