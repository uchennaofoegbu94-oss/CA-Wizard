import { useQuery } from '@tanstack/react-query'
import { GraduationCap, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Link } from 'react-router-dom'
import type { TeacherAssignment, Student } from '@/types'

export default function TeacherClassesPage() {
  const { profile, schoolId } = useAuth()

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['teacher-assignments', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_assignments')
        .select(`
          *,
          class:classes(*, class_level:class_levels(*), class_arm:class_arms(*)),
          subject:subjects(*)
        `)
        .eq('teacher_id', profile!.id)
      if (error) throw error
      return data as TeacherAssignment[]
    },
    enabled: !!profile?.id
  })

  // Unique classes from assignments
  const uniqueClasses = assignments.reduce<{ classId: string; cls: any; subjects: any[] }[]>((acc, a) => {
    const existing = acc.find(x => x.classId === a.class_id)
    if (existing) {
      if (a.subject) existing.subjects.push(a.subject)
    } else {
      acc.push({ classId: a.class_id, cls: (a as any).class, subjects: a.subject ? [(a as any).subject] : [] })
    }
    return acc
  }, [])

  // Student counts per class
  const { data: enrollments = [] } = useQuery({
    queryKey: ['enrollments-teacher', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('class_id, student_id')
        .eq('school_id', schoolId!)
      if (error) throw error
      return data
    },
    enabled: !!schoolId
  })

  const studentCount = (classId: string) =>
    enrollments.filter(e => e.class_id === classId).length

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  return (
    <div>
      <PageHeader
        title="My Classes"
        description="All classes and subjects assigned to you"
      />

      {uniqueClasses.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-12 w-12" />}
          title="No classes assigned yet"
          description="Ask your school admin for an invite code to get assigned to a class."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {uniqueClasses.map(({ classId, cls, subjects }) => (
            <Card key={classId} className="hover:border-brand-300 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                      <GraduationCap className="h-5 w-5 text-brand-700" />
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {cls?.class_level?.name} {cls?.class_arm?.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Users className="h-3 w-3" />
                        {studentCount(classId)} student{studentCount(classId) !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Subjects */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {subjects.length === 0 ? (
                    <Badge variant="secondary" className="text-xs">Form Teacher</Badge>
                  ) : (
                    subjects.map((s: any) => (
                      <Badge key={s.id} variant="secondary" className="text-xs">{s.name}</Badge>
                    ))
                  )}
                </div>

                {/* Students table preview */}
                <StudentRoster classId={classId} schoolId={schoolId!} />

                <div className="mt-3">
                  <Button size="sm" className="w-full" asChild>
                    <Link to={`/teacher/scores?class=${classId}`}>Enter Scores →</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentRoster({ classId, schoolId }: { classId: string; schoolId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['class-students', classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('student:students(id, first_name, last_name, admission_number)')
        .eq('class_id', classId)
        .eq('school_id', schoolId)
        .limit(5)
      if (error) throw error
      return data.map((e: any) => e.student as Student)
    }
  })

  if (data.length === 0) return (
    <p className="text-xs text-muted-foreground text-center py-3 border rounded-md">
      No students enrolled yet
    </p>
  )

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="h-8 text-xs">Student</TableHead>
            <TableHead className="h-8 text-xs hidden sm:table-cell">Adm. No.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(student => (
            <TableRow key={student.id} className="text-xs">
              <TableCell className="py-1.5 font-medium">
                {student.last_name}, {student.first_name}
              </TableCell>
              <TableCell className="py-1.5 font-mono text-muted-foreground hidden sm:table-cell">
                {student.admission_number}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
