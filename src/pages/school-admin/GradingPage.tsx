import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pencil, Trash2, MoreVertical, Star } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { gradingSystemLimit, tierLabel } from '@/lib/tierLimits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { GradingSystem, GradeRange } from '@/types'

// ─── Schemas ────────────────────────────────────────────────

const systemSchema = z.object({ name: z.string().min(1, 'Required') })
const rangeSchema = z.object({
  grade:     z.string().min(1, 'Required').max(4),
  min_score: z.coerce.number().min(0).max(100),
  max_score: z.coerce.number().min(0).max(100),
  remark:    z.string().optional()
}).refine(d => d.max_score >= d.min_score, {
  message: 'Max must be ≥ min', path: ['max_score']
})

type SystemForm = z.infer<typeof systemSchema>
type RangeForm  = z.infer<typeof rangeSchema>

export default function GradingPage() {
  const { schoolId, profile, subscriptionTier } = useAuth()
  const qc = useQueryClient()
  const [activeSystem, setActiveSystem] = useState<string | null>(null)
  const [systemDialog, setSystemDialog] = useState<GradingSystem | 'new' | null>(null)
  const [rangeDialog, setRangeDialog]   = useState<GradeRange | 'new' | null>(null)
  const [deleteSystem, setDeleteSystem] = useState<GradingSystem | null>(null)
  const [deleteRange, setDeleteRange]   = useState<GradeRange | null>(null)

  const inv = () => {
    qc.invalidateQueries({ queryKey: ['grading-systems', schoolId] })
    qc.invalidateQueries({ queryKey: ['grade-ranges', schoolId] })
  }

  const { data: systems = [], isLoading: loadingSystems } = useQuery({
    queryKey: ['grading-systems', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('grading_systems')
        .select('*').eq('school_id', schoolId!).order('name')
      if (error) throw error
      return data as GradingSystem[]
    },
    enabled: !!schoolId
  })

  const { data: ranges = [], isLoading: loadingRanges } = useQuery({
    queryKey: ['grade-ranges', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('grade_ranges')
        .select('*').eq('school_id', schoolId!).order('min_score', { ascending: false })
      if (error) throw error
      return data as GradeRange[]
    },
    enabled: !!schoolId
  })

  // Auto-select first system
  const selectedSystemId = activeSystem ?? systems[0]?.id ?? null
  const selectedSystem   = systems.find(s => s.id === selectedSystemId)
  const systemRanges     = ranges.filter(r => r.grading_system_id === selectedSystemId)

  const systemForm = useForm<SystemForm>({ resolver: zodResolver(systemSchema) })
  const rangeForm  = useForm<RangeForm>({ resolver: zodResolver(rangeSchema) })

  // System CRUD
  const upsertSystem = useMutation({
    mutationFn: async (values: SystemForm) => {
      if (systemDialog === 'new') {
        // A school's FIRST grading system auto-becomes the default —
        // without this, is_default stays false until an admin finds
        // the "Set Default" action in the ⋮ menu, which is easy to
        // never notice when there's only one system to begin with.
        // Every report card page filters on is_default=true, so an
        // unmarked-default system silently means every grade/remark
        // renders as "—" indefinitely, with no error to surface it.
        const isFirstSystem = systems.length === 0
        const { data, error } = await supabase.from('grading_systems')
          .insert({ ...values, school_id: schoolId, is_default: isFirstSystem }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (systemDialog && typeof systemDialog === 'object') {
        const { error } = await supabase.from('grading_systems')
          .update(values).eq('id', systemDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: systemDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      inv(); setSystemDialog(null); systemForm.reset(); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'grading_system', entityId: result.id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const removeSystem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grading_systems').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      inv(); setDeleteSystem(null); setActiveSystem(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'grading_system', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('grading_systems').update({ is_default: false }).eq('school_id', schoolId!)
      const { error } = await supabase.from('grading_systems').update({ is_default: true }).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      inv(); toast.success('Default grading system updated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'grading_system', entityId: id, newValue: { is_default: true } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Range CRUD
  const upsertRange = useMutation({
    mutationFn: async (values: RangeForm) => {
      if (rangeDialog === 'new') {
        const { data, error } = await supabase.from('grade_ranges')
          .insert({ ...values, school_id: schoolId, grading_system_id: selectedSystemId }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id }
      } else if (rangeDialog && typeof rangeDialog === 'object') {
        const { error } = await supabase.from('grade_ranges').update(values).eq('id', rangeDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: rangeDialog.id }
      }
      return null
    },
    onSuccess: (result) => {
      inv(); setRangeDialog(null); rangeForm.reset(); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'grade_range', entityId: result.id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const removeRange = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grade_ranges').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      inv(); setDeleteRange(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'grade_range', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const openNewSystem = () => { systemForm.reset(); setSystemDialog('new') }
  const openEditSystem = (s: GradingSystem) => { systemForm.setValue('name', s.name); setSystemDialog(s) }
  const openNewRange  = () => { rangeForm.reset(); setRangeDialog('new') }
  const openEditRange = (r: GradeRange) => {
    rangeForm.reset({ grade: r.grade, min_score: r.min_score, max_score: r.max_score, remark: r.remark ?? '' })
    setRangeDialog(r)
  }

  return (
    <div>
      {(() => {
        const cap = gradingSystemLimit(subscriptionTier)
        const atCap = cap !== null && systems.length >= cap
        return (
          <PageHeader
            title="Grading System"
            description="Define grade boundaries and remarks for report cards"
            action={
              <Button onClick={openNewSystem} disabled={atCap} title={atCap ? `Custom grading scales require the Professional plan (currently ${tierLabel(subscriptionTier ?? 'free')})` : undefined}>
                <Plus className="mr-2 h-4 w-4" />New System
              </Button>
            }
          />
        )
      })()}

      {loadingSystems ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : systems.length === 0 ? (
        <EmptyState
          icon={<Star className="h-12 w-12" />}
          title="No grading system yet"
          description="Create a grading system and define your grade boundaries (A, B, C…)"
          action={<Button onClick={openNewSystem}><Plus className="mr-2 h-4 w-4" />New System</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* System selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Systems</p>
            {systems.map(system => (
              <div
                key={system.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveSystem(system.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSystem(system.id) } }}
                className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                  system.id === selectedSystemId
                    ? 'bg-primary/10 border-primary/50 text-foreground font-medium'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{system.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {system.is_default && <Badge variant="default" className="text-xs">Default</Badge>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`More actions for ${system.name}`}
                          className="p-0.5 rounded hover:bg-muted-foreground/20"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditSystem(system)}>
                          <Pencil className="mr-2 h-4 w-4" />Edit
                        </DropdownMenuItem>
                        {!system.is_default && (
                          <DropdownMenuItem onClick={() => setDefault.mutate(system.id)}>
                            <Star className="mr-2 h-4 w-4" />Set Default
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleteSystem(system)} className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Grade ranges */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base">
                    {selectedSystem?.name ?? 'Select a system'}
                  </CardTitle>
                  <CardDescription>{systemRanges.length} grade{systemRanges.length !== 1 ? 's' : ''} defined</CardDescription>
                </div>
                {selectedSystemId && (
                  <Button size="sm" onClick={openNewRange}>
                    <Plus className="mr-2 h-3.5 w-3.5" />Add Grade
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loadingRanges ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : systemRanges.length === 0 ? (
                  <EmptyState
                    title="No grades defined"
                    description="Add grade boundaries like A (75–100), B (65–74)…"
                    action={<Button size="sm" onClick={openNewRange}><Plus className="mr-2 h-3.5 w-3.5" />Add Grade</Button>}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grade</TableHead>
                        <TableHead>Min</TableHead>
                        <TableHead>Max</TableHead>
                        <TableHead>Remark</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {systemRanges.map(range => (
                        <TableRow key={range.id}>
                          <TableCell>
                            <Badge variant="outline" className="font-bold text-sm">{range.grade}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{range.min_score}</TableCell>
                          <TableCell className="font-mono text-sm">{range.max_score}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{range.remark ?? '—'}</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for grade ${range.grade}`}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditRange(range)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteRange(range)} className="text-destructive">
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
          </div>
        </div>
      )}

      {/* System Dialog */}
      <Dialog open={!!systemDialog} onOpenChange={o => !o && setSystemDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{systemDialog === 'new' ? 'New Grading System' : 'Edit Grading System'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={systemForm.handleSubmit(v => upsertSystem.mutate(v))} className="space-y-4">
            <FormField label="System Name" error={systemForm.formState.errors.name?.message} required htmlFor="gsname">
              <Input id="gsname" placeholder="e.g. Standard, WAEC Scale" {...systemForm.register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSystemDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertSystem.isPending}>
                {upsertSystem.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Range Dialog */}
      <Dialog open={!!rangeDialog} onOpenChange={o => !o && setRangeDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{rangeDialog === 'new' ? 'Add Grade' : 'Edit Grade'}</DialogTitle>
            <DialogDescription>Define the score range for this grade</DialogDescription>
          </DialogHeader>
          <form onSubmit={rangeForm.handleSubmit(v => upsertRange.mutate(v))} className="space-y-4">
            <FormField label="Grade" error={rangeForm.formState.errors.grade?.message} required htmlFor="grade">
              <Input id="grade" placeholder="A" className="uppercase w-20" maxLength={4} {...rangeForm.register('grade')} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Min Score" error={rangeForm.formState.errors.min_score?.message} required htmlFor="gmin">
                <Input id="gmin" type="number" min="0" max="100" {...rangeForm.register('min_score')} />
              </FormField>
              <FormField label="Max Score" error={rangeForm.formState.errors.max_score?.message} required htmlFor="gmax">
                <Input id="gmax" type="number" min="0" max="100" {...rangeForm.register('max_score')} />
              </FormField>
            </FormGrid>
            <FormField label="Remark" htmlFor="gremark">
              <Input id="gremark" placeholder="Excellent" {...rangeForm.register('remark')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRangeDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertRange.isPending}>
                {upsertRange.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete System */}
      <AlertDialog open={!!deleteSystem} onOpenChange={o => !o && setDeleteSystem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteSystem?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This also deletes all grade ranges in this system.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteSystem && removeSystem.mutate(deleteSystem.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Range */}
      <AlertDialog open={!!deleteRange} onOpenChange={o => !o && setDeleteRange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete grade {deleteRange?.grade}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteRange && removeRange.mutate(deleteRange.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
