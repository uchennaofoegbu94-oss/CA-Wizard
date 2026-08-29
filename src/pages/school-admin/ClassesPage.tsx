import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pencil, Trash2, MoreVertical, GraduationCap, Layers, Tag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import toast from 'react-hot-toast'
import type { Class, ClassLevel, ClassArm, Session, Profile } from '@/types'

// ─── Schemas ────────────────────────────────────────────────

const levelSchema = z.object({ name: z.string().min(1, 'Required') })
const armSchema   = z.object({ name: z.string().min(1, 'Required') })

// session_id is required here on purpose — a class cannot exist
// without one, and forcing an explicit choice (rather than
// silently assuming "whichever session is current") is what was
// missing before: there was no visible way to pick it, so the
// create action had nothing valid to submit.
const classSchema = z.object({
  session_id:      z.string().uuid('Select a session'),
  class_level_id:  z.string().uuid('Select a class level'),
  class_arm_id:    z.string().optional(),
  form_teacher_id: z.string().optional()
})

type LevelForm = z.infer<typeof levelSchema>
type ArmForm   = z.infer<typeof armSchema>
type ClassForm = z.infer<typeof classSchema>

const NONE_VALUE = '__none__'

export default function ClassesPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState('classes')
  const [view, setView] = useState<ViewMode>('list')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // ── Data: sessions (needed before classes can be created at all) ──
  const { data: sessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions-for-classes', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('school_id', schoolId!)
        .order('start_year', { ascending: false })
      if (error) throw error
      return data as Session[]
    },
    enabled: !!schoolId
  })

  // Default the working session to whichever is marked current,
  // falling back to the most recent one — but always something
  // visible and selectable, never silently null.
  const effectiveSessionId = selectedSessionId ?? sessions.find(s => s.is_current)?.id ?? sessions[0]?.id ?? null

  // ── Data: class levels & arms ──
  const { data: levels = [], isLoading: loadingLevels } = useQuery({
    queryKey: ['class-levels', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_levels')
        .select('*')
        .eq('school_id', schoolId!)
        .order('order_index')
      if (error) throw error
      return data as ClassLevel[]
    },
    enabled: !!schoolId
  })

  const { data: arms = [], isLoading: loadingArms } = useQuery({
    queryKey: ['class-arms', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_arms')
        .select('*')
        .eq('school_id', schoolId!)
        .order('name')
      if (error) throw error
      return data as ClassArm[]
    },
    enabled: !!schoolId
  })

  // ── Data: teachers (optional form teacher assignment) ──
  const { data: teachers = [] } = useQuery({
    queryKey: ['teachers-for-classes', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('role', 'teacher')
        .order('first_name')
      if (error) throw error
      return data as Profile[]
    },
    enabled: !!schoolId
  })

  // ── Data: classes for the selected session, joined for display ──
  const { data: classes = [], isLoading: loadingClasses } = useQuery({
    queryKey: ['classes', schoolId, effectiveSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select(`
          *,
          class_level:class_levels(*),
          class_arm:class_arms(*),
          form_teacher:profiles(*)
        `)
        .eq('school_id', schoolId!)
        .eq('session_id', effectiveSessionId!)
      if (error) throw error
      return data as Class[]
    },
    enabled: !!schoolId && !!effectiveSessionId
  })

  // Batched count of active students per class for this session — one
  // query for every class at once, not one query per row, and keyed by
  // session_id directly so it doesn't wait on the classes query above.
  const { data: studentCounts = {} } = useQuery({
    queryKey: ['classes-student-counts', schoolId, effectiveSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('class_id, student:students(is_active)')
        .eq('school_id', schoolId!)
        .eq('session_id', effectiveSessionId!)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data as unknown as { class_id: string; student: { is_active: boolean } | null }[]) {
        if (row.student?.is_active) counts[row.class_id] = (counts[row.class_id] ?? 0) + 1
      }
      return counts
    },
    enabled: !!schoolId && !!effectiveSessionId
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['class-levels', schoolId] })
    qc.invalidateQueries({ queryKey: ['class-arms', schoolId] })
    qc.invalidateQueries({ queryKey: ['classes', schoolId] })
  }

  // ══════════════════════════════════════════════════════════
  // CLASS LEVELS TAB
  // ══════════════════════════════════════════════════════════
  const [levelDialog, setLevelDialog] = useState<ClassLevel | 'new' | null>(null)
  const [deleteLevel, setDeleteLevel] = useState<ClassLevel | null>(null)
  const levelForm = useForm<LevelForm>({ resolver: zodResolver(levelSchema) })

  const upsertLevel = useMutation({
    mutationFn: async (values: LevelForm) => {
      if (levelDialog === 'new') {
        const { data, error } = await supabase.from('class_levels').insert({
          ...values, school_id: schoolId, order_index: levels.length
        }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (levelDialog && typeof levelDialog === 'object') {
        const { error } = await supabase.from('class_levels').update(values).eq('id', levelDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: levelDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      invalidateAll(); setLevelDialog(null); levelForm.reset(); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'class_level', entityId: result.id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const removeLevel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('class_levels').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidateAll(); setDeleteLevel(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'class_level', entityId: id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('foreign key')
        ? 'This class level is in use by existing classes or subjects — remove those first.'
        : e.message
    )
  })

  // ══════════════════════════════════════════════════════════
  // CLASS ARMS TAB
  // ══════════════════════════════════════════════════════════
  const [armDialog, setArmDialog] = useState<ClassArm | 'new' | null>(null)
  const [deleteArm, setDeleteArm] = useState<ClassArm | null>(null)
  const armForm = useForm<ArmForm>({ resolver: zodResolver(armSchema) })

  const upsertArm = useMutation({
    mutationFn: async (values: ArmForm) => {
      if (armDialog === 'new') {
        const { data, error } = await supabase.from('class_arms').insert({ ...values, school_id: schoolId }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (armDialog && typeof armDialog === 'object') {
        const { error } = await supabase.from('class_arms').update(values).eq('id', armDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: armDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      invalidateAll(); setArmDialog(null); armForm.reset(); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'class_arm', entityId: result.id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const removeArm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('class_arms').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidateAll(); setDeleteArm(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'class_arm', entityId: id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('foreign key')
        ? 'This class arm is in use by existing classes — remove those first.'
        : e.message
    )
  })

  // ══════════════════════════════════════════════════════════
  // CLASSES TAB
  // ══════════════════════════════════════════════════════════
  const [classDialog, setClassDialog] = useState<Class | 'new' | null>(null)
  const [deleteClassTarget, setDeleteClassTarget] = useState<Class | null>(null)

  const classForm = useForm<ClassForm>({
    resolver: zodResolver(classSchema),
    defaultValues: { session_id: effectiveSessionId ?? '', form_teacher_id: NONE_VALUE }
  })

  const openNewClass = () => {
    classForm.reset({
      session_id: effectiveSessionId ?? '',
      class_level_id: '',
      class_arm_id: NONE_VALUE,
      form_teacher_id: NONE_VALUE
    })
    setClassDialog('new')
  }

  const openEditClass = (cls: Class) => {
    classForm.reset({
      session_id: cls.session_id,
      class_level_id: cls.class_level_id,
      class_arm_id: cls.class_arm_id ?? NONE_VALUE,
      form_teacher_id: cls.form_teacher_id ?? NONE_VALUE
    })
    setClassDialog(cls)
  }

  const upsertClass = useMutation({
    mutationFn: async (values: ClassForm) => {
      const payload = {
        session_id: values.session_id,
        class_level_id: values.class_level_id,
        class_arm_id: values.class_arm_id && values.class_arm_id !== NONE_VALUE
          ? values.class_arm_id
          : null,
        form_teacher_id: values.form_teacher_id && values.form_teacher_id !== NONE_VALUE
          ? values.form_teacher_id
          : null
      }

      if (classDialog === 'new') {
        const { data, error } = await supabase.from('classes').insert({ ...payload, school_id: schoolId }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (classDialog && typeof classDialog === 'object') {
        const { error } = await supabase.from('classes').update(payload).eq('id', classDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: classDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      invalidateAll()
      setClassDialog(null)
      toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'class', entityId: result.id })
    },
    onError: (e: Error) => {
      // Postgres unique_violation on (session_id, class_level_id, class_arm_id)
      if (e.message.includes('duplicate key') || e.message.includes('already exists')) {
        toast.error('This exact class already exists for the selected session.')
      } else {
        toast.error(e.message)
      }
    }
  })

  const removeClass = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('classes').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidateAll(); setDeleteClassTarget(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'class', entityId: id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('foreign key')
        ? 'This class has enrolled students or assignments — remove those first.'
        : e.message
    )
  })

  const noPrerequisites = !loadingSessions && !loadingLevels &&
    (sessions.length === 0 || levels.length === 0)

  return (
    <div>
      <PageHeader
        title="Classes"
        description="Manage class levels, arms, and the classes that combine them"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="classes"><GraduationCap className="mr-1.5 h-4 w-4" />Classes</TabsTrigger>
          <TabsTrigger value="levels"><Layers className="mr-1.5 h-4 w-4" />Class Levels</TabsTrigger>
          <TabsTrigger value="arms"><Tag className="mr-1.5 h-4 w-4" />Class Arms</TabsTrigger>
        </TabsList>

        {/* ═══ CLASSES TAB ═══ */}
        <TabsContent value="classes">
          {noPrerequisites ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState
                  icon={<GraduationCap className="h-12 w-12" />}
                  title="Set up prerequisites first"
                  description={
                    sessions.length === 0
                      ? 'You need at least one session before creating classes. Go to Sessions to create one.'
                      : 'You need at least one Class Level before creating classes — use the tab above. Class Arms are optional.'
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Session selector — explicit and always visible, so
                  "which session am I creating this class for" is never
                  a hidden/silent assumption */}
              <Card className="mb-4">
                <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground shrink-0">Session:</span>
                    <Select
                      value={effectiveSessionId ?? undefined}
                      onValueChange={setSelectedSessionId}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder="Select a session" />
                      </SelectTrigger>
                      <SelectContent>
                        {sessions.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{s.is_current ? ' (Current)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <ViewToggle value={view} onChange={setView} />
                    <Button onClick={openNewClass}>
                      <Plus className="mr-2 h-4 w-4" />Create Class
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  {loadingClasses ? (
                    <div className="flex justify-center py-16"><Spinner size="lg" /></div>
                  ) : classes.length === 0 ? (
                    <EmptyState
                      icon={<GraduationCap className="h-12 w-12" />}
                      title="No classes yet for this session"
                      description="Combine a class level and arm to create your first class."
                      action={<Button onClick={openNewClass}><Plus className="mr-2 h-4 w-4" />Create Class</Button>}
                    />
                  ) : view === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                      {classes.map(cls => (
                        <div key={cls.id} className="rounded-lg border p-4 flex flex-col gap-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-md bg-brand-100 flex items-center justify-center shrink-0">
                                <GraduationCap className="h-4 w-4 text-brand-700" />
                              </div>
                              <Link to={`/school/classes/${cls.id}`} className="font-medium text-sm hover:underline hover:text-primary">
                                {cls.class_level?.name}{cls.class_arm ? ` ${cls.class_arm.name}` : ''}
                              </Link>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${cls.class_level?.name}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`}><MoreVertical className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditClass(cls)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteClassTarget(cls)} className="text-destructive">
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {cls.form_teacher
                            ? <p className="text-xs text-muted-foreground">{cls.form_teacher.first_name} {cls.form_teacher.last_name}</p>
                            : <Badge variant="outline" className="text-xs w-fit">Unassigned</Badge>
                          }
                          <p className="text-xs text-muted-foreground">
                            {studentCounts[cls.id] ?? 0} student{(studentCounts[cls.id] ?? 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Class</TableHead>
                          <TableHead className="hidden sm:table-cell">Form Teacher</TableHead>
                          <TableHead className="hidden sm:table-cell w-24">Students</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {classes.map(cls => (
                          <TableRow key={cls.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-md bg-brand-100 flex items-center justify-center shrink-0">
                                  <GraduationCap className="h-4 w-4 text-brand-700" />
                                </div>
                                <Link to={`/school/classes/${cls.id}`} className="font-medium text-sm hover:underline hover:text-primary">
                                  {cls.class_level?.name}{cls.class_arm ? ` ${cls.class_arm.name}` : ''}
                                </Link>
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                              {cls.form_teacher
                                ? `${cls.form_teacher.first_name} ${cls.form_teacher.last_name}`
                                : <Badge variant="outline" className="text-xs">Unassigned</Badge>
                              }
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                              {studentCounts[cls.id] ?? 0}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${cls.class_level?.name}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`}>
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditClass(cls)}>
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => setDeleteClassTarget(cls)} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ═══ CLASS LEVELS TAB ═══ */}
        <TabsContent value="levels">
          <div className="flex justify-end mb-4">
            <Button onClick={() => { levelForm.reset(); setLevelDialog('new') }}>
              <Plus className="mr-2 h-4 w-4" />Add Class Level
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingLevels ? (
                <div className="flex justify-center py-16"><Spinner size="lg" /></div>
              ) : levels.length === 0 ? (
                <EmptyState
                  icon={<Layers className="h-12 w-12" />}
                  title="No class levels yet"
                  description="e.g. JSS1, Year 7, Grade 9"
                  action={<Button onClick={() => { levelForm.reset(); setLevelDialog('new') }}><Plus className="mr-2 h-4 w-4" />Add Class Level</Button>}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead className="w-10" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {levels.map(level => (
                      <TableRow key={level.id}>
                        <TableCell className="font-medium text-sm">{level.name}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${level.name}`}><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { levelForm.setValue('name', level.name); setLevelDialog(level) }}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteLevel(level)} className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ CLASS ARMS TAB ═══ */}
        <TabsContent value="arms">
          <div className="flex justify-end mb-4">
            <Button onClick={() => { armForm.reset(); setArmDialog('new') }}>
              <Plus className="mr-2 h-4 w-4" />Add Class Arm
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingArms ? (
                <div className="flex justify-center py-16"><Spinner size="lg" /></div>
              ) : arms.length === 0 ? (
                <EmptyState
                  icon={<Tag className="h-12 w-12" />}
                  title="No class arms yet"
                  description="Optional — only add these if your school streams classes, e.g. A, B, Science, Arts"
                  action={<Button onClick={() => { armForm.reset(); setArmDialog('new') }}><Plus className="mr-2 h-4 w-4" />Add Class Arm</Button>}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead className="w-10" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {arms.map(arm => (
                      <TableRow key={arm.id}>
                        <TableCell className="font-medium text-sm">{arm.name}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${arm.name}`}><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { armForm.setValue('name', arm.name); setArmDialog(arm) }}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteArm(arm)} className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Class Level Dialog ── */}
      <Dialog open={!!levelDialog} onOpenChange={o => !o && setLevelDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{levelDialog === 'new' ? 'Add Class Level' : 'Edit Class Level'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={levelForm.handleSubmit(v => upsertLevel.mutate(v))} className="space-y-4">
            <FormField label="Name" error={levelForm.formState.errors.name?.message} required htmlFor="levelName">
              <Input id="levelName" placeholder="e.g. JSS1, Year 7" {...levelForm.register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLevelDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertLevel.isPending}>
                {upsertLevel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Class Arm Dialog ── */}
      <Dialog open={!!armDialog} onOpenChange={o => !o && setArmDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{armDialog === 'new' ? 'Add Class Arm' : 'Edit Class Arm'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={armForm.handleSubmit(v => upsertArm.mutate(v))} className="space-y-4">
            <FormField label="Name" error={armForm.formState.errors.name?.message} required htmlFor="armName">
              <Input id="armName" placeholder="e.g. A, Science" {...armForm.register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setArmDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertArm.isPending}>
                {upsertArm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Class Dialog (the one that was broken) ── */}
      <Dialog open={!!classDialog} onOpenChange={o => !o && setClassDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{classDialog === 'new' ? 'Create Class' : 'Edit Class'}</DialogTitle>
            <DialogDescription>Combine a class level and arm within a session</DialogDescription>
          </DialogHeader>
          <form onSubmit={classForm.handleSubmit(v => upsertClass.mutate(v))} className="space-y-4">
            <FormField label="Session" error={classForm.formState.errors.session_id?.message} required htmlFor="classSession">
              <Select
                value={classForm.watch('session_id')}
                onValueChange={v => classForm.setValue('session_id', v, { shouldValidate: true })}
              >
                <SelectTrigger id="classSession"><SelectValue placeholder="Select a session" /></SelectTrigger>
                <SelectContent>
                  {sessions.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.is_current ? ' (Current)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Class Level" error={classForm.formState.errors.class_level_id?.message} required htmlFor="classLevel">
              <Select
                value={classForm.watch('class_level_id')}
                onValueChange={v => classForm.setValue('class_level_id', v, { shouldValidate: true })}
              >
                <SelectTrigger id="classLevel"><SelectValue placeholder="Select a class level" /></SelectTrigger>
                <SelectContent>
                  {levels.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Class Arm" hint="Optional — leave as &quot;No Arm&quot; if this school doesn't stream this level" htmlFor="classArm">
              <Select
                value={classForm.watch('class_arm_id') ?? NONE_VALUE}
                onValueChange={v => classForm.setValue('class_arm_id', v, { shouldValidate: true })}
              >
                <SelectTrigger id="classArm"><SelectValue placeholder="No Arm" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>No Arm (whole level)</SelectItem>
                  {arms.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Form Teacher" hint="Optional — can be assigned later" htmlFor="classFormTeacher">
              <Select
                value={classForm.watch('form_teacher_id') ?? NONE_VALUE}
                onValueChange={v => classForm.setValue('form_teacher_id', v)}
              >
                <SelectTrigger id="classFormTeacher"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>None</SelectItem>
                  {teachers.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClassDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertClass.isPending}>
                {upsertClass.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmations ── */}
      <AlertDialog open={!!deleteLevel} onOpenChange={o => !o && setDeleteLevel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteLevel?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteLevel && removeLevel.mutate(deleteLevel.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteArm} onOpenChange={o => !o && setDeleteArm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteArm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteArm && removeArm.mutate(deleteArm.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteClassTarget} onOpenChange={o => !o && setDeleteClassTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteClassTarget?.class_level?.name}{deleteClassTarget?.class_arm ? ` ${deleteClassTarget.class_arm.name}` : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteClassTarget && removeClass.mutate(deleteClassTarget.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
