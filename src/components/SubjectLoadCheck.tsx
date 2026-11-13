import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClassSubjectRoster, indexRoster } from '@/lib/subjectRoster'
import { useGroupTypes, useClassGroupMembers } from '@/lib/studentGroups'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Student } from '@/types'

interface Props {
  classId: string
  sessionId: string
}

// Balance check for a class: with group-restricted and optional subjects, every student
// should end up with the SAME NUMBER of subjects (Science and Arts students both take, say, 11).
// This lists how many students take how many subjects, and names anyone who differs from the
// most common count — with the likeliest reason (no group set for a type, or no elective chosen),
// because averages and ranking assume each student's own subject list is complete.
export function SubjectLoadCheck({ classId, sessionId }: Props) {
  const { schoolId } = useAuth()
  const { data: rosterRows } = useClassSubjectRoster(classId)
  const { data: types = [] } = useGroupTypes(schoolId)
  const { data: members = [] } = useClassGroupMembers(classId, sessionId)

  const { data: students = [] } = useQuery({
    queryKey: ['subject-choices-students', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('student:students(*)').eq('class_id', classId)
      if (error) throw error
      return (data as unknown as { student: Student }[]).map(e => e.student).filter(Boolean)
        .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
    }
  })

  const report = useMemo(() => {
    if (!rosterRows || students.length === 0) return null
    const roster = indexRoster(rosterRows)
    const counts = students.map(s => ({ student: s, count: roster.subjectsByStudent.get(s.id)?.size ?? 0 }))
    const tally = new Map<number, number>()
    counts.forEach(c => tally.set(c.count, (tally.get(c.count) ?? 0) + 1))
    // the "norm" is the most common subject count (ties -> the larger count)
    const norm = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    const groupedBy = new Map(members.map(m => [`${m.student_id}:${m.type_id}`, m.group_id]))
    const outliers = counts.filter(c => c.count !== norm).map(c => {
      const missingTypes = types.filter(t => t.groups.length > 0 && !groupedBy.has(`${c.student.id}:${t.id}`)).map(t => t.name)
      const kept = [...roster.viaScores].filter(k => k.startsWith(`${c.student.id}:`)).length
      return { ...c, missingTypes, kept }
    })
    return { norm, tally: [...tally.entries()].sort((a, b) => a[0] - b[0]), outliers }
  }, [rosterRows, students, members, types])

  if (!report) return null
  const balanced = report.outliers.length === 0

  return (
    <Card className={balanced ? 'border-green-300' : 'border-yellow-400'}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          {balanced
            ? <CheckCircle2 className="h-5 w-5 mt-0.5 text-green-600 shrink-0" />
            : <AlertTriangle className="h-5 w-5 mt-0.5 text-yellow-600 shrink-0" />}
          <div className="text-sm">
            <div className="font-medium">
              {balanced
                ? `Balanced — all ${students.length} students take ${report.norm} subjects`
                : `${report.outliers.length} student${report.outliers.length !== 1 ? 's' : ''} ${report.outliers.length !== 1 ? 'have' : 'has'} a different number of subjects (most take ${report.norm})`}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {report.tally.map(([n, k]) => (
                <Badge key={n} variant={n === report.norm ? 'success' : 'warning'}>{k} student{k !== 1 ? 's' : ''} · {n} subject{n !== 1 ? 's' : ''}</Badge>
              ))}
            </div>
          </div>
        </div>

        {!balanced && (
          <ul className="space-y-1 text-sm pl-8">
            {report.outliers.slice(0, 12).map(o => (
              <li key={o.student.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{o.student.last_name}, {o.student.first_name}</span>
                <span className="text-muted-foreground">takes {o.count}</span>
                {o.missingTypes.length > 0 && <span className="text-xs text-destructive">no {o.missingTypes.join(' / ')} set</span>}
                {o.kept > 0 && <span className="text-xs text-blue-700 dark:text-blue-300">includes {o.kept} kept by recorded scores</span>}
              </li>
            ))}
            {report.outliers.length > 12 && <li className="text-xs text-muted-foreground">…and {report.outliers.length - 12} more</li>}
            <li className="text-xs text-muted-foreground pt-1">
              Averages and ranking use each student&apos;s own subjects, so a student with missing subjects will be ranked on fewer. Fix the group or subject choice above, then this updates. A subject kept because scores are recorded is never removed automatically.
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
