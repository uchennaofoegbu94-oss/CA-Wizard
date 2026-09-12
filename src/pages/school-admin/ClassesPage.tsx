import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pencil, Trash2, MoreVertical, GraduationCap, Layers, Tag, FolderTree } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { groupBySection } from '@/lib/sections'
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import toast from 'react-hot-toast'
import type { Class, ClassLevel, ClassArm, Session, Profile, SchoolSection } from '@/types'

// ─── Schemas ────────────────────────────────────────────────

const sectionSchema = z.object({ name: z.string().min(1, 'Required') })
// section_id is optional — sections are fully opt-in (see migration
// 047's comment). A school that never creates any sections just
// never sees this field do anything, and every class level keeps
// working exactly as it did before this feature existed.
const levelSchema = z.object({ name: z.string().min(1, 'Required'), section_id: z.string().optional() })
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

type SectionForm = z.infer<typeof sectionSchema>
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

  // ── Data: school sections (optional grouping above class levels) ──
  const { data: sections = [], isLoading: loadingSections } = useQuery({
    queryKey: ['school-sections', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_sections')
        .select('*')
        .eq('school_id', schoolId!)
        .order('order_index')
      if (error) throw error
      return data as SchoolSection[]
    },
    enabled: !!schoolId
  })

  // ── Data: class levels & arms ──
  const { data: levels = [], isLoading: loadingLevels } = useQuery({
    queryKey: ['class-levels', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_levels')
        .select('*, section:school_sections(*)')
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
    qc.invalidateQueries({ queryKey: ['school-sections', schoolId] })
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
      const payload = {
        name: values.name,
        section_id: values.section_id && values.section_id !== NONE_VALUE ? values.section_id : null
      }
      if (levelDialog === 'new') {
        const { data, error } = await supabase.from('class_levels').insert({
          ...payload, school_id: schoolId, order_index: levels.length
        }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (levelDialog && typeof levelDialog === 'object') {
        const { error } = await supabase.from('class_levels').update(payload).eq('id', levelDialog.id)
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
  // SECTIONS TAB — optional grouping above class levels (Early
  // Years / Basic School / High School / Sixth Form, or whatever a
  // school calls its own tiers). Purely organizational: a school
  // that never creates one keeps seeing every class level in one
  // flat, ungrouped list, exactly as before this feature existed.
  // ══════════════════════════════════════════════════════════
  const [sectionDialog, setSectionDialog] = useState<SchoolSection | 'new' | null>(null)
  const [deleteSection, setDeleteSection] = useState<SchoolSection | null>(null)
  const sectionForm = useForm<SectionForm>({ resolver: zodResolver(sectionSchema) })

  const upsertSection = useMutation({
    mutationFn: async (values: SectionForm) => {
      if (sectionDialog === 'new') {
        const { data, error } = await supabase.from('school_sections').insert({
          ...values, school_id: schoolId, order_index: sections.length
        }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (sectionDialog && typeof sectionDialog === 'object') {
        const { error } = await supabase.from('school_sections').update(values).eq('id', sectionDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: sectionDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      invalidateAll(); setSectionDialog(null); sectionForm.reset(); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'school_section', entityId: result.id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const removeSection = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('school_sections').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      // Deleting a section never deletes or breaks the class levels
      // under it (migration 047: ON DELETE SET NULL) — they simply
      // fall back to ungrouped, same as a level that was never
      // assigned a section in the first place.
      invalidateAll(); setDeleteSection(null); toast.success('Section deleted — its class levels are now ungrouped, not removed')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'school_section', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
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
          <TabsTrigger value="sections"><FolderTree className="mr-1.5 h-4 w-4" />Sections</TabsTrigger>
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
                    <div className="p-4 space-y-6">
                      {groupBySection(classes, c => c.class_level, sections).map(group => (
                        <div key={group.section?.id ?? 'ungrouped'}>
                          {sections.length > 0 && (
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                              {group.section?.name ?? 'Ungrouped'}
                            </h3>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.items.map(cls => (
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
                        {groupBySection(classes, c => c.class_level, sections).map(group => (
                          <Fragment key={group.section?.id ?? 'ungrouped'}>
                            {sections.length > 0 && (
                              <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableCell colSpan={4} className="py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {group.section?.name ?? 'Ungrouped'}
                                </TableCell>
                              </TableRow>
                            )}
                            {group.items.map(cls => (
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
                          </Fragment>
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
            <Button onClick={() => { levelForm.reset({ name: '', section_id: NONE_VALUE }); setLevelDialog('new') }}>
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
                  action={<Button onClick={() => { levelForm.reset({ name: '', section_id: NONE_VALUE }); setLevelDialog('new') }}><Plus className="mr-2 h-4 w-4" />Add Class Level</Button>}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead className="w-10" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupBySection(levels, l => l, sections).map(group => (
                      <Fragment key={group.section?.id ?? 'ungrouped'}>
                        {/* Only shown once this school actually has sections —
                            a school with zero sections gets exactly one group
                            (section: null) and this header never renders,
                            leaving the table identical to before this feature
                            existed. */}
                        {sections.length > 0 && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={2} className="py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {group.section?.name ?? 'Ungrouped'}
                            </TableCell>
                          </TableRow>
                        )}
                        {group.items.map(level => (
                          <TableRow key={level.id}>
                            <TableCell className="font-medium text-sm">{level.name}</TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${level.name}`}><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => { levelForm.reset({ name: level.name, section_id: level.section_id ?? NONE_VALUE }); setLevelDialog(level) }}>
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
                      </Fragment>
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

        {/* ═══ SECTIONS TAB ═══ */}
        <TabsContent value="sections">
          <div className="flex justify-end mb-4">
            <Button onClick={() => { sectionForm.reset(); setSectionDialog('new') }}>
              <Plus className="mr-2 h-4 w-4" />Add Section
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingSections ? (
                <div className="flex justify-center py-16"><Spinner size="lg" /></div>
              ) : sections.length === 0 ? (
                <EmptyState
                  icon={<FolderTree className="h-12 w-12" />}
                  title="No sections yet"
                  description="Fully optional — group your class levels under broader tiers like Early Years, Basic School, High School, or Sixth Form. Skip this entirely if your school doesn't need it."
                  action={<Button onClick={() => { sectionForm.reset(); setSectionDialog('new') }}><Plus className="mr-2 h-4 w-4" />Add Section</Button>}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead className="w-10" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.map(section => (
                      <TableRow key={section.id}>
                        <TableCell className="font-medium text-sm">{section.name}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${section.name}`}><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { sectionForm.setValue('name', section.name); setSectionDialog(section) }}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteSection(section)} className="text-destructive">
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
            {sections.length > 0 && (
              <FormField label="Section" hint="Optional — leave as &quot;No Section&quot; if this level doesn't belong under one" htmlFor="levelSection">
                <Select
                  value={levelForm.watch('section_id') ?? NONE_VALUE}
                  onValueChange={v => levelForm.setValue('section_id', v)}
                >
                  <SelectTrigger id="levelSection"><SelectValue placeholder="No Section" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>No Section</SelectItem>
                    {sections.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            )}
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

      {/* ── Section Dialog ── */}
      <Dialog open={!!sectionDialog} onOpenChange={o => !o && setSectionDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{sectionDialog === 'new' ? 'Add Section' : 'Edit Section'}</DialogTitle>
            <DialogDescription>Groups class levels under a broader tier — e.g. Early Years, Basic School, High School, Sixth Form</DialogDescription>
          </DialogHeader>
          <form onSubmit={sectionForm.handleSubmit(v => upsertSection.mutate(v))} className="space-y-4">
            <FormField label="Name" error={sectionForm.formState.errors.name?.message} required htmlFor="sectionName">
              <Input id="sectionName" placeholder="e.g. Basic School, High School" {...sectionForm.register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSectionDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertSection.isPending}>
                {upsertSection.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
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
                  {sections.length > 0 ? (
                    groupBySection(levels, l => l, sections).map(group => (
                      <SelectGroup key={group.section?.id ?? 'ungrouped'}>
                        <SelectLabel>{group.section?.name ?? 'Ungrouped'}</SelectLabel>
                        {group.items.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectGroup>
                    ))
                  ) : (
                    levels.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)
                  )}
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

      <AlertDialog open={!!deleteSection} onOpenChange={o => !o && setDeleteSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteSection?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Class levels currently grouped under this section are NOT deleted — they simply become ungrouped, same as a level that was never assigned a section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteSection && removeSection.mutate(deleteSection.id)}>Delete</AlertDialogAction>
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
