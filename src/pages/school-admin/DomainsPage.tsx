import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pencil, Trash2, MoreVertical, Heart, Activity } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { AffectiveMetric, PsychomotorMetric } from '@/types'

const metricSchema = z.object({ name: z.string().min(1, 'Required') })
type MetricForm = z.infer<typeof metricSchema>

type MetricKind = 'affective' | 'psychomotor'

export default function DomainsPage() {
  const { schoolId } = useAuth()
  const qc = useQueryClient()

  const [dialogFor, setDialogFor] = useState<{ kind: MetricKind; target: AffectiveMetric | PsychomotorMetric | 'new' } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: MetricKind; metric: AffectiveMetric | PsychomotorMetric } | null>(null)

  const { data: affectiveMetrics = [], isLoading: loadingAffective } = useQuery({
    queryKey: ['affective-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('affective_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as AffectiveMetric[]
    },
    enabled: !!schoolId
  })

  const { data: psychomotorMetrics = [], isLoading: loadingPsychomotor } = useQuery({
    queryKey: ['psychomotor-metrics', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('psychomotor_metrics').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as PsychomotorMetric[]
    },
    enabled: !!schoolId
  })

  const form = useForm<MetricForm>({ resolver: zodResolver(metricSchema) })

  const openNew = (kind: MetricKind) => { form.reset(); setDialogFor({ kind, target: 'new' }) }
  const openEdit = (kind: MetricKind, metric: AffectiveMetric | PsychomotorMetric) => {
    form.reset({ name: metric.name })
    setDialogFor({ kind, target: metric })
  }

  const tableName = (kind: MetricKind) => kind === 'affective' ? 'affective_metrics' : 'psychomotor_metrics'
  const queryKey = (kind: MetricKind) => kind === 'affective' ? 'affective-metrics' : 'psychomotor-metrics'
  const currentList = (kind: MetricKind) => kind === 'affective' ? affectiveMetrics : psychomotorMetrics

  const upsert = useMutation({
    mutationFn: async (values: MetricForm) => {
      if (!dialogFor) return
      const { kind, target } = dialogFor
      if (target === 'new') {
        const { error } = await supabase.from(tableName(kind)).insert({
          school_id: schoolId, name: values.name, order_index: currentList(kind).length
        })
        if (error) throw error
      } else {
        const { error } = await supabase.from(tableName(kind)).update({ name: values.name }).eq('id', target.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      if (dialogFor) qc.invalidateQueries({ queryKey: [queryKey(dialogFor.kind), schoolId] })
      setDialogFor(null)
      toast.success('Saved')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return
      const { error } = await supabase.from(tableName(deleteTarget.kind)).delete().eq('id', deleteTarget.metric.id)
      if (error) throw error
    },
    onSuccess: () => {
      if (deleteTarget) qc.invalidateQueries({ queryKey: [queryKey(deleteTarget.kind), schoolId] })
      setDeleteTarget(null)
      toast.success('Deleted')
    },
    onError: (e: Error) => toast.error(
      e.message.includes('foreign key') ? 'This metric has recorded ratings — remove those first.' : e.message
    )
  })

  const renderMetricCard = (kind: MetricKind, title: string, description: string, icon: React.ReactNode, metrics: (AffectiveMetric | PsychomotorMetric)[], loading: boolean) => (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button size="sm" onClick={() => openNew(kind)}><Plus className="mr-2 h-3.5 w-3.5" />Add</Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : metrics.length === 0 ? (
          <EmptyState title="No metrics yet" description={`e.g. ${kind === 'affective' ? 'Punctuality, Honesty' : 'Neatness, Leadership'}`} />
        ) : (
          <Table>
            <TableBody>
              {metrics.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm font-medium">{m.name}</TableCell>
                  <TableCell className="w-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${m.name}`}><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(kind, m)}>
                          <Pencil className="mr-2 h-4 w-4" />Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleteTarget({ kind, metric: m })} className="text-destructive">
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
  )

  return (
    <div>
      <PageHeader
        title="Affective & Psychomotor Domains"
        description="Define the character and skill metrics that appear on report cards"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderMetricCard('affective', 'Affective Domain', 'Character traits like punctuality and honesty', <Heart className="h-4 w-4" />, affectiveMetrics, loadingAffective)}
        {renderMetricCard('psychomotor', 'Psychomotor Domain', 'Physical/practical skills like neatness and leadership', <Activity className="h-4 w-4" />, psychomotorMetrics, loadingPsychomotor)}
      </div>

      <Dialog open={!!dialogFor} onOpenChange={o => !o && setDialogFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogFor?.target === 'new' ? 'Add Metric' : 'Edit Metric'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(v => upsert.mutate(v))} className="space-y-4">
            <FormField label="Name" error={form.formState.errors.name?.message} required htmlFor="metricName">
              <Input id="metricName" {...form.register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogFor(null)}>Cancel</Button>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.metric.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => remove.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
