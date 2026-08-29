import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pencil, Trash2, MoreVertical, BookOpen, Settings2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import toast from 'react-hot-toast'
import type { Subject, ClassLevel, SubjectOffering } from '@/types'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'

const subjectSchema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().optional()
})

type SubjectForm = z.infer<typeof subjectSchema>

export default function SubjectsPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()

  const [subjectDialog, setSubjectDialog] = useState<Subject | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null)
  const [offeringsLevel, setOfferingsLevel] = useState<ClassLevel | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [activeTab, setActiveTab] = useState('catalog')

  // ── Global subject catalog ──
  const { data: subjects = [], isLoading: loadingSubjects } = useQuery({
    queryKey: ['subject-catalog', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').eq('school_id', schoolId!).order('name')
      if (error) throw error
      return data as Subject[]
    },
    enabled: !!schoolId
  })

  // ── Class levels ──
  const { data: levels = [], isLoading: loadingLevels } = useQuery({
    queryKey: ['class-levels', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('class_levels').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as ClassLevel[]
    },
    enabled: !!schoolId
  })

  // ── Offerings (which subjects are offered at which level) ──
  const { data: offerings = [] } = useQuery({
    queryKey: ['subject-offerings', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('subject_offerings').select('*').eq('school_id', schoolId!)
      if (error) throw error
      return data as SubjectOffering[]
    },
    enabled: !!schoolId
  })

  const offeringsForLevel = (levelId: string) => offerings.filter(o => o.class_level_id === levelId)
  const isOffered = (subjectId: string, levelId: string) =>
    offerings.some(o => o.subject_id === subjectId && o.class_level_id === levelId)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['subject-catalog', schoolId] })
    qc.invalidateQueries({ queryKey: ['subject-offerings', schoolId] })
  }

  // ══════════════════════════════════════════════════════════
  // SUBJECT CATALOG CRUD
  // ══════════════════════════════════════════════════════════
  const form = useForm<SubjectForm>({ resolver: zodResolver(subjectSchema) })

  const openNew = () => { form.reset(); setSubjectDialog('new') }
  const openEdit = (s: Subject) => { form.reset({ name: s.name, code: s.code ?? '' }); setSubjectDialog(s) }

  const upsertSubject = useMutation({
    mutationFn: async (values: SubjectForm) => {
      const payload = { name: values.name, code: values.code || null }
      if (subjectDialog === 'new') {
        const { data, error } = await supabase.from('subjects').insert({ ...payload, school_id: schoolId }).select().single()
        if (error) throw error
        return { action: 'CREATE' as const, id: data.id, payload }
      } else if (subjectDialog && typeof subjectDialog === 'object') {
        const { error } = await supabase.from('subjects').update(payload).eq('id', subjectDialog.id)
        if (error) throw error
        return { action: 'UPDATE' as const, id: subjectDialog.id, payload }
      }
      return null
    },
    onSuccess: (result) => {
      invalidateAll(); setSubjectDialog(null); toast.success('Saved')
      if (result) logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'subject', entityId: result.id, newValue: result.payload })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('duplicate key') ? 'A subject with this name already exists.' : e.message
    )
  })

  const removeSubject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('subjects').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      invalidateAll(); setDeleteTarget(null); toast.success('Deleted')
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'DELETE', entityType: 'subject', entityId: id })
    },
    onError: (e: Error) => toast.error(
      e.message.includes('foreign key') ? 'This subject has recorded scores — remove those first.' : e.message
    )
  })

  // ══════════════════════════════════════════════════════════
  // PER-LEVEL OFFERINGS
  // ══════════════════════════════════════════════════════════
  const toggleOffering = useMutation({
    mutationFn: async ({ subjectId, levelId, currentlyOffered }: { subjectId: string; levelId: string; currentlyOffered: boolean }) => {
      if (currentlyOffered) {
        const { error } = await supabase.from('subject_offerings').delete()
          .eq('subject_id', subjectId).eq('class_level_id', levelId)
        if (error) throw error
        return { action: 'DELETE' as const, subjectId, levelId }
      } else {
        const { error } = await supabase.from('subject_offerings').insert({
          school_id: schoolId, subject_id: subjectId, class_level_id: levelId
        })
        if (error) throw error
        return { action: 'CREATE' as const, subjectId, levelId }
      }
    },
    onSuccess: (result) => {
      invalidateAll()
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: result.action, entityType: 'subject_offering',
        entityId: result.subjectId, newValue: { subject_id: result.subjectId, class_level_id: result.levelId }
      })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  return (
    <div>
      <PageHeader
        title="Subjects"
        description={`${subjects.length} subject${subjects.length !== 1 ? 's' : ''} in your school-wide catalog`}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="catalog"><BookOpen className="mr-1.5 h-4 w-4" />Subject Catalog</TabsTrigger>
          <TabsTrigger value="offerings"><Settings2 className="mr-1.5 h-4 w-4" />Class Level Offerings</TabsTrigger>
        </TabsList>

        {/* ═══ SUBJECT CATALOG TAB ═══ */}
        <TabsContent value="catalog">
      <div className="flex justify-end mb-3">
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add Subject</Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />Subject Catalog</CardTitle>
            <CardDescription>Create each subject once here, then choose which class levels offer it below.</CardDescription>
          </div>
          <ViewToggle value={view} onChange={setView} />
        </CardHeader>
        <CardContent className="p-0">
          {loadingSubjects ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : subjects.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title="No subjects yet"
              description="Add subjects like Mathematics, English Language, Physics…"
              action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add Subject</Button>}
            />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {subjects.map(subject => {
                const offeredLevels = levels.filter(l => isOffered(subject.id, l.id))
                return (
                  <div key={subject.id} className="rounded-lg border p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{subject.name}</p>
                        {subject.code && <p className="text-xs text-muted-foreground font-mono">{subject.code}</p>}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${subject.name}`}><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(subject)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteTarget(subject)} className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {offeredLevels.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">Not offered anywhere</span>
                      ) : (
                        offeredLevels.map(l => <Badge key={l.id} variant="outline" className="text-xs">{l.name}</Badge>)
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden sm:table-cell">Code</TableHead>
                  <TableHead className="hidden sm:table-cell">Offered At</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map(subject => {
                  const offeredLevels = levels.filter(l => isOffered(subject.id, l.id))
                  return (
                    <TableRow key={subject.id}>
                      <TableCell className="font-medium text-sm">{subject.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground font-mono">{subject.code ?? '—'}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {offeredLevels.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic">Not offered anywhere</span>
                          ) : (
                            offeredLevels.map(l => <Badge key={l.id} variant="outline" className="text-xs">{l.name}</Badge>)
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${subject.name}`}><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(subject)}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteTarget(subject)} className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
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
        </TabsContent>

        {/* ═══ CLASS LEVEL OFFERINGS TAB ═══ */}
        <TabsContent value="offerings">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Class Level Offerings</CardTitle>
          <CardDescription>Choose which catalog subjects each class level actually offers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingLevels ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : levels.length === 0 ? (
            <EmptyState title="No class levels yet" description="Create class levels under Classes first." />
          ) : (
            <div className="divide-y">
              {levels.map(level => {
                const count = offeringsForLevel(level.id).length
                return (
                  <div key={level.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <p className="font-medium text-sm">{level.name}</p>
                      <Badge variant="secondary">{count} subject{count !== 1 ? 's' : ''}</Badge>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setOfferingsLevel(level)}>
                      Manage Offerings
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Subject Dialog */}
      <Dialog open={!!subjectDialog} onOpenChange={o => !o && setSubjectDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{subjectDialog === 'new' ? 'Add Subject' : 'Edit Subject'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(v => upsertSubject.mutate(v))} className="space-y-4">
            <FormField label="Subject Name" error={form.formState.errors.name?.message} required htmlFor="subjName">
              <Input id="subjName" placeholder="Mathematics" {...form.register('name')} />
            </FormField>
            <FormField label="Code" hint="Optional short code, e.g. MTH" htmlFor="subjCode">
              <Input id="subjCode" placeholder="MTH" {...form.register('code')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSubjectDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={upsertSubject.isPending}>
                {upsertSubject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Offerings Dialog */}
      <Dialog open={!!offeringsLevel} onOpenChange={o => !o && setOfferingsLevel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{offeringsLevel?.name} — Offerings</DialogTitle>
            <DialogDescription>Toggle which catalog subjects this level offers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subjects in your catalog yet — add some above first.</p>
            ) : (
              subjects.map(subject => {
                const offered = offeringsLevel ? isOffered(subject.id, offeringsLevel.id) : false
                return (
                  <label key={subject.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={offered}
                      disabled={toggleOffering.isPending}
                      onChange={() => offeringsLevel && toggleOffering.mutate({
                        subjectId: subject.id, levelId: offeringsLevel.id, currentlyOffered: offered
                      })}
                      className="rounded"
                    />
                    <span className="text-sm">{subject.name}</span>
                    {subject.code && <span className="text-xs text-muted-foreground font-mono">({subject.code})</span>}
                  </label>
                )
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferingsLevel(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes it from every class level's offerings too. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              onClick={() => deleteTarget && removeSubject.mutate(deleteTarget.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
