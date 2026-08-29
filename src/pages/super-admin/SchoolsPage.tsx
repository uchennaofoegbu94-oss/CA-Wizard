import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, MoreVertical, Loader2, School, Pencil, Ban, CheckCircle, Trash2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { notifyManyUsers, type NotificationType } from '@/lib/notifications'
import { slugify, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import { Card, CardContent } from '@/components/ui/card'
import toast from 'react-hot-toast'
import type { School as SchoolType } from '@/types'

// ─── Schema ───────────────────────────────────────────────

const schoolSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  motto: z.string().optional(),
  principal_name: z.string().optional(),
  subscription_tier: z.enum(['free', 'starter', 'professional', 'enterprise']).default('free')
})

type SchoolFormData = z.infer<typeof schoolSchema>

// ─── API ──────────────────────────────────────────────────

async function fetchSchools(): Promise<SchoolType[]> {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .order('name')
  if (error) throw error
  return data as SchoolType[]
}

async function createSchool(values: SchoolFormData): Promise<SchoolType> {
  const { data, error } = await supabase
    .from('schools')
    .insert({ ...values, slug: slugify(values.name) })
    .select()
    .single()
  if (error) throw error
  return data as SchoolType
}

async function updateSchool(id: string, values: Partial<SchoolFormData>): Promise<SchoolType> {
  const { data, error } = await supabase
    .from('schools')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as SchoolType
}

async function updateSchoolStatus(
  id: string,
  status: 'active' | 'suspended',
  previousStatus: string,
  actorProfileId: string | null
): Promise<void> {
  const { error } = await supabase.from('schools').update({ status }).eq('id', id)
  if (error) throw error

  logAudit({
    schoolId: id, userId: actorProfileId, action: 'UPDATE', entityType: 'school_status',
    entityId: id, oldValue: { status: previousStatus }, newValue: { status }
  })

  // Notify the school's admin(s) — this is exactly the case that needs
  // to reach someone who may be logged out (a school being approved
  // means the admin who registered it hasn't been able to sign in at
  // all yet), hence requiresEmail: true. No email provider is wired up
  // yet — see migration 012 — but the row is ready the moment one is.
  const { data: admins } = await supabase.from('profiles').select('id').eq('school_id', id).eq('role', 'school_admin')
  if (!admins || admins.length === 0) return

  const wasApproval = status === 'active' && previousStatus === 'pending'
  const type: NotificationType = status === 'suspended' ? 'school_suspended' : wasApproval ? 'school_approved' : 'school_reactivated'
  const title = status === 'suspended'
    ? 'Your school has been suspended'
    : wasApproval ? 'Your school has been approved!' : 'Your school has been reactivated'
  const body = status === 'suspended'
    ? 'Access to CA-Wizard has been temporarily suspended for your school. Contact support for details.'
    : wasApproval
      ? 'Your school is now active. Sign in to start setting up classes, subjects, and teachers.'
      : "Your school's access has been restored. Sign in to continue where you left off."

  await notifyManyUsers(admins.map(a => a.id), {
    schoolId: id, type, title, body, linkPath: '/school', requiresEmail: true
  })
}

async function deleteSchool(id: string): Promise<void> {
  const { error } = await supabase.from('schools').delete().eq('id', id)
  if (error) throw error
}

// ─── Component ────────────────────────────────────────────

type DialogMode = 'create' | 'edit' | null

export default function SchoolsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [selected, setSelected] = useState<SchoolType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SchoolType | null>(null)

  const { data: schools = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['schools'],
    queryFn: fetchSchools
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<SchoolFormData>({
    resolver: zodResolver(schoolSchema)
  })

  const createMutation = useMutation({
    mutationFn: createSchool,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] })
      qc.invalidateQueries({ queryKey: ['super-admin-dashboard'] })
      toast.success('School created successfully')
      closeDialog()
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SchoolFormData> }) => updateSchool(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] })
      toast.success('School updated')
      closeDialog()
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status, previousStatus }: { id: string; status: 'active' | 'suspended'; previousStatus: string }) =>
      updateSchoolStatus(id, status, previousStatus, profile?.id ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] })
      toast.success('Status updated')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSchool,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] })
      qc.invalidateQueries({ queryKey: ['super-admin-dashboard'] })
      toast.success('School deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const openCreate = () => {
    reset()
    setSelected(null)
    setDialogMode('create')
  }

  const openEdit = (school: SchoolType) => {
    setSelected(school)
    setValue('name', school.name)
    setValue('address', school.address ?? '')
    setValue('phone', school.phone ?? '')
    setValue('email', school.email ?? '')
    setValue('motto', school.motto ?? '')
    setValue('principal_name', school.principal_name ?? '')
    setValue('subscription_tier', school.subscription_tier as 'free' | 'starter' | 'professional' | 'enterprise')
    setDialogMode('edit')
  }

  const closeDialog = () => {
    setDialogMode(null)
    setSelected(null)
    reset()
  }

  const onSubmit = async (data: SchoolFormData) => {
    if (dialogMode === 'create') {
      await createMutation.mutateAsync(data)
    } else if (selected) {
      // Captured before the mutation runs, from the school row already
      // loaded into `selected` when the edit dialog opened — this is
      // the only place the pre-change tier is available, since
      // updateSchool() just overwrites the row.
      const tierChanged = selected.subscription_tier !== data.subscription_tier
      const previousTier = selected.subscription_tier

      await updateMutation.mutateAsync({ id: selected.id, data })

      if (tierChanged) {
        logAudit({
          schoolId: selected.id,
          userId: profile?.id ?? null,
          action: 'UPDATE',
          entityType: 'school_subscription_tier',
          entityId: selected.id,
          oldValue: { subscription_tier: previousTier },
          newValue: { subscription_tier: data.subscription_tier }
        })
      }
    }
  }

  const filtered = schools.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.slug.includes(search.toLowerCase())
  )

  return (
    <div>
      <PageHeader
        title="Schools"
        description={`${schools.length} school${schools.length !== 1 ? 's' : ''} registered on the platform`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh schools list">
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add School
            </Button>
          </div>
        }
      />

      {/* Search */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email or slug…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-0 p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<School className="h-12 w-12" />}
              title={search ? 'No schools match your search' : 'No schools yet'}
              description={search ? 'Try a different search term' : 'Add your first school to get started'}
              action={!search ? (
                <Button onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" /> Add School
                </Button>
              ) : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(school => (
                  <TableRow key={school.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-md bg-brand-100 flex items-center justify-center shrink-0">
                          <School className="h-4 w-4 text-brand-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{school.name}</p>
                          <p className="text-xs text-muted-foreground">{school.slug}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {school.email ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline" className="capitalize text-xs">
                        {school.subscription_tier}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        school.status === 'active' ? 'success' :
                        school.status === 'suspended' ? 'destructive' : 'warning'
                      } className="capitalize">
                        {school.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {formatDate(school.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${school.name}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(school)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          {school.status === 'active' ? (
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: school.id, status: 'suspended', previousStatus: school.status })}
                              className="text-orange-600"
                            >
                              <Ban className="mr-2 h-4 w-4" /> Suspend
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: school.id, status: 'active', previousStatus: school.status })}
                              className="text-green-600"
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              {school.status === 'pending' ? 'Approve School' : 'Activate'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(school)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={open => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? 'Add New School' : 'Edit School'}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? 'Create a new school tenant on the platform'
                : `Editing ${selected?.name}`
              }
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormField label="School Name" error={errors.name?.message} required htmlFor="name">
              <Input id="name" placeholder="Mirror International School" {...register('name')} />
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Principal's Name" htmlFor="principal_name">
                <Input id="principal_name" placeholder="Mr. Okafor" {...register('principal_name')} />
              </FormField>
              <FormField label="Phone" htmlFor="phone">
                <Input id="phone" placeholder="+234-800-000-0000" {...register('phone')} />
              </FormField>
            </FormGrid>

            <FormField label="Email" error={errors.email?.message} htmlFor="email">
              <Input id="email" type="email" placeholder="admin@school.edu.ng" {...register('email')} />
            </FormField>

            <FormField label="Address" htmlFor="address">
              <Textarea id="address" rows={2} placeholder="123 School Road, Port Harcourt" {...register('address')} />
            </FormField>

            <FormField label="School Motto" htmlFor="motto">
              <Input id="motto" placeholder="Excellence Through Knowledge" {...register('motto')} />
            </FormField>

            <FormField label="Subscription Plan" error={errors.subscription_tier?.message} htmlFor="subscription_tier">
              <select
                id="subscription_tier"
                {...register('subscription_tier')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {dialogMode === 'create' ? 'Create School' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete School?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its data including students, scores, and reports.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
