import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClassSubjectRosterRow } from '@/types'

// Who takes which subject in a class (honours optional/elective subjects).
// The database is the single source of truth (student_takes_subject), so every
// screen that lists "students for a subject" or "subjects for a student"
// uses this rather than re-deriving it from offerings.
export function useClassSubjectRoster(classId: string | null | undefined) {
  return useQuery({
    queryKey: ['class-subject-roster', classId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_class_subject_roster', { p_class_id: classId })
      if (error) throw error
      return (data ?? []) as ClassSubjectRosterRow[]
    },
    enabled: !!classId
  })
}

export interface RosterIndex {
  // subjectId -> set of studentIds who take it
  studentsBySubject: Map<string, Set<string>>
  // studentId -> set of subjectIds they take
  subjectsByStudent: Map<string, Set<string>>
  optionalSubjectIds: Set<string>
}

export function indexRoster(rows: ClassSubjectRosterRow[] | undefined): RosterIndex {
  const studentsBySubject = new Map<string, Set<string>>()
  const subjectsByStudent = new Map<string, Set<string>>()
  const optionalSubjectIds = new Set<string>()
  for (const r of rows ?? []) {
    if (!studentsBySubject.has(r.subject_id)) studentsBySubject.set(r.subject_id, new Set())
    studentsBySubject.get(r.subject_id)!.add(r.student_id)
    if (!subjectsByStudent.has(r.student_id)) subjectsByStudent.set(r.student_id, new Set())
    subjectsByStudent.get(r.student_id)!.add(r.subject_id)
    if (r.is_optional) optionalSubjectIds.add(r.subject_id)
  }
  return { studentsBySubject, subjectsByStudent, optionalSubjectIds }
}

// Ranking that stays fair when students take different numbers of subjects.
// If everyone in the class takes the same number of subjects, rank by total
// points exactly as before. If counts differ (optional subjects in play), a
// raw total would penalise students with fewer subjects, so rank by average.
export interface RankEntry { studentId: string; total: number; average: number; count: number }
export function rankEntries(entries: RankEntry[]): RankEntry[] {
  const counts = new Set(entries.map(e => e.count))
  const byAverage = counts.size > 1
  return [...entries].sort((a, b) => byAverage ? (b.average - a.average) || (b.total - a.total) : (b.total - a.total))
}
