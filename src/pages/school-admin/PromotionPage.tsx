import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, GraduationCap, Loader2, Plus, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import type { Session, Class, ClassLevel, ClassArm, StudentEnrollment } from '@/types'

const NONE_VALUE = '__none__'
const NEW_CLASS_VALUE = '__new__'

export default function PromotionPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()

  const [sourceClassId, setSourceClassId] = useState('')
  const [targetSessionId, setTargetSessionId] = useState('')
  const [targetClassId, setTargetClassId] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Individual selection, wired alongside the "promote all" engine rather
  // than replacing it: an empty selection means "act on the whole
  // roster" (existing behavior, unchanged); a non-empty selection means
  // "act on just these students". Same table, same button, same
  // confirmation flow either way.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // New-class inline form state (shown when "+ Create New Class" is picked)
  const [newClassLevelId, setNewClassLevelId] = useState('')
  const [newClassArmId, setNewClassArmId] = useState(NONE_VALUE)
  const [creatingClass, setCreatingClass] = useState(false)

  const resetForm = () => {
    setSourceClassId('')
    setTargetSessionId('')
    setTargetClassId('')
    setSelectedIds(new Set())
    setCreatingClass(false)
    setNewClassLevelId('')
    setNewClassArmId(NONE_VALUE)
  }

  const { data: sessions = [] } = useQuery({
    queryKey: ['promotion-sessions', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).order('start_year', { ascending: false })
      if (error) throw error
      return data as Session[]
    },
    enabled: !!schoolId
  })

  const { data: levels = [] } = useQuery({
    queryKey: ['promotion-levels', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('class_levels').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as ClassLevel[]
    },
    enabled: !!schoolId
  })

  const { data: arms = [] } = useQuery({
    queryKey: ['promotion-arms', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('class_arms').select('*').eq('school_id', schoolId!).order('name')
      if (error) throw error
      return data as ClassArm[]
    },
    enabled: !!schoolId
  })

  const { data: allClasses = [] } = useQuery({
    queryKey: ['promotion-all-classes', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*, class_level:class_levels(*), class_arm:class_arms(*), session:sessions(*)')
        .eq('school_id', schoolId!)
      if (error) throw error
      return data as Class[]
    },
    enabled: !!schoolId
  })

  const sourceClass = allClasses.find(c => c.id === sourceClassId)

  const isHighestLevel = useMemo(() => {
    if (!sourceClass || levels.length === 0) return false
    const maxOrder = Math.max(...levels.map(l => l.order_index))
    const sourceLevel = levels.find(l => l.id === sourceClass.class_level_id)
    return sourceLevel?.order_index === maxOrder
  }, [sourceClass, levels])

  const suggestedNextLevelId = useMemo(() => {
    if (!sourceClass) return ''
    const sourceLevel = levels.find(l => l.id === sourceClass.class_level_id)
    if (!sourceLevel) return ''
    const next = levels.find(l => l.order_index === sourceLevel.order_index + 1)
    return next?.id ?? ''
  }, [sourceClass, levels])

  // Classes that already exist in the chosen target session — this is
  // the entire fix: instead of reconstructing a level+arm match (which
  // silently fails if the admin picked a different arm than what was
  // actually created), pick directly from what's really there.
  const classesInTargetSession = useMemo(() =>
    allClasses.filter(c => c.session_id === targetSessionId),
    [allClasses, targetSessionId]
  )

  const classLabel = (cls?: Class | null) =>
    cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  const { data: enrollments = [], isLoading: loadingRoster } = useQuery({
    queryKey: ['promotion-roster', sourceClassId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*, student:students(*)').eq('class_id', sourceClassId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student?.status === 'active')
    },
    enabled: !!sourceClassId
  })

  const roster = enrollments.map(e => e.student!).filter(Boolean)
  const affected = selectedIds.size > 0 ? roster.filter(s => selectedIds.has(s.id)) : roster

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === roster.length ? new Set() : new Set(roster.map(s => s.id)))
  }

  const createTargetClass = useMutation({
    mutationFn: async () => {
      if (!newClassLevelId) throw new Error('Pick a class level')
      const { data, error } = await supabase.from('classes').insert({
        school_id: schoolId,
        session_id: targetSessionId,
        class_level_id: newClassLevelId,
        class_arm_id: newClassArmId !== NONE_VALUE ? newClassArmId : null
      }).select().single()
      if (error) throw error
      return data as Class
    },
    onSuccess: (newClass) => {
      qc.invalidateQueries({ queryKey: ['promotion-all-classes', schoolId] })
      setTargetClassId(newClass.id)
      toast.success('Class created')
      setCreatingClass(false)
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'class', entityId: newClass.id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'That exact class already exists for this session.' : e.message
    )
  })

  const runPromotion = useMutation({
    mutationFn: async () => {
      if (isHighestLevel) {
        const ids = affected.map(s => s.id)
        const { error } = await supabase.from('students').update({ status: 'graduated' }).in('id', ids)
        if (error) throw error
        await logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'PROMOTE', entityType: 'student_graduation', newValue: { count: ids.length } })
        return { graduated: true, count: ids.length }
      }

      const targetClass = allClasses.find(c => c.id === targetClassId)
      if (!targetClass) throw new Error('Select a target class first.')

      const existing = await supabase.from('student_enrollments').select('student_id').eq('class_id', targetClass.id)
      const alreadyEnrolled = new Set((existing.data ?? []).map(e => e.student_id))
      const toEnroll = affected.filter(s => !alreadyEnrolled.has(s.id))

      if (toEnroll.length === 0) return { graduated: false, count: 0 }

      const { error } = await supabase.from('student_enrollments').insert(
        toEnroll.map(s => ({ school_id: schoolId, student_id: s.id, class_id: targetClass.id, session_id: targetSessionId }))
      )
      if (error) throw error

      await logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'PROMOTE', entityType: 'student_promotion', newValue: { count: toEnroll.length } })
      return { graduated: false, count: toEnroll.length }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['promotion-roster'] })
      setConfirmOpen(false)
      if (result.graduated) toast.success(`${result.count} student${result.count !== 1 ? 's' : ''} graduated`)
      else if (result.count === 0) toast('Everyone selected was already promoted', { icon: 'ℹ️' })
      else toast.success(`${result.count} student${result.count !== 1 ? 's' : ''} promoted`)
      // Clear the whole form on success so the next promotion run starts
      // fresh. Deliberately NOT done in onError below — a failed attempt
      // should leave every field exactly as the admin set it up, so they
      // can fix whatever went wrong and retry without re-selecting
      // the class, target, and student list from scratch.
      resetForm()
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const canProceed = !!sourceClassId && affected.length > 0 && (isHighestLevel || (!!targetSessionId && !!targetClassId))

  return (
    <div>
      <PageHeader
        title="Promotion & Graduation"
        description="Move an entire class up to the next level for a new session, or graduate your final-year students"
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 space-y-4">
          <div>
            <p className="text-sm font-medium mb-1.5">1. Source Class (who's being promoted)</p>
            <Select value={sourceClassId} onValueChange={v => { setSourceClassId(v); setTargetClassId(''); setCreatingClass(false); setSelectedIds(new Set()) }}>
              <SelectTrigger className="max-w-md"><SelectValue placeholder="Select a class" /></SelectTrigger>
              <SelectContent>
                {allClasses.map(cls => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {classLabel(cls)}{cls.session ? ` (${cls.session.name})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sourceClassId && isHighestLevel && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 flex items-center gap-2 text-sm text-brand-900">
              <GraduationCap className="h-4 w-4 shrink-0" />
              This is your school's final class level — students here will be marked as <strong>Graduated</strong> instead of promoted to a new class.
            </div>
          )}

          {sourceClassId && !isHighestLevel && (
            <div>
              <p className="text-sm font-medium mb-1.5">2. Target Session &amp; Class</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={targetSessionId} onValueChange={v => { setTargetSessionId(v); setTargetClassId(''); setCreatingClass(false) }}>
                  <SelectTrigger className="sm:w-52"><SelectValue placeholder="Session" /></SelectTrigger>
                  <SelectContent>
                    {sessions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Select
                  value={creatingClass ? NEW_CLASS_VALUE : targetClassId}
                  onValueChange={v => {
                    if (v === NEW_CLASS_VALUE) {
                      setCreatingClass(true)
                      setNewClassLevelId(suggestedNextLevelId)
                      setNewClassArmId(NONE_VALUE)
                    } else {
                      setCreatingClass(false)
                      setTargetClassId(v)
                    }
                  }}
                  disabled={!targetSessionId}
                >
                  <SelectTrigger className="sm:w-64"><SelectValue placeholder="Target class" /></SelectTrigger>
                  <SelectContent>
                    {classesInTargetSession.map(cls => (
                      <SelectItem key={cls.id} value={cls.id}>{classLabel(cls)}</SelectItem>
                    ))}
                    <SelectItem value={NEW_CLASS_VALUE}>
                      <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Create New Class…</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {targetSessionId && classesInTargetSession.length === 0 && !creatingClass && (
                <p className="text-xs text-muted-foreground mt-2">
                  No classes exist yet for this session — pick "Create New Class…" above to make one on the spot.
                </p>
              )}

              {creatingClass && (
                <div className="mt-3 rounded-lg border p-3 space-y-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground">New class for {sessions.find(s => s.id === targetSessionId)?.name}</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Select value={newClassLevelId} onValueChange={setNewClassLevelId}>
                      <SelectTrigger className="sm:w-48"><SelectValue placeholder="Class Level" /></SelectTrigger>
                      <SelectContent>
                        {levels.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={newClassArmId} onValueChange={setNewClassArmId}>
                      <SelectTrigger className="sm:w-48"><SelectValue placeholder="Class Arm" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>No Arm</SelectItem>
                        {arms.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => createTargetClass.mutate()} disabled={!newClassLevelId || createTargetClass.isPending}>
                      {createTargetClass.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!sourceClassId ? (
        <EmptyState icon={<Users className="h-12 w-12" />} title="Select a source class to begin" />
      ) : loadingRoster ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : roster.length === 0 ? (
        <EmptyState title="No active students in this class" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-4 border-b">
              <p className="text-sm font-medium">
                {selectedIds.size > 0
                  ? `${selectedIds.size} of ${roster.length} student${roster.length !== 1 ? 's' : ''} selected`
                  : `${roster.length} student${roster.length !== 1 ? 's' : ''} will be affected`}
              </p>
              <Button onClick={() => setConfirmOpen(true)} disabled={!canProceed}>
                {isHighestLevel
                  ? <><GraduationCap className="mr-2 h-4 w-4" />{selectedIds.size > 0 ? `Graduate Selected (${selectedIds.size})` : 'Graduate All'}</>
                  : <><ArrowRight className="mr-2 h-4 w-4" />{selectedIds.size > 0 ? `Promote Selected (${selectedIds.size})` : 'Promote All'}</>
                }
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={roster.length > 0 && selectedIds.size === roster.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all students"
                    />
                  </TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Adm. No.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map(s => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => toggleSelected(s.id)}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(s.id)}
                        onCheckedChange={() => toggleSelected(s.id)}
                        aria-label={`Select ${s.first_name} ${s.last_name}`}
                      />
                    </TableCell>
                    <TableCell className="text-sm font-medium">{s.last_name}, {s.first_name}</TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">{s.admission_number}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isHighestLevel ? 'Confirm Graduation' : 'Confirm Promotion'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isHighestLevel
                ? `${affected.length} student${affected.length !== 1 ? 's' : ''} will be marked as Graduated and removed from the active roster.`
                : `${affected.length} student${affected.length !== 1 ? 's' : ''} will be enrolled in ${classLabel(allClasses.find(c => c.id === targetClassId))}. They'll keep their existing records — this only adds a new enrollment.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => runPromotion.mutate()} disabled={runPromotion.isPending}>
              {runPromotion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
