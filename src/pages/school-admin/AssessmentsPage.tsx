import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, ClipboardList, MoreVertical, Pencil, Trash2, Star,
  Eye, EyeOff, Sigma, ListChecks
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import type { AssessmentCategory, ScoreFieldSource, ScoreFieldType, ScoreComputeOperation } from '@/types'

const OPERATION_LABEL: Record<ScoreComputeOperation, string> = {
  sum: 'Sum',
  average: 'Average',
  weighted_percentage: 'Weighted %'
}

const OPERATION_HINT: Record<ScoreComputeOperation, string> = {
  sum: 'Adds up the selected fields\u2019 raw points. Displays as points (e.g. 67/90).',
  average: 'Averages the selected fields\u2019 raw points, weighted if you set uneven weights.',
  weighted_percentage: 'Converts each field to a percentage of its own max, then combines by weight. Set weights so they add up to 100 for a clean percentage-style total (e.g. 40 for CA fields + 60 for Exam reproduces a classic 40:60 split).'
}

const schema = z.object({
  name: z.string().min(1, 'Required'),
  field_type: z.enum(['input', 'computed']),
  max_score: z.coerce.number().min(1, 'Must be at least 1').max(1000),
  compute_operation: z.enum(['sum', 'average', 'weighted_percentage']).optional(),
  show_on_report_card: z.boolean(),
  order_index: z.coerce.number().default(0)
}).refine(v => v.field_type === 'input' || !!v.compute_operation, {
  message: 'Choose how this field is computed', path: ['compute_operation']
})
type FormData = z.infer<typeof schema>

interface SourceSelection {
  selected: boolean
  weight: number
}

export default function AssessmentsPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<AssessmentCategory | 'new' | null>(null)
  const [deleteTarget, setDelete] = useState<AssessmentCategory | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sources, setSources] = useState<Record<string, SourceSelection>>({})

  const inv = () => {
    qc.invalidateQueries({ queryKey: ['assessment-categories', schoolId] })
    qc.invalidateQueries({ queryKey: ['score-field-sources', schoolId] })
  }

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['assessment-categories', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('assessment_categories')
        .select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as AssessmentCategory[]
    },
    enabled: !!schoolId
  })

  const { data: allSources = [] } = useQuery({
    queryKey: ['score-field-sources', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('score_field_sources').select('*').eq('school_id', schoolId!)
      if (error) throw error
      return data as ScoreFieldSource[]
    },
    enabled: !!schoolId
  })

  const inputFields = useMemo(() => categories.filter(c => c.field_type === 'input'), [categories])
  const totalField = useMemo(() => categories.find(c => c.is_total_field), [categories])
  const reportCardColumns = useMemo(() =>
    categories.filter(c => c.show_on_report_card && !c.is_total_field).sort((a, b) => a.order_index - b.order_index),
    [categories]
  )

  const form = useForm<FormData>({ resolver: zodResolver(schema) })
  const fieldType = form.watch('field_type')

  // Candidate sources for the field currently being edited/created — every
  // OTHER field (a computed field's own two-pass design means it sources
  // from inputs in practice, but we don't hard-block picking another
  // computed field's inputs indirectly; we simply exclude the field being
  // edited itself to prevent a direct self-reference).
  // Every OTHER active field is a valid source — input fields directly,
  // and computed fields too (a computed field can now source from
  // another computed field, at any depth). Self-reference and cycles
  // are still blocked, but at the DB level (a trigger rejects the save
  // with a clear error) rather than by narrowing this list — computing
  // "is this selection currently cycle-free" client-side would mean
  // re-deriving the whole dependency graph on every checkbox click for
  // a check the database already does correctly on save.
  const candidateSources = useMemo(() => {
    const editingId = dialog && typeof dialog === 'object' ? dialog.id : null
    return categories.filter(c => c.is_active && c.id !== editingId)
  }, [categories, dialog])

  const openCreate = () => {
    form.reset({ field_type: 'input', max_score: 10, show_on_report_card: true, order_index: categories.length + 1 })
    setSources({})
    setDialog('new')
  }

  const openEdit = (c: AssessmentCategory) => {
    form.reset({
      name: c.name,
      field_type: c.field_type,
      max_score: c.max_score,
      compute_operation: c.compute_operation ?? undefined,
      show_on_report_card: c.show_on_report_card,
      order_index: c.order_index
    })
    const existing: Record<string, SourceSelection> = {}
    allSources.filter(s => s.field_id === c.id).forEach(s => {
      existing[s.source_field_id] = { selected: true, weight: Number(s.weight) }
    })
    setSources(existing)
    setDialog(c)
  }

  const toggleSource = (fieldId: string, checked: boolean) => {
    setSources(prev => ({ ...prev, [fieldId]: { selected: checked, weight: prev[fieldId]?.weight ?? 1 } }))
  }
  const setSourceWeight = (fieldId: string, weight: number) => {
    setSources(prev => ({ ...prev, [fieldId]: { selected: prev[fieldId]?.selected ?? true, weight } }))
  }

  const upsert = useMutation({
    mutationFn: async (values: FormData) => {
      const payload = {
        name: values.name,
        field_type: values.field_type,
        max_score: values.max_score,
        compute_operation: values.field_type === 'computed' ? values.compute_operation : null,
        show_on_report_card: values.show_on_report_card,
        order_index: values.order_index
      }

      let fieldId: string
      let action: 'CREATE' | 'UPDATE'

      if (dialog === 'new') {
        const { data, error } = await supabase.from('assessment_categories')
          .insert({ ...payload, school_id: schoolId, is_active: true }).select().single()
        if (error) throw error
        fieldId = data.id
        action = 'CREATE'
      } else if (dialog && typeof dialog === 'object') {
        const { error } = await supabase.from('assessment_categories').update(payload).eq('id', dialog.id)
        if (error) throw error
        fieldId = dialog.id
        action = 'UPDATE'
      } else {
        throw new Error('Nothing to save')
      }

      // Sync sources: simplest correct approach is delete-all-then-reinsert
      // for this field, rather than diffing — a computed field's source
      // list is short (a handful of rows) so this is cheap and avoids
      // subtle stale-row bugs.
      if (values.field_type === 'computed') {
        const { error: delErr } = await supabase.from('score_field_sources').delete().eq('field_id', fieldId)
        if (delErr) throw delErr
        const rows = Object.entries(sources)
          .filter(([, v]) => v.selected)
          .map(([source_field_id, v]) => ({ school_id: schoolId, field_id: fieldId, source_field_id, weight: v.weight }))
        if (rows.length > 0) {
          const { error: srcErr } = await supabase.from('score_field_sources').insert(rows)
          if (srcErr) throw srcErr
        }
      } else {
        // Switching (or staying) as an input field: it can't have sources.
        await supabase.from('score_field_sources').delete().eq('field_id', fieldId)
      }

      return { action, id: fieldId, values: payload }
    },
    onSuccess: (result) => {
      inv(); setDialog(null); form.reset(); toast.success('Field saved')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'assessment_category', entityId: result.id, newValue: result.values })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('assessment_categories').update({ is_active }).eq('id', id)
      if (error) throw error
      return { id, is_active }
    },
    onSuccess: ({ id, is_active }) => {
      inv(); toast.success('Updated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'assessment_category', entityId: id, newValue: { is_active } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const toggleReportCard = useMutation({
    mutationFn: async ({ id, show_on_report_card }: { id: string; show_on_report_card: boolean }) => {
      const { error } = await supabase.from('assessment_categories').update({ show_on_report_card }).eq('id', id)
      if (error) throw error
      return { id, show_on_report_card }
    },
    onSuccess: ({ id, show_on_report_card }) => {
      inv()
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'assessment_category', entityId: id, newValue: { show_on_report_card } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Designating a new Total field must unset the previous one first —
  // the DB has a hard constraint (at most one is_total_field=true per
  // school), so two sequential updates, not a single one.
  const setAsTotal = useMutation({
    mutationFn: async (id: string) => {
      if (totalField && totalField.id !== id) {
        const { error: unsetErr } = await supabase.from('assessment_categories').update({ is_total_field: false }).eq('id', totalField.id)
        if (unsetErr) throw unsetErr
      }
      const { error } = await supabase.from('assessment_categories').update({ is_total_field: true, show_on_report_card: true }).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      inv(); toast.success('Total field updated')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'assessment_category', entityId: id, newValue: { is_total_field: true } })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assessment_categories').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      inv(); setDelete(null); toast.success('Field deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'assessment_category', entityId: id })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const inputMaxTotal = inputFields.filter(c => c.is_active).reduce((sum, c) => sum + Number(c.max_score), 0)
  const selectedSourceCount = Object.values(sources).filter(s => s.selected).length
  const selectedWeightSum = Object.values(sources).filter(s => s.selected).reduce((sum, s) => sum + (Number(s.weight) || 0), 0)

  // The live "this field will be out of X points" preview, computed
  // the exact same way the DB does (see resolve_score_fields /
  // recompute_computed_max_scores_now): weight is a straight
  // multiplier for sum/average, so a small source weighted heavily
  // inflates the cap well past what "weights sum to N" alone would
  // suggest — surfacing the real resulting number here is what
  // actually explains the effect of a given weight, rather than
  // leaving the admin to infer it from the weight values alone.
  const effectiveMax = useMemo(() => {
    const op = form.watch('compute_operation')
    const entries = Object.entries(sources).filter(([, v]) => v.selected)
    if (entries.length === 0 || !op) return null
    let sumMax = 0
    let sumWeight = 0
    entries.forEach(([fieldId, v]) => {
      const src = categories.find(c => c.id === fieldId)
      if (!src) return
      sumMax += Number(src.max_score) * v.weight
      sumWeight += v.weight
    })
    if (op === 'sum') return Math.round(sumMax * 100) / 100
    if (op === 'average') return sumWeight > 0 ? Math.round((sumMax / sumWeight) * 100) / 100 : 0
    if (op === 'weighted_percentage') return Math.round(sumWeight * 100) / 100
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, categories, form.watch('compute_operation')])

  return (
    <div>
      <PageHeader
        title="Assessment Fields"
        description="Configure how scores are entered and combined — every field, its max score, and how (or whether) it's computed is entirely up to your school"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />Preview Report Card Columns
            </Button>
            <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Field</Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <Card className="border-brand-200 bg-brand-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-brand-800">Input Fields</CardTitle>
            <CardDescription className="text-brand-600">
              Active input fields sum to <strong className="text-brand-900">{inputMaxTotal}</strong> marks entered per student per subject.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className={totalField ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5" style={{ color: totalField ? '#166534' : '#9a3412' }}>
              <Star className="h-4 w-4" />Total Field
            </CardTitle>
            <CardDescription style={{ color: totalField ? '#16a34a' : '#c2410c' }}>
              {totalField
                ? <>Report cards use <strong>{totalField.name}</strong> ({totalField.compute_operation ? OPERATION_LABEL[totalField.compute_operation] : ''}) as the Total, and for grading.</>
                : 'No field is designated as Total yet — report cards and grading need one computed field marked as Total.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
           : categories.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-12 w-12" />}
              title="No assessment fields"
              description="Add input fields like Classwork, Assignment, or Exam — then a computed field to combine them into a Total."
              action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Field</Button>} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Max / Computed From</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>On Report Card</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map(cat => {
                  const catSources = allSources.filter(s => s.field_id === cat.id)
                  return (
                    <TableRow key={cat.id} className={!cat.is_active ? 'opacity-50' : ''}>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-1.5">
                          {cat.is_total_field && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />}
                          {cat.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={cat.field_type === 'computed' ? 'info' : 'secondary'}>
                          {cat.field_type === 'computed' ? <Sigma className="mr-1 h-3 w-3" /> : <ListChecks className="mr-1 h-3 w-3" />}
                          {cat.field_type === 'computed' ? (cat.compute_operation ? OPERATION_LABEL[cat.compute_operation] : 'Computed') : 'Input'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {cat.field_type === 'input' ? (
                          <><span className="font-mono font-semibold">{cat.max_score}</span> <span className="text-xs text-muted-foreground">marks</span></>
                        ) : catSources.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">No sources selected</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {catSources.map(s => categories.find(c => c.id === s.source_field_id)?.name ?? '—').join(', ')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{cat.order_index}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => toggleReportCard.mutate({ id: cat.id, show_on_report_card: !cat.show_on_report_card })}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={cat.show_on_report_card ? `Hide ${cat.name} from report card` : `Show ${cat.name} on report card`}
                          disabled={cat.is_total_field}
                          title={cat.is_total_field ? 'The Total field always shows on the report card' : undefined}
                        >
                          {cat.show_on_report_card || cat.is_total_field ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={cat.is_active}
                          onCheckedChange={v => toggleActive.mutate({ id: cat.id, is_active: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${cat.name}`}><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(cat)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            {cat.field_type === 'computed' && !cat.is_total_field && (
                              <DropdownMenuItem onClick={() => setAsTotal.mutate(cat.id)}><Star className="mr-2 h-4 w-4" />Set as Total</DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDelete(cat)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit dialog ── */}
      <Dialog open={!!dialog} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog === 'new' ? 'Add Field' : 'Edit Field'}</DialogTitle>
            <DialogDescription>
              An input field is a raw score a teacher enters. A computed field is derived from other fields — use it for a Total, an average, or any combination your school wants.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(v => upsert.mutate(v))} className="space-y-4">
            <FormField label="Field Name" error={form.formState.errors.name?.message} required htmlFor="fname">
              <Input id="fname" placeholder="e.g. Classwork, Exam, Total" {...form.register('name')} />
            </FormField>

            <FormField label="Field Type" required>
              <Controller
                control={form.control}
                name="field_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="input">Input — a score teachers enter directly</SelectItem>
                      <SelectItem value="computed">Computed — derived from other fields</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            {fieldType === 'input' ? (
              <FormGrid cols={2}>
                <FormField label="Max Score" error={form.formState.errors.max_score?.message} required htmlFor="fmax">
                  <Input id="fmax" type="number" min="1" max="1000" {...form.register('max_score')} />
                </FormField>
                <FormField label="Order" htmlFor="forder">
                  <Input id="forder" type="number" min="0" {...form.register('order_index')} />
                </FormField>
              </FormGrid>
            ) : (
              <>
                <FormField label="Compute Operation" error={form.formState.errors.compute_operation?.message} required>
                  <Controller
                    control={form.control}
                    name="compute_operation"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue placeholder="Choose an operation" /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(OPERATION_LABEL) as ScoreComputeOperation[]).map(op => (
                            <SelectItem key={op} value={op}>{OPERATION_LABEL[op]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {form.watch('compute_operation') && (
                    <p className="text-xs text-muted-foreground mt-1">{OPERATION_HINT[form.watch('compute_operation') as ScoreComputeOperation]}</p>
                  )}
                </FormField>

                <div>
                  <Label>Source Fields &amp; Weights</Label>
                  {candidateSources.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-1">Add at least one input field first — a computed field needs something to compute from.</p>
                  ) : (
                    <div className="mt-1.5 border rounded-md divide-y max-h-52 overflow-y-auto">
                      {candidateSources.map(src => {
                        const sel = sources[src.id]
                        return (
                          <div key={src.id} className="flex items-center gap-2 px-2.5 py-1.5">
                            <Checkbox
                              checked={!!sel?.selected}
                              onCheckedChange={v => toggleSource(src.id, !!v)}
                              id={`src-${src.id}`}
                            />
                            <Label htmlFor={`src-${src.id}`} className="flex-1 text-sm font-normal cursor-pointer">
                              {src.name} <span className="text-xs text-muted-foreground">/{src.max_score}</span>
                              {src.field_type === 'computed' && (
                                <Badge variant="info" className="ml-1.5 align-middle text-[10px] px-1 py-0 h-4">Computed</Badge>
                              )}
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-20 h-8 text-sm"
                              disabled={!sel?.selected}
                              value={sel?.weight ?? 1}
                              onChange={e => setSourceWeight(src.id, Number(e.target.value))}
                              aria-label={`Weight for ${src.name}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {selectedSourceCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedSourceCount} source{selectedSourceCount === 1 ? '' : 's'} selected — this field will be out of{' '}
                      <strong>{effectiveMax ?? '—'}</strong> points.
                      {form.watch('compute_operation') === 'sum' && selectedWeightSum !== selectedSourceCount && (
                        <span className="text-orange-600">
                          {' '}Note: a weight above 1 multiplies that source's points, not just its influence — double-check
                          that's what you want before saving (weights sum to {Math.round(selectedWeightSum * 100) / 100},
                          but that number by itself isn't this field's cap for Sum).
                        </span>
                      )}
                      {form.watch('compute_operation') === 'weighted_percentage' && Math.round(selectedWeightSum) !== 100 && (
                        <span className="text-orange-600"> — weights don't sum to 100, so Total won't land on a clean 0–100% scale.</span>
                      )}
                    </p>
                  )}
                </div>

                <FormField label="Order" htmlFor="forder2">
                  <Input id="forder2" type="number" min="0" className="max-w-[120px]" {...form.register('order_index')} />
                </FormField>
              </>
            )}

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="fshow">Show on Report Card</Label>
                <p className="text-xs text-muted-foreground">Total, Grade, and Remarks always show regardless of this setting.</p>
              </div>
              <Controller
                control={form.control}
                name="show_on_report_card"
                render={({ field }) => <Switch id="fshow" checked={field.value} onCheckedChange={field.onChange} />}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsert.isPending}>{upsert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Report card column preview ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Report Card Column Preview</DialogTitle>
            <DialogDescription>This is the exact column order students' report cards will show, left to right.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  {reportCardColumns.map(c => <TableHead key={c.id} className="text-center">{c.name}</TableHead>)}
                  <TableHead className="text-center font-semibold">Total</TableHead>
                  <TableHead className="text-center font-semibold">Grade</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-sm text-muted-foreground italic">e.g. Mathematics</TableCell>
                  {reportCardColumns.map(c => <TableCell key={c.id} className="text-center text-sm text-muted-foreground">—</TableCell>)}
                  <TableCell className="text-center text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {!totalField && (
            <p className="text-xs text-orange-600">No Total field is designated yet — grades can't be computed until you set one (see the Total Field card, or use "Set as Total" on a computed field).</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All scores recorded under this field will be permanently deleted.
              {deleteTarget?.is_total_field && ' This is the current Total field — deleting it will leave report cards without a Total until you designate a new one.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
