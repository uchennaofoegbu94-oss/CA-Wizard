import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { School as SchoolIcon, LifeBuoy, Building2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import type { School, SupportTicket } from '@/types'

export default function GroupAdminHomePage() {
  const { profile } = useAuth()

  // A group admin's group is looked up server-side via
  // current_group_id() inside RLS — we still need the group's own
  // row client-side for its name/id, found by matching group_admin_id.
  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ['my-admin-group', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_groups')
        .select('*')
        .eq('group_admin_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; name: string } | null
    },
    enabled: !!profile?.id
  })

  const { data: schools = [], isLoading: loadingSchools } = useQuery({
    queryKey: ['my-group-schools', group?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .eq('group_id', group!.id)
        .order('name')
      if (error) throw error
      return data as School[]
    },
    enabled: !!group?.id
  })

  // Tickets currently sitting at the group escalation level for this
  // group admin's schools — RLS (ticket_group_admin_read) already
  // scopes this to the caller's group, this just fetches the set to
  // derive per-school open counts client-side.
  const { data: openTickets = [] } = useQuery({
    queryKey: ['my-group-open-tickets', group?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, school_id, status')
        .eq('group_id', group!.id)
        .not('status', 'in', '(resolved,closed)')
      if (error) throw error
      return data as Pick<SupportTicket, 'id' | 'school_id' | 'status'>[]
    },
    enabled: !!group?.id
  })

  const openCountFor = (schoolId: string) => openTickets.filter(t => t.school_id === schoolId).length

  const isLoading = loadingGroup || loadingSchools

  return (
    <div>
      <PageHeader
        title="My Schools"
        description={group ? `Schools you oversee under ${group.name}` : 'You are not yet assigned to a group'}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : !group ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="No group assigned yet"
          description="A super admin needs to assign you to a group before schools will appear here. Reach out to them, or check Support Tickets in the meantime — platform-level tickets are still visible to you."
        />
      ) : schools.length === 0 ? (
        <EmptyState
          icon={<SchoolIcon className="h-10 w-10" />}
          title="No schools in your group yet"
          description="Once a super admin adds schools to this group, they'll show up here with their open ticket counts."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schools.map(school => {
            const count = openCountFor(school.id)
            return (
              <Link key={school.id} to="/group-admin/tickets">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <SchoolIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="font-semibold truncate">{school.name}</p>
                      </div>
                      {count > 0 && (
                        <Badge variant="destructive" className="shrink-0">{count}</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground truncate">{school.address ?? 'No address on file'}</p>
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <LifeBuoy className="h-3.5 w-3.5" />
                      {count === 0 ? 'No open tickets' : `${count} open ticket${count !== 1 ? 's' : ''} awaiting you`}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
