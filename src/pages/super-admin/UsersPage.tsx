import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Users, UserX, UserCheck, MoreVertical, ChevronLeft, ChevronRight, RefreshCw, ArrowRightLeft, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import type { Profile, UserRole, School } from '@/types'

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  teacher: 'Teacher',
  group_admin: 'Group Admin'
}

type UserRow = Profile & { school?: { id: string; name: string } }
type PendingAction = { user: UserRow; isActive: boolean } | null
type TransferTarget = { user: UserRow } | null

export default function UsersPage() {
  const { profile: actingProfile } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [schoolFilter, setSchoolFilter] = useState<string>('all')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [transferTarget, setTransferTarget] = useState<TransferTarget>(null)
  const [transferToId, setTransferToId] = useState('')

  const { data: schools = [] } = useQuery({
    queryKey: ['all-schools-for-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('id, name').order('name')
      if (error) throw error
      return data as Pick<School, 'id' | 'name'>[]
    }
  })

  const { data: users = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['all-platform-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, school:schools(id, name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as (Profile & { school?: { id: string; name: string } })[]
    }
  })

  // Uses the set_school_admin_status RPC — a single atomic,
  // SECURITY DEFINER transaction that updates the target profile
  // AND cascades to every teacher at that school when the target
  // is a school_admin. After the call, we re-fetch that exact row
  // and verify the value actually changed before declaring success
  // — this is what would have caught the earlier "reactivation
  // didn't stick" bug immediately instead of silently.
  const toggleActive = useMutation({
    mutationFn: async ({ user, isActive }: { user: Profile; isActive: boolean }) => {
      const { data, error } = await supabase.rpc('set_school_admin_status', {
        p_profile_id: user.id,
        p_is_active: isActive
      })
      if (error) throw error

      const { data: verifyRow, error: verifyError } = await supabase
        .from('profiles').select('is_active').eq('id', user.id).single()
      if (verifyError) throw verifyError
      if (verifyRow.is_active !== isActive) {
        throw new Error('Update did not persist — please try again or check Supabase logs.')
      }

      await logAudit({
        schoolId: user.school_id, userId: actingProfile?.id ?? null, action: 'UPDATE', entityType: 'profile_status',
        entityId: user.id, oldValue: { is_active: !isActive }, newValue: { is_active: isActive }
      })

      return { affectedCount: data?.[0]?.affected_count ?? 1 }
    },
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ['all-platform-users'] })
      setPendingAction(null)
      if (vars.user.role === 'school_admin' && result.affectedCount > 1) {
        toast.success(`${vars.isActive ? 'Reactivated' : 'Suspended'} admin + ${result.affectedCount - 1} teacher${result.affectedCount - 1 !== 1 ? 's' : ''} at this school`)
      } else {
        toast.success(vars.isActive ? 'User reactivated' : 'User suspended')
      }
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // A public Supabase Auth endpoint — no special DB permission is
  // needed to call it for any email address (that's how "forgot
  // password" works everywhere; only the inbox owner can actually use
  // the link it sends). This just gives super_admin a one-click way to
  // trigger it on someone's behalf when they've been contacted outside
  // the app (email, a support ticket) instead of asking that person to
  // self-serve via /auth/forgot-password themselves.
  const sendPasswordReset = useMutation({
    mutationFn: async (user: UserRow) => {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`
      })
      if (error) throw error
      await logAudit({ schoolId: user.school_id, userId: actingProfile?.id ?? null, action: 'UPDATE', entityType: 'password_reset_sent', entityId: user.id })
    },
    onSuccess: (_data, user) => toast.success(`Reset link sent to ${user.email}`),
    onError: (e: Error) => toast.error(e.message)
  })

  // Only fetched once the transfer dialog is actually open, scoped to
  // the specific school of the admin being transferred away from —
  // there's no reason to pull every school's teachers up front.
  const { data: teachersAtTargetSchool = [] } = useQuery({
    queryKey: ['active-teachers-for-transfer', transferTarget?.user.school_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('school_id', transferTarget!.user.school_id!).eq('role', 'teacher').eq('is_active', true).order('first_name')
      if (error) throw error
      return data as Profile[]
    },
    enabled: !!transferTarget?.user.school_id
  })

  const transferAdmin = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('transfer_school_admin', {
        p_school_id: transferTarget!.user.school_id,
        p_new_admin_teacher_id: transferToId
      })
      if (error) throw error
    },
    onSuccess: async () => {
      const target = teachersAtTargetSchool.find(t => t.id === transferToId)
      await logAudit({
        schoolId: transferTarget!.user.school_id, userId: actingProfile?.id ?? null, action: 'PROMOTE', entityType: 'school_admin_transfer',
        entityId: transferToId, oldValue: { previous_admin: `${transferTarget!.user.first_name} ${transferTarget!.user.last_name}` },
        newValue: { new_admin: target ? `${target.first_name} ${target.last_name}` : undefined }
      })
      qc.invalidateQueries({ queryKey: ['all-platform-users'] })
      toast.success('Admin role transferred')
      setTransferTarget(null)
      setTransferToId('')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const filtered = users.filter(u => {
    const matchesSearch = `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter === 'all' || u.role === roleFilter
    const matchesSchool = schoolFilter === 'all' || u.school_id === schoolFilter
    return matchesSearch && matchesRole && matchesSchool
  })

  // Phase 5: client-side pagination — the platform-wide user list has
  // no upper bound and was rendering every row at once.
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title="Platform Users"
        description={`${users.length} user${users.length !== 1 ? 's' : ''} across all schools`}
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh users list">
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name or email…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
          </div>
          <Select value={roleFilter} onValueChange={v => { setRoleFilter(v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
              <SelectItem value="school_admin">School Admin</SelectItem>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="group_admin">Group Admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={schoolFilter} onValueChange={v => { setSchoolFilter(v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="All schools" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All schools</SelectItem>
              {schools.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Users className="h-12 w-12" />} title="No users match your filters" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">School</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-sm whitespace-nowrap">{u.first_name} {u.last_name}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell><Badge variant="outline">{ROLE_LABEL[u.role]}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{u.school?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'success' : 'destructive'}>{u.is_active ? 'Active' : 'Suspended'}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.role !== 'super_admin' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${u.first_name} ${u.last_name}`}><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => sendPasswordReset.mutate(u)}>
                              <KeyRound className="mr-2 h-4 w-4" />Send Password Reset Email
                            </DropdownMenuItem>
                            {u.role === 'school_admin' && u.is_active && (
                              <DropdownMenuItem onClick={() => { setTransferTarget({ user: u }); setTransferToId('') }}>
                                <ArrowRightLeft className="mr-2 h-4 w-4" />Transfer Admin Role
                              </DropdownMenuItem>
                            )}
                            {u.is_active ? (
                              <DropdownMenuItem onClick={() => setPendingAction({ user: u, isActive: false })} className="text-destructive">
                                <UserX className="mr-2 h-4 w-4" />Suspend
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setPendingAction({ user: u, isActive: true })} className="text-green-600">
                                <UserCheck className="mr-2 h-4 w-4" />Reactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <p>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Previous page" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" aria-label="Next page" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!pendingAction} onOpenChange={o => !o && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.isActive ? 'Reactivate' : 'Suspend'} {pendingAction?.user.first_name} {pendingAction?.user.last_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.user.role === 'school_admin'
                ? `This is a School Admin — every teacher at their school will also be ${pendingAction.isActive ? 'reactivated' : 'suspended'} along with them.`
                : `This only affects this individual account.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingAction && toggleActive.mutate(pendingAction)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!transferTarget} onOpenChange={o => !o && setTransferTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer admin role for {transferTarget?.user.school?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget?.user.first_name} {transferTarget?.user.last_name} will lose admin access immediately (suspended, same as any other suspension). Pick an active teacher at this school to become the new admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={transferToId} onValueChange={setTransferToId}>
            <SelectTrigger><SelectValue placeholder="Select a teacher" /></SelectTrigger>
            <SelectContent>
              {teachersAtTargetSchool.map(t => <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>)}
            </SelectContent>
          </Select>
          {teachersAtTargetSchool.length === 0 && (
            <p className="text-sm text-muted-foreground">No active teachers at this school to transfer to.</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!transferToId || transferAdmin.isPending} onClick={() => transferAdmin.mutate()}>
              Confirm Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
