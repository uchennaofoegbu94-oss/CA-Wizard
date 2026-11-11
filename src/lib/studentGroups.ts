import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { StudentGroup, StudentGroupMember, StudentGroupType, SubjectAudienceMode } from '@/types'

export interface GroupTypeWithGroups extends StudentGroupType {
  groups: StudentGroup[]
}

// Every group type with its groups (small: a handful per school)
export function useGroupTypes(schoolId: string | null | undefined) {
  return useQuery({
    queryKey: ['student-group-types', schoolId],
    queryFn: async () => {
      const [{ data: types, error: e1 }, { data: groups, error: e2 }] = await Promise.all([
        supabase.from('student_group_types').select('*').eq('school_id', schoolId!).order('sort_order').order('name'),
        supabase.from('student_groups').select('*').eq('school_id', schoolId!).order('sort_order').order('name')
      ])
      if (e1) throw e1
      if (e2) throw e2
      return (types as StudentGroupType[]).map(t => ({
        ...t, groups: (groups as StudentGroup[]).filter(g => g.type_id === t.id)
      })) as GroupTypeWithGroups[]
    },
    enabled: !!schoolId
  })
}

// Group memberships of the students in ONE class, for that class's session
export function useClassGroupMembers(classId: string | null | undefined, sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ['class-group-members', classId, sessionId],
    queryFn: async () => {
      const { data: enrol, error: e1 } = await supabase.from('student_enrollments').select('student_id').eq('class_id', classId!)
      if (e1) throw e1
      const ids = (enrol ?? []).map(e => e.student_id as string)
      if (ids.length === 0) return [] as StudentGroupMember[]
      const { data, error } = await supabase.from('student_group_members').select('*').eq('session_id', sessionId!).in('student_id', ids)
      if (error) throw error
      return data as StudentGroupMember[]
    },
    enabled: !!classId && !!sessionId
  })
}

// Which mode a subject offering is in (mirrors set_subject_audience's modes)
export function audienceMode(o: { is_optional: boolean; groups?: { group_id: string }[] }): SubjectAudienceMode {
  if (o.groups && o.groups.length > 0) return 'groups'
  return o.is_optional ? 'choice' : 'everyone'
}

export const AUDIENCE_LABEL: Record<SubjectAudienceMode, string> = {
  everyone: 'Everyone (compulsory)',
  groups: 'Only certain groups',
  choice: 'Students choose individually'
}

// Subject ids whose takers are a SUBSET of the class (individual choice or group audience).
// Needed alongside the roster because a restricted subject nobody qualifies for yet has no
// roster rows — without this "no takers" would look the same as "not restricted".
export function useRestrictedSubjectIds(classLevelId: string | null | undefined) {
  return useQuery({
    queryKey: ['restricted-subject-ids', classLevelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings').select('subject_id, is_optional, groups:subject_offering_groups(group_id)')
        .eq('class_level_id', classLevelId!)
      if (error) throw error
      const ids = new Set<string>()
      ;(data ?? []).forEach((o: any) => { if (o.is_optional || (o.groups && o.groups.length > 0)) ids.add(o.subject_id as string) })
      return ids
    },
    enabled: !!classLevelId
  })
}
