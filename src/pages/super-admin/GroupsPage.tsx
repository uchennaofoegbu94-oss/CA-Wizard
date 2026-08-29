import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, Building2, Copy, Check, UserPlus, X,
  ChevronDown, ChevronRight, Trash2, KeyRound
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { generateInviteCode, formatDate, isExpired } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'
import type { AdminGroup, School, InviteCode } from '@/types'

const NONE_VALUE = '__none__'

const groupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters')
})
type GroupFormData = z.infer<typeof groupSchema>

export default function GroupsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [inviteDialogGroup, setInviteDialogGroup] = useState<AdminGroup | null>(null)
  const [generatedCode, setGeneratedCode] = useState<InviteCode | null>(null)
  const [copied, setCopied] = useState(false)
  const [addSchoolGroup, setAddSchoolGroup] = useState<AdminGroup | null>(null)
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
  const [removeSchoolTarget, setRemoveSchoolTarget] = useState<{ group: AdminGroup; school: School } | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<AdminGroup | null>(null)
  const [reassignGroup, setReassignGroup] = useState<AdminGroup | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema)
  })

  // ── Data ──────────────────────────────────────────────────
  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_groups')
        .select('*, group_admin:profiles(*)')
        .order('name')
      if (error) throw error
      return data as AdminGroup[]
    }
  })

  const { data: allSchools = [] } = useQuery({
    queryKey: ['all-schools-for-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').order('name')
      if (error) throw error
      return data as School[]
    }
  })

  const schoolsByGroup = (groupId: string) => allSchools.filter(s => s.group_id === groupId)
  const ungroupedSchools = allSchools.filter(s => !s.group_id)

  const invalidateGroups = () => {
    qc.invalidateQueries({ queryKey: ['admin-groups'] })
    qc.invalidateQueries({ queryKey: ['all-schools-for-groups'] })
  }

  // ── Create group ──────────────────────────────────────────
  const createGroup = useMutation({
    mutationFn: async (data: GroupFormData) => {
      const { data: row, error } = await supabase
        .from('admin_groups')
        .insert({ name: data.name })
        .select()
        .single()
      if (error) throw error
      return row as AdminGroup
    },
    onSuccess: (row) => {
      logAudit({ schoolId: null, userId: profile?.id ?? null, action: 'CREATE', entityType: 'admin_group', entityId: row.id, newValue: { name: row.name } })
      toast.success('Group created')
      setCreateOpen(false)
      reset()
      invalidateGroups()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Generate staff (group_admin) invite code ────────────────
  const generateStaffInvite = useMutation({
    mutationFn: async (group: AdminGroup) => {
      const code = generateInviteCode(8)
      const { data, error } = await supabase
        .from('invite_codes')
        .insert({
          school_id: null,
          code,
          label: `Group Admin — ${group.name}`,
          target_role: 'group_admin',
          created_by: profile?.id ?? null
        })
        .select()
        .single()
      if (error) throw error
      return data as InviteCode
    },
    onSuccess: (row) => {
      setGeneratedCode(row)
      logAudit({ schoolId: null, userId: profile?.id ?? null, action: 'CREATE', entityType: 'invite_code', entityId: row.id, newValue: { target_role: 'group_admin' } })
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Reassign / clear group admin on a group ─────────────────
  const reassignGroupAdmin = useMutation({
    mutationFn: async ({ groupId, newAdminProfileId }: { groupId: string; newAdminProfileId: string | null }) => {
      const { error } = await supabase
        .from('admin_groups')
        .update({ group_admin_id: newAdminProfileId })
        .eq('id', groupId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Group admin updated')
      setReassignGroup(null)
      invalidateGroups()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Add / remove schools from a group ───────────────────────
  const addSchoolToGroup = useMutation({
    mutationFn: async ({ groupId, schoolId }: { groupId: string; schoolId: string }) => {
      const { error } = await supabase.from('schools').update({ group_id: groupId }).eq('id', schoolId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('School added to group')
      setAddSchoolGroup(null)
      setSelectedSchoolId('')
      invalidateGroups()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const removeSchoolFromGroup = useMutation({
    mutationFn: async (schoolId: string) => {
      const { error } = await supabase.from('schools').update({ group_id: null }).eq('id', schoolId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('School removed from group')
      setRemoveSchoolTarget(null)
      invalidateGroups()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Delete an empty group ────────────────────────────────────
  const deleteGroup = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.from('admin_groups').delete().eq('id', groupId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Group deleted')
      setDeleteGroupTarget(null)
      invalidateGroups()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <PageHeader
        title="Groups"
        description="Regional/district clusters of schools, each overseen by a group admin"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Group
          </Button>
        }
      />

      {loadingGroups ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="No groups yet"
          description="Create a group to cluster schools under a group admin who can triage support tickets before they reach you."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Group</Button>}
        />
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const schools = schoolsByGroup(group.id)
            const expanded = expandedId === group.id
            return (
              <Card key={group.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                      onClick={() => setExpandedId(expanded ? null : group.id)}
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{group.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {schools.length} school{schools.length !== 1 ? 's' : ''} ·{' '}
                          {group.group_admin
                            ? `${group.group_admin.first_name} ${group.group_admin.last_name}`
                            : 'No group admin assigned'}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => setReassignGroup(group)}>
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Admin
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setAddSchoolGroup(group)}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> School
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete group"
                        title="Delete group"
                        disabled={schools.length > 0}
                        onClick={() => setDeleteGroupTarget(group)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-4 pt-4 border-t space-y-2">
                      {schools.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No schools in this group yet.</p>
                      ) : (
                        schools.map(school => (
                          <div key={school.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                            <span className="text-sm font-medium">{school.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRemoveSchoolTarget({ group, school })}
                              className="text-destructive hover:text-destructive"
                            >
                              <X className="mr-1 h-3.5 w-3.5" /> Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Create Group ──────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Group</DialogTitle>
            <DialogDescription>Give this cluster of schools a name — e.g. a region or district.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => createGroup.mutate(d))} className="space-y-4">
            <FormField label="Group Name" required error={errors.name?.message} htmlFor="group-name">
              <Input id="group-name" placeholder="e.g. South-East Cluster" {...register('name')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Group'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Reassign group admin ─────────────────────────────── */}
      <Dialog open={!!reassignGroup} onOpenChange={(o) => { if (!o) { setReassignGroup(null); setGeneratedCode(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group Admin — {reassignGroup?.name}</DialogTitle>
            <DialogDescription>
              Generate a staff invite code for a new group admin, or clear the current assignment.
              Roles here are transferable and always determined by you.
            </DialogDescription>
          </DialogHeader>

          {reassignGroup?.group_admin && (
            <div className="rounded-lg bg-muted/50 p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{reassignGroup.group_admin.first_name} {reassignGroup.group_admin.last_name}</p>
                <p className="text-xs text-muted-foreground">{reassignGroup.group_admin.email}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reassignGroupAdmin.mutate({ groupId: reassignGroup.id, newAdminProfileId: null })}
                disabled={reassignGroupAdmin.isPending}
              >
                Clear
              </Button>
            </div>
          )}

          {generatedCode ? (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm text-muted-foreground">Share this code with the incoming group admin. They redeem it at <span className="font-mono">/auth/join</span>.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-widest">{generatedCode.code}</code>
                <Button variant="outline" size="icon" aria-label="Copy code" title="Copy code" onClick={() => copyCode(generatedCode.code)}>
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Expires {formatDate(generatedCode.expires_at)}{isExpired(generatedCode.expires_at) ? ' (expired)' : ''}</p>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => reassignGroup && generateStaffInvite.mutate(reassignGroup)}
              disabled={generateStaffInvite.isPending}
            >
              {generateStaffInvite.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Generate Staff Invite Code
            </Button>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setReassignGroup(null); setGeneratedCode(null) }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add school to group ──────────────────────────────── */}
      <Dialog open={!!addSchoolGroup} onOpenChange={(o) => { if (!o) { setAddSchoolGroup(null); setSelectedSchoolId('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add School — {addSchoolGroup?.name}</DialogTitle>
            <DialogDescription>Only ungrouped schools are shown. A school can belong to one group at a time.</DialogDescription>
          </DialogHeader>
          {ungroupedSchools.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Every school is already in a group.</p>
          ) : (
            <FormField label="School" htmlFor="school-select">
              <Select value={selectedSchoolId || NONE_VALUE} onValueChange={setSelectedSchoolId}>
                <SelectTrigger id="school-select"><SelectValue placeholder="Choose a school" /></SelectTrigger>
                <SelectContent>
                  {ungroupedSchools.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddSchoolGroup(null); setSelectedSchoolId('') }}>Cancel</Button>
            <Button
              disabled={!selectedSchoolId || selectedSchoolId === NONE_VALUE || addSchoolToGroup.isPending}
              onClick={() => addSchoolGroup && addSchoolToGroup.mutate({ groupId: addSchoolGroup.id, schoolId: selectedSchoolId })}
            >
              {addSchoolToGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add School'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove school confirm ────────────────────────────── */}
      <AlertDialog open={!!removeSchoolTarget} onOpenChange={(o) => { if (!o) setRemoveSchoolTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeSchoolTarget?.school.name} from {removeSchoolTarget?.group.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The school will become ungrouped. Any open support tickets already escalated to this group stay visible to the group admin until resolved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeSchoolTarget && removeSchoolFromGroup.mutate(removeSchoolTarget.school.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete group confirm ─────────────────────────────── */}
      <AlertDialog open={!!deleteGroupTarget} onOpenChange={(o) => { if (!o) setDeleteGroupTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteGroupTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. This is only available for empty groups.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteGroupTarget && deleteGroup.mutate(deleteGroupTarget.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
