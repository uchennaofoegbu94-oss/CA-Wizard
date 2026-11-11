import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Users, Sparkles, Loader2, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { useGroupTypes } from '@/lib/studentGroups'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageHeader, Spinner } from '@/components/ui/table'
import toast from 'react-hot-toast'

// Starter sets so a school isn't looking at an empty page. Nothing is created until clicked,
// and every name can be removed afterwards.
const TEMPLATES = [
  { type: 'Stream', groups: ['Science', 'Arts', 'Commercial'], blurb: 'Science / Arts / Commercial classes' },
  { type: 'Religion', groups: ['Christian', 'Muslim'], blurb: 'for Christian vs Islamic Religious Studies' }
]

// Group types and the groups inside them. The ASSIGNING of students happens per class
// (Classes → open a class → Student Groups); restricting a subject to a group happens in
// Subjects → Class Level Offerings.
export default function StudentGroupsPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [newType, setNewType] = useState('')
  const [newGroup, setNewGroup] = useState<Record<string, string>>({})

  const { data: types = [], isLoading } = useGroupTypes(schoolId)

  // How many students are in each group (this school, all sessions) and which groups a subject depends on
  const { data: usage } = useQuery({
    queryKey: ['student-group-usage', schoolId],
    queryFn: async () => {
      const [{ data: sess }, { data: mem, error: e1 }, { data: aud, error: e2 }] = await Promise.all([
        supabase.from('sessions').select('id').eq('school_id', schoolId!).eq('is_current', true).maybeSingle().then(r => ({ data: r.data, error: r.error })),
        supabase.from('student_group_members').select('group_id, session_id').eq('school_id', schoolId!),
        supabase.from('subject_offering_groups').select('group_id').eq('school_id', schoolId!)
      ])
      if (e1) throw e1
      if (e2) throw e2
      const currentSessionId = sess?.id as string | undefined
      const members = new Map<string, number>()
      const allTimeMembers = new Map<string, number>()
      ;(mem ?? []).forEach((m: any) => {
        allTimeMembers.set(m.group_id, (allTimeMembers.get(m.group_id) ?? 0) + 1)
        if (m.session_id === currentSessionId) members.set(m.group_id, (members.get(m.group_id) ?? 0) + 1)
      })
      const audience = new Map<string, number>()
      ;(aud ?? []).forEach((a: any) => audience.set(a.group_id, (audience.get(a.group_id) ?? 0) + 1))
      return { members, allTimeMembers, audience }
    },
    enabled: !!schoolId
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['student-group-types', schoolId] })
    qc.invalidateQueries({ queryKey: ['student-group-usage', schoolId] })
  }

  const addType = useMutation({
    mutationFn: async ({ name, groups }: { name: string; groups: string[] }) => {
      const { data: t, error } = await supabase.from('student_group_types')
        .insert({ school_id: schoolId, name: name.trim(), sort_order: types.length }).select().single()
      if (error) throw error
      if (groups.length > 0) {
        const { error: ge } = await supabase.from('student_groups')
          .insert(groups.map((g, i) => ({ school_id: schoolId, type_id: t.id, name: g, sort_order: i })))
        if (ge) throw ge
      }
      return t.id as string
    },
    onSuccess: (id, { name }) => {
      refresh(); setNewType('')
      toast.success(`${name} added`)
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'CREATE', entityType: 'student_group_type', entityId: id, newValue: { name } })
    },
    onError: (e: Error) => toast.error(/duplicate key|unique/i.test(e.message) ? 'That name already exists' : e.message)
  })

  const addGroup = useMutation({
    mutationFn: async ({ typeId, name, order }: { typeId: string; name: string; order: number }) => {
      const { error } = await supabase.from('student_groups').insert({ school_id: schoolId, type_id: typeId, name: name.trim(), sort_order: order })
      if (error) throw error
    },
    onSuccess: (_d, { typeId }) => { refresh(); setNewGroup(g => ({ ...g, [typeId]: '' })) },
    onError: (e: Error) => toast.error(/duplicate key|unique/i.test(e.message) ? 'That group already exists in this type' : e.message)
  })

  const friendlyDeleteError = (e: Error, what: string) =>
    /foreign key|violates/i.test(e.message)
      ? `${what} is still in use — remove its students and any subject restricted to it first.`
      : e.message

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('student_groups').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendlyDeleteError(e, 'This group'))
  })
  const deleteType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('student_group_types').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(/foreign key|violates/i.test(e.message) ? 'Delete this type\'s groups first.' : e.message)
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>

  return (
    <div>
      <PageHeader
        title="Student Groups"
        description="Group your students — by stream (Science / Arts / Commercial), religion, or anything else — so each student automatically gets the right subjects"
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200">
        <Info className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p><strong>How it works.</strong> (1) Create a group type and its groups here. (2) In <em>Subjects → Class Level Offerings</em>, set a subject to <em>Only certain groups</em> —
            e.g. Technical Drawing → Science, Foods &amp; Nutrition → Arts, Christian Religious Studies → Christian, Islamic Studies → Muslim.
            (3) Open a class and put each student in their group. Everyone then has the same number of subjects, and averages only count subjects a student actually takes.</p>
          <p>A student can be in only one group per type (never both Christian and Muslim), and groups are remembered per session and carried forward when you promote a class.</p>
        </div>
      </div>

      {types.length === 0 && (
        <Card className="mb-4">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 mb-3"><Sparkles className="h-4 w-4 text-primary" /><span className="text-sm font-medium">Quick start</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.type}
                  onClick={() => addType.mutate({ name: t.type, groups: t.groups })}
                  disabled={addType.isPending}
                  className="rounded-lg border p-4 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <div className="text-sm font-medium">{t.type}: {t.groups.join(' / ')}</div>
                  <p className="text-xs text-muted-foreground mt-1">{t.blurb}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {types.map(t => (
          <Card key={t.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" />{t.name}</CardTitle>
                <Button
                  variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive"
                  onClick={() => { if (window.confirm(`Delete the "${t.name}" group type? It must have no groups left.`)) deleteType.mutate(t.id) }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {t.groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet — add one below.</p>}
              <div className="flex flex-wrap gap-2">
                {t.groups.map(g => {
                  const inSession = usage?.members.get(g.id) ?? 0
                  const subjectsUsing = usage?.audience.get(g.id) ?? 0
                  const everUsed = (usage?.allTimeMembers.get(g.id) ?? 0) > 0 || subjectsUsing > 0
                  return (
                    <div key={g.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <span className="text-sm font-medium">{g.name}</span>
                      <Badge variant="secondary">{inSession} student{inSession !== 1 ? 's' : ''} now</Badge>
                      {subjectsUsing > 0 && <Badge variant="info">{subjectsUsing} subject{subjectsUsing !== 1 ? 's' : ''}</Badge>}
                      <button
                        onClick={() => deleteGroup.mutate(g.id)}
                        disabled={everUsed}
                        title={everUsed ? 'In use — remove its students and subjects first' : 'Delete group'}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label={`Delete ${g.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 max-w-sm">
                <Input
                  value={newGroup[t.id] ?? ''}
                  onChange={e => setNewGroup(g => ({ ...g, [t.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && (newGroup[t.id] ?? '').trim()) addGroup.mutate({ typeId: t.id, name: newGroup[t.id], order: t.groups.length }) }}
                  placeholder={`Add a ${t.name.toLowerCase()} group…`}
                />
                <Button
                  onClick={() => addGroup.mutate({ typeId: t.id, name: newGroup[t.id] ?? '', order: t.groups.length })}
                  disabled={!(newGroup[t.id] ?? '').trim() || addGroup.isPending}
                >
                  {addGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-2 max-w-md">
              <Input
                value={newType} onChange={e => setNewType(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newType.trim()) addType.mutate({ name: newType, groups: [] }) }}
                placeholder="New group type, e.g. House, Stream, Religion…"
              />
              <Button onClick={() => addType.mutate({ name: newType, groups: [] })} disabled={!newType.trim() || addType.isPending}>
                <Plus className="mr-1.5 h-4 w-4" />Add type
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
