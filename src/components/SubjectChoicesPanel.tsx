import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Loader2, Info, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { useClassSubjectRoster } from '@/lib/subjectRoster'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/table'
import toast from 'react-hot-toast'
import type { Class, ClassSubjectRosterRow, Student, Subject } from '@/types'

// Lowercase + strip accents so searching is forgiving
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

interface Props {
  classId: string
  // Shown in the heading, e.g. "SS1 Science"
  classLabel: string
  // Where an admin can mark subjects optional (omit for section admins who can't)
  offeringsHint?: string
}

// Assign optional (elective) subjects to the students of ONE class for that
// class's session. The roster RPC (get_class_subject_roster) is the source of
// truth for "who takes what"; changes go through set_class_subject_takers,
// which re-checks permission in the database (school admin, or a section admin
// holding "enroll students" for this class's section).
export function SubjectChoicesPanel({ classId, classLabel, offeringsHint }: Props) {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const rosterKey = ['class-subject-roster', classId]

  const { data: cls } = useQuery({
    queryKey: ['subject-choices-class', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, class_level:class_levels(*)').eq('id', classId).single()
      if (error) throw error
      return data as Class
    }
  })

  // Optional subjects offered at this class's level
  const { data: optionalSubjects = [], isLoading: loadingSubjects } = useQuery({
    queryKey: ['subject-choices-optional-subjects', cls?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings').select('subject:subjects(*)')
        .eq('class_level_id', cls!.class_level_id).eq('is_optional', true)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: !!cls?.class_level_id
  })

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['subject-choices-students', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('student:students(*)').eq('class_id', classId)
      if (error) throw error
      return (data as unknown as { student: Student }[]).map(e => e.student).filter(Boolean)
        .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
    }
  })

  const { data: roster = [], isLoading: loadingRoster } = useClassSubjectRoster(classId)

  // student -> optional subjects they take
  const takes = useMemo(() => {
    const m = new Set<string>()
    roster.forEach(r => { if (r.is_optional) m.add(`${r.student_id}:${r.subject_id}`) })
    return m
  }, [roster])

  // A student who already has recorded scores in a subject keeps it whatever is ticked, so un-ticking
  // them would do nothing. Show them as locked instead of offering a control that silently fails.
  const locked = useMemo(() => {
    const m = new Set<string>()
    roster.forEach(r => { if (r.is_optional && r.has_scores) m.add(`${r.student_id}:${r.subject_id}`) })
    return m
  }, [roster])

  const visibleStudents = useMemo(() => {
    const tokens = norm(search).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return students
    return students.filter(s => {
      const hay = norm(`${s.first_name} ${s.middle_name ?? ''} ${s.last_name} ${s.admission_number}`)
      return tokens.every(t => hay.includes(t))
    })
  }, [students, search])

  const setTakers = useMutation({
    mutationFn: async ({ subjectId, studentIds, takes: value }: { subjectId: string; studentIds: string[]; takes: boolean }) => {
      const { error } = await supabase.rpc('set_class_subject_takers', {
        p_class_id: classId, p_subject_id: subjectId, p_student_ids: studentIds, p_takes: value
      })
      if (error) throw error
    },
    // Optimistic: flip the checkbox immediately, roll back if the database says no
    onMutate: async ({ subjectId, studentIds, takes: value }) => {
      await qc.cancelQueries({ queryKey: rosterKey })
      const previous = qc.getQueryData<ClassSubjectRosterRow[]>(rosterKey)
      qc.setQueryData<ClassSubjectRosterRow[]>(rosterKey, (old = []) => {
        const ids = new Set(studentIds)
        // students with recorded scores stay on the subject even when un-ticked, so keep their rows
        const without = old.filter(r => !(r.subject_id === subjectId && ids.has(r.student_id)) || r.has_scores)
        const have = new Set(without.filter(r => r.subject_id === subjectId).map(r => r.student_id))
        return value
          ? [...without, ...studentIds.filter(id => !have.has(id)).map(student_id => ({ student_id, subject_id: subjectId, is_optional: true, via_scores: false, has_scores: false }))]
          : without
      })
      return { previous }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(rosterKey, ctx.previous)
      toast.error(e.message.replace(/^set_class_subject_takers:\s*/, ''))
    },
    onSettled: () => {
      // Everything that lists students-per-subject or subjects-per-student must refetch
      qc.invalidateQueries({ queryKey: rosterKey })
      qc.invalidateQueries({ queryKey: ['student-optional-subjects'] })
      qc.invalidateQueries({ queryKey: ['score-entry'] })
    },
    onSuccess: (_d, { subjectId, studentIds, takes: value }) => {
      const kept = value ? 0 : studentIds.filter(id => locked.has(`${id}:${subjectId}`)).length
      if (studentIds.length > 1 || kept > 0) {
        toast.success(value
          ? `Added ${studentIds.length} students`
          : `Removed ${studentIds.length - kept} student${studentIds.length - kept !== 1 ? 's' : ''}${kept > 0 ? ` — ${kept} kept because they already have recorded scores` : ''}`)
      }
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'student_optional_subject',
        entityId: subjectId, newValue: { class_id: classId, students: studentIds.length, takes: value }
      })
    }
  })

  const loading = loadingSubjects || loadingStudents || loadingRoster || !cls

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>

  if (optionalSubjects.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <Info className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No subjects at {cls.class_level?.name ?? 'this level'} are chosen student-by-student</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Subjects here are either taken by everyone or decided by a student group (e.g. Science / Arts) — set those on the Student Groups side.
            {offeringsHint ? ` ${offeringsHint}` : ' To let students choose a subject individually, your school admin sets it to "Students choose individually".'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">No students are enrolled in {classLabel} yet.</p>
  }

  const countFor = (subjectId: string) => students.filter(s => takes.has(`${s.id}:${subjectId}`)).length

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200">
        Tick the optional subjects each student in <strong>{classLabel}</strong> takes this session. A student who isn&apos;t ticked won&apos;t appear
        on that subject&apos;s score sheet and won&apos;t have it on their report card, broadsheet or average. A student who <strong>already has recorded scores</strong> in a subject
        keeps it (shown with a <Lock className="inline h-3 w-3 -mt-0.5" />) so no result is ever hidden — to drop it, clear their scores in Score Entry.
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search students by name or admission no."
          className="flex h-10 w-full rounded-md border border-input bg-background text-foreground pl-9 pr-9 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search students"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium px-4 py-3 sticky left-0 bg-muted/40 min-w-[200px]">
                  Student <span className="text-xs text-muted-foreground font-normal">({visibleStudents.length}{search ? ` of ${students.length}` : ''})</span>
                </th>
                {optionalSubjects.map(sub => (
                  <th key={sub.id} className="px-3 py-2 text-center min-w-[120px]">
                    <div className="font-medium">{sub.name}</div>
                    <Badge variant="secondary" className="mt-1">{countFor(sub.id)} of {students.length}</Badge>
                    <div className="mt-1.5 flex justify-center gap-1">
                      <Button
                        variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                        disabled={setTakers.isPending}
                        onClick={() => setTakers.mutate({ subjectId: sub.id, studentIds: visibleStudents.map(s => s.id), takes: true })}
                        title={search ? 'Add everyone matching your search' : 'Add every student in this class'}
                      >All</Button>
                      <Button
                        variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                        disabled={setTakers.isPending}
                        onClick={() => setTakers.mutate({ subjectId: sub.id, studentIds: visibleStudents.map(s => s.id), takes: false })}
                        title={search ? 'Remove everyone matching your search' : 'Remove every student in this class'}
                      >None</Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleStudents.length === 0 ? (
                <tr><td colSpan={optionalSubjects.length + 1} className="px-4 py-6 text-center text-muted-foreground">No students match “{search}”</td></tr>
              ) : visibleStudents.map(st => (
                <tr key={st.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 sticky left-0 bg-background">
                    <div className="font-medium">{st.last_name}, {st.first_name}</div>
                    <div className="text-xs text-muted-foreground">{st.admission_number}</div>
                  </td>
                  {optionalSubjects.map(sub => {
                    const checked = takes.has(`${st.id}:${sub.id}`)
                    const isLocked = checked && locked.has(`${st.id}:${sub.id}`)
                    return (
                      <td key={sub.id} className="px-3 py-2 text-center">
                        <span className="inline-flex items-center gap-1" title={isLocked ? `Has recorded scores in ${sub.name}, so it stays. Clear the scores in Score Entry to remove it.` : undefined}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded cursor-pointer disabled:cursor-not-allowed"
                            checked={checked}
                            disabled={isLocked}
                            onChange={() => setTakers.mutate({ subjectId: sub.id, studentIds: [st.id], takes: !checked })}
                            aria-label={`${st.first_name} ${st.last_name} takes ${sub.name}${isLocked ? ' (has recorded scores)' : ''}`}
                          />
                          {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {setTakers.isPending && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</p>}
    </div>
  )
}
