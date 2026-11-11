import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Users, BookOpen, GraduationCap, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { initials } from '@/lib/utils'
import { SubjectChoicesPanel } from '@/components/SubjectChoicesPanel'
import { StudentGroupsPanel } from '@/components/StudentGroupsPanel'
import { SubjectLoadCheck } from '@/components/SubjectLoadCheck'
import { useAuth } from '@/contexts/AuthContext'
import { useGroupTypes } from '@/lib/studentGroups'
import { useClassSubjectRoster, indexRoster } from '@/lib/subjectRoster'
import type { Class, StudentEnrollment, Subject, TeacherAssignment } from '@/types'

export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: cls, isLoading: loadingClass } = useQuery({
    queryKey: ['class-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*, class_level:class_levels(*), class_arm:class_arms(*), session:sessions(*), form_teacher:profiles(*)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as Class
    },
    enabled: !!id
  })

  const { data: enrollments = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['class-detail-students', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('*, student:students(*)')
        .eq('class_id', id!)
      if (error) throw error
      return (data as StudentEnrollment[])
        .filter(e => e.student)
        .sort((a, b) => (a.student!.last_name + a.student!.first_name).localeCompare(b.student!.last_name + b.student!.first_name))
    },
    enabled: !!id
  })

  const { data: subjects = [] } = useQuery({
    queryKey: ['class-detail-subjects', cls?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings')
        .select('is_optional, groups:subject_offering_groups(group:student_groups(name)), subject:subjects(*)')
        .eq('class_level_id', cls!.class_level_id)
      if (error) throw error
      return (data as unknown as { is_optional: boolean; groups: { group: { name: string } | null }[]; subject: Subject }[])
        .filter(o => o.subject)
        .map(o => ({ ...o.subject, is_optional: o.is_optional, groupNames: (o.groups ?? []).map(g => g.group?.name).filter(Boolean) as string[] }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: !!cls?.class_level_id
  })

  const { data: assignments = [] } = useQuery({
    queryKey: ['class-detail-assignments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select('*, teacher:profiles(*), subject:subjects(*)')
        .eq('class_id', id!)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!id
  })

  // Who takes each subject (optional subjects only include students who opted in)
  const { data: rosterRows } = useClassSubjectRoster(id)
  const roster = indexRoster(rosterRows)
  const { schoolId } = useAuth()
  const { data: groupTypes = [] } = useGroupTypes(schoolId)
  const hasOptional = subjects.some(s => s.is_optional)
  const hasGroupSubjects = subjects.some(s => s.groupNames.length > 0)
  const showGroups = hasGroupSubjects || groupTypes.length > 0

  const subjectTeacher = (subjectId: string) =>
    assignments.find(a => a.subject_id === subjectId)?.teacher

  const students = enrollments.map(e => e.student!).filter(Boolean)
  const activeCount = students.filter(s => s.is_active).length
  const classLabel = cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  if (loadingClass) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (!cls) {
    return <EmptyState title="Class not found" description="This class may have been deleted." />
  }

  return (
    <div>
      <Link to="/school/classes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-3.5 w-3.5" />Back to Classes
      </Link>

      <PageHeader title={classLabel} description={cls.session?.name ?? ''} />

      {/* Summary strip — the "basic summary" the class page links out to */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{students.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Students{activeCount !== students.length ? ` (${activeCount} active)` : ''}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{subjects.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Subjects</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold leading-none truncate">
                  {cls.form_teacher ? `${cls.form_teacher.first_name} ${cls.form_teacher.last_name}` : 'Unassigned'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Form Teacher</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enrolled Students</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingStudents ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : students.length === 0 ? (
              <EmptyState title="No students enrolled" />
            ) : (
              <div className="divide-y">
                {students.map(s => (
                  <Link
                    key={s.id}
                    to="/school/students"
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors"
                  >
                    {s.photo_url ? (
                      <img src={s.photo_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
                        {initials(s.first_name, s.last_name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.first_name} {s.last_name}</p>
                      <p className="text-xs text-muted-foreground">{s.admission_number}</p>
                    </div>
                    {!s.is_active && <Badge variant="outline" className="text-[10px]">{s.status}</Badge>}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subjects Offered</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {subjects.length === 0 ? (
              <EmptyState title="No subjects offered at this class level" description="Add subjects under Subjects → Class Level Offerings." />
            ) : (
              <div className="divide-y">
                {subjects.map(subj => {
                  const teacher = subjectTeacher(subj.id)
                  return (
                    <div key={subj.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium">{subj.name}</p>
                        {subj.is_optional && (
                          <Badge variant="info" className="text-[10px]">
                            Optional · {roster.studentsBySubject.get(subj.id)?.size ?? 0} of {students.length}
                          </Badge>
                        )}
                        {subj.groupNames.length > 0 && (
                          <Badge variant="info" className="text-[10px]">
                            {subj.groupNames.join(' / ')} only · {roster.studentsBySubject.get(subj.id)?.size ?? 0} of {students.length}
                          </Badge>
                        )}
                      </div>
                      {teacher ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />{teacher.first_name} {teacher.last_name}
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Unassigned</Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(hasOptional || hasGroupSubjects) && (
        <div className="mt-6">
          <SubjectLoadCheck classId={cls.id} sessionId={cls.session_id} />
        </div>
      )}

      {showGroups && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Student Groups</CardTitle>
          </CardHeader>
          <CardContent>
            <StudentGroupsPanel classId={cls.id} classLabel={classLabel} setupHint="Create them under Student Groups in the menu." />
          </CardContent>
        </Card>
      )}

      {hasOptional && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Subject Choices</CardTitle>
          </CardHeader>
          <CardContent>
            <SubjectChoicesPanel classId={cls.id} classLabel={classLabel} offeringsHint="Set electives under Subjects → Class Level Offerings." />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
