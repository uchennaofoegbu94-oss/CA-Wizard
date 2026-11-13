import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Info, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { useGroupTypes, useClassGroupMembers } from '@/lib/studentGroups'
import { useClassSubjectRoster, indexRoster } from '@/lib/subjectRoster'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/table'
import toast from 'react-hot-toast'
import type { Class, Student, StudentGroupMember } from '@/types'

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

interface Props {
  classId: string
  classLabel: string
  // Shown when the school has no group types yet (omit for section admins who can't create them)
  setupHint?: string
}

// Put the students of ONE class into groups (e.g. Stream: Science / Arts, Religion: Christian / Muslim)
// for that class's session. Subjects restricted to a group then appear only for those students.
// Writes go through set_class_group_members, which re-checks permission in the database
// (school admin, or a section admin holding "enroll students" for this class's section).
export function StudentGroupsPanel({ classId, classLabel, setupHint }: Props) {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: cls } = useQuery({
    queryKey: ['groups-panel-class', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('*, class_level:class_levels(*)').eq('id', classId).single()
      if (error) throw error
      return data as Class
    }
  })
  const { data: types = [], isLoading: loadingTypes } = useGroupTypes(schoolId)
  const { data: members = [], isLoading: loadingMembers } = useClassGroupMembers(classId, cls?.session_id)
  const { data: rosterRows } = useClassSubjectRoster(classId)
  // subjects a student keeps ONLY because scores are recorded (their group wouldn't give them)
  const keptCount = useMemo(() => {
    const m = new Map<string, number>()
    indexRoster(rosterRows).viaScores.forEach(k => { const sid = k.split(':')[0]; m.set(sid, (m.get(sid) ?? 0) + 1) })
    return m
  }, [rosterRows])

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['subject-choices-students', classId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('student:students(*)').eq('class_id', classId)
      if (error) throw error
      return (data as unknown as { student: Student }[]).map(e => e.student).filter(Boolean)
        .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
    }
  })

  // Group TYPES that some subject at this class's level is restricted to. A student with no group
  // in one of these silently misses those subjects, so unassigned cells are flagged for them.
  const { data: typesInUse = new Set<string>() } = useQuery({
    queryKey: ['group-types-in-use', cls?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offering_groups')
        .select('group:student_groups(type_id), offering:subject_offerings!inner(class_level_id)')
        .eq('offering.class_level_id', cls!.class_level_id)
      if (error) throw error
      return new Set((data ?? []).map((r: any) => r.group?.type_id as string).filter(Boolean))
    },
    enabled: !!cls?.class_level_id
  })

  const membersKey = ['class-group-members', classId, cls?.session_id]
  const groupOf = useMemo(() => {
    const m = new Map<string, string>()
    members.forEach(x => m.set(`${x.student_id}:${x.type_id}`, x.group_id))
    return m
  }, [members])

  const visible = useMemo(() => {
    const tokens = norm(search).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return students
    return students.filter(s => {
      const hay = norm(`${s.first_name} ${s.middle_name ?? ''} ${s.last_name} ${s.admission_number}`)
      return tokens.every(t => hay.includes(t))
    })
  }, [students, search])

  const assign = useMutation({
    mutationFn: async ({ typeId, groupId, studentIds }: { typeId: string; groupId: string | null; studentIds: string[] }) => {
      const { error } = await supabase.rpc('set_class_group_members', {
        p_class_id: classId, p_type_id: typeId, p_group_id: groupId, p_student_ids: studentIds
      })
      if (error) throw error
    },
    onMutate: async ({ typeId, groupId, studentIds }) => {
      await qc.cancelQueries({ queryKey: membersKey })
      const previous = qc.getQueryData<StudentGroupMember[]>(membersKey)
      qc.setQueryData<StudentGroupMember[]>(membersKey, (old = []) => {
        const ids = new Set(studentIds)
        const rest = old.filter(m => !(m.type_id === typeId && ids.has(m.student_id)))
        if (!groupId) return rest
        return [...rest, ...studentIds.map(student_id => ({
          id: `tmp-${student_id}-${typeId}`, school_id: schoolId!, student_id, session_id: cls!.session_id, type_id: typeId, group_id: groupId
        }))]
      })
      return { previous }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(membersKey, ctx.previous)
      toast.error(e.message.replace(/^set_class_group_members:\s*/, ''))
    },
    onSettled: () => {
      // Who takes which subject depends on groups — every roster-driven screen must refetch
      qc.invalidateQueries({ queryKey: membersKey })
      qc.invalidateQueries({ queryKey: ['class-subject-roster'] })
      qc.invalidateQueries({ queryKey: ['score-entry'] })
    },
    onSuccess: (_d, { typeId, groupId, studentIds }) => {
      if (studentIds.length > 1) toast.success(groupId ? `Updated ${studentIds.length} students` : `Cleared ${studentIds.length} students`)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'student_group_member',
        entityId: typeId, newValue: { class_id: classId, students: studentIds.length, group_id: groupId }
      })
    }
  })

  if (loadingTypes || loadingMembers || loadingStudents || !cls) {
    return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  }

  const usableTypes = types.filter(t => t.groups.length > 0)
  if (usableTypes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <Info className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No student groups set up yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Groups such as <em>Science / Arts</em> or <em>Christian / Muslim</em> let each student automatically get the right subjects.
            {setupHint ? ` ${setupHint}` : ' Ask your school admin to create them first.'}
          </p>
        </CardContent>
      </Card>
    )
  }
  if (students.length === 0) return <p className="text-sm text-muted-foreground">No students are enrolled in {classLabel} yet.</p>

  const unassignedFor = (typeId: string) => students.filter(s => !groupOf.has(`${s.id}:${typeId}`)).length

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200">
        Choose each student&apos;s group for <strong>{classLabel}</strong> this session. Subjects restricted to a group (for example Technical Drawing → Science,
        Islamic Studies → Muslim) then appear only for the students in it. A student with no group won&apos;t get those subjects — they&apos;re flagged in red so nobody is missed.
        A student can be in only one group per type. <strong>Changing a group never hides results:</strong> a student keeps any subject they already have recorded scores in.
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
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
                  Student <span className="text-xs text-muted-foreground font-normal">({visible.length}{search ? ` of ${students.length}` : ''})</span>
                </th>
                {usableTypes.map(t => {
                  const none = unassignedFor(t.id)
                  return (
                    <th key={t.id} className="px-3 py-2 text-left min-w-[180px] align-top">
                      <div className="font-medium">{t.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.groups.map(g => (
                          <Badge key={g.id} variant="secondary" className="text-[10px]">
                            {g.name} {students.filter(s => groupOf.get(`${s.id}:${t.id}`) === g.id).length}
                          </Badge>
                        ))}
                        {none > 0 && <Badge variant={typesInUse.has(t.id) ? 'destructive' : 'outline'} className="text-[10px]">Unassigned {none}</Badge>}
                      </div>
                      <select
                        className="mt-1.5 h-7 w-full rounded border border-input bg-background text-xs px-1"
                        value=""
                        disabled={assign.isPending}
                        onChange={e => {
                          const v = e.target.value
                          if (!v) return
                          assign.mutate({ typeId: t.id, groupId: v === '__clear' ? null : v, studentIds: visible.map(s => s.id) })
                        }}
                        aria-label={`Set ${t.name} for all ${search ? 'shown' : ''} students`}
                      >
                        <option value="">Set {search ? 'shown' : 'all'} to…</option>
                        {t.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        <option value="__clear">— clear —</option>
                      </select>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={usableTypes.length + 1} className="px-4 py-6 text-center text-muted-foreground">No students match “{search}”</td></tr>
              ) : visible.map(st => (
                <tr key={st.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 sticky left-0 bg-background">
                    <div className="font-medium">{st.last_name}, {st.first_name}</div>
                    <div className="text-xs text-muted-foreground">{st.admission_number}</div>
                    {(keptCount.get(st.id) ?? 0) > 0 && (
                      <div className="mt-0.5 text-[10px] text-blue-700 dark:text-blue-300" title="These subjects are not given by this student's groups; they stay because scores are already recorded.">
                        keeps {keptCount.get(st.id)} subject{keptCount.get(st.id) !== 1 ? 's' : ''} via recorded scores
                      </div>
                    )}
                  </td>
                  {usableTypes.map(t => {
                    const current = groupOf.get(`${st.id}:${t.id}`) ?? ''
                    const flagged = !current && typesInUse.has(t.id)
                    return (
                      <td key={t.id} className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            className={`h-8 w-full rounded border bg-background text-sm px-2 ${flagged ? 'border-destructive ring-1 ring-destructive/40' : 'border-input'}`}
                            value={current}
                            onChange={e => assign.mutate({ typeId: t.id, groupId: e.target.value || null, studentIds: [st.id] })}
                            aria-label={`${st.first_name} ${st.last_name} — ${t.name}`}
                          >
                            <option value="">— not set —</option>
                            {t.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          {flagged && <span title={`No ${t.name} set — this student misses subjects restricted by ${t.name}`}><AlertTriangle className="h-4 w-4 text-destructive shrink-0" /></span>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
