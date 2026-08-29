import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, ShieldAlert, Loader2, Save, BarChart3, LifeBuoy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, Spinner } from '@/components/ui/table'
import toast from 'react-hot-toast'

interface PlatformSettings {
  default_subscription_tier: string
  auto_approve_schools: boolean
  maintenance_mode: boolean
  maintenance_message: string | null
  show_live_counter: boolean
  all_tickets_to_super_admin: boolean
}

export default function SuperAdminSettingsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings').select('*').eq('id', true).single()
      if (error) throw error
      return data as PlatformSettings
    }
  })

  // Diagnostic preview for the Live Counter card below — calls the
  // exact same function the public landing page calls, so a super
  // admin can see precisely what it currently resolves to without
  // needing devtools or direct database access. A toggle that's on
  // but shows nothing on the public page (because both counts
  // happen to band to zero, or because a migration didn't fully
  // apply) is otherwise indistinguishable from "broken."
  const { data: statsPreview, isError: statsError } = useQuery({
    queryKey: ['platform-stats-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_platform_stats')
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row as { enabled: boolean; schools_count: number; teachers_count: number } | null
    }
  })

  const [defaultTier, setDefaultTier] = useState('free')
  const [autoApprove, setAutoApprove] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [showLiveCounter, setShowLiveCounter] = useState(false)
  const [allTicketsToSuperAdmin, setAllTicketsToSuperAdmin] = useState(false)

  useEffect(() => {
    if (settings) {
      setDefaultTier(settings.default_subscription_tier)
      setAutoApprove(settings.auto_approve_schools)
      setMaintenanceMode(settings.maintenance_mode)
      setMaintenanceMessage(settings.maintenance_message ?? '')
      setShowLiveCounter(settings.show_live_counter)
      setAllTicketsToSuperAdmin(settings.all_tickets_to_super_admin)
    }
  }, [settings])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('platform_settings').update({
        default_subscription_tier: defaultTier,
        auto_approve_schools: autoApprove,
        maintenance_mode: maintenanceMode,
        maintenance_message: maintenanceMessage || null,
        show_live_counter: showLiveCounter,
        all_tickets_to_super_admin: allTicketsToSuperAdmin,
        updated_at: new Date().toISOString(),
        updated_by: profile?.id ?? null
      }).eq('id', true)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-settings'] })
      qc.invalidateQueries({ queryKey: ['maintenance-status'] })
      qc.invalidateQueries({ queryKey: ['platform-stats'] })
      toast.success('Platform settings saved')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  return (
    <div>
      <PageHeader title="Platform Settings" description="Configuration that applies across every school on CA-Wizard" />

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />Self-Serve Registration
            </CardTitle>
            <CardDescription>How new schools that sign up through the landing page are handled</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Default plan for new registrations</label>
              <p className="text-xs text-muted-foreground mb-2">
                Used only when a school signs up without picking a plan from the pricing page (e.g. the generic "Register Your School" link, not a specific "Get Started"/"Start Free Trial" button).
              </p>
              <Select value={defaultTier} onValueChange={setDefaultTier}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-4 pt-4 border-t">
              <div>
                <p className="text-sm font-medium">Auto-approve new schools</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When off (default), every self-serve registration starts as "pending" and needs manual approval in Schools.
                  When on, new schools go straight to "active" with no review step.
                </p>
              </div>
              <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
            </div>
          </CardContent>
        </Card>

        <Card className={maintenanceMode ? 'border-destructive/50' : undefined}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />Maintenance Mode
            </CardTitle>
            <CardDescription>
              Blocks every school admin and teacher from the app (they'll see the message below instead). You keep access, so you can turn it back off.
              Does not affect the public landing page or login screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Enable maintenance mode</p>
                {maintenanceMode && <p className="text-xs text-destructive mt-0.5">Currently blocking all non-super-admin access.</p>}
              </div>
              <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Message shown to blocked users</label>
              <Textarea
                value={maintenanceMessage}
                onChange={e => setMaintenanceMessage(e.target.value)}
                placeholder="CA-Wizard is undergoing scheduled maintenance. We'll be back shortly."
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />Live Counter
            </CardTitle>
            <CardDescription>
              Shows a rounded "X schools, Y teachers" stat on the public landing page. Off by default.
              The count is banded down to a round number before it ever leaves the database — e.g. 238 schools shows as "230+", never the exact figure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Show live counter on landing page</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Counts active schools and active teachers platform-wide. Takes effect immediately — no redeploy needed.
                </p>
              </div>
              <Switch checked={showLiveCounter} onCheckedChange={setShowLiveCounter} />
            </div>

            <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-muted-foreground mb-1">Live preview (what the public page sees right now)</p>
              {statsError ? (
                <p className="text-destructive">
                  Couldn't reach get_platform_stats() — most likely migration 030 hasn't been applied to this database yet.
                </p>
              ) : !statsPreview ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : !statsPreview.enabled ? (
                <p className="text-muted-foreground">Toggle is off — save your changes above, then this will reflect it.</p>
              ) : statsPreview.schools_count === 0 && statsPreview.teachers_count === 0 ? (
                <p className="text-muted-foreground">
                  Enabled, but both active-schools and active-teachers currently band to <strong>0</strong> — the public page shows a soft "Just getting started" line instead of numbers. This usually means every school is still <code>pending</code> (not yet approved) or no teacher accounts are marked active.
                </p>
              ) : (
                <p>
                  Schools: <strong>{statsPreview.schools_count}+</strong> · Teachers: <strong>{statsPreview.teachers_count}+</strong>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LifeBuoy className="h-4 w-4" />Early-Stage Support Routing
            </CardTitle>
            <CardDescription>
              For the early period where you want direct visibility into every support request yourself, rather than
              waiting for school admins to escalate. Off by default — the normal tiered routing (teacher → school admin →
              group/platform) is the long-term intended behaviour.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Route all new tickets straight to me</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every new ticket — from any teacher or school admin — starts at the platform tier instead of the
                  normal school/group tier, so it lands directly in your queue. Only affects tickets submitted{' '}
                  <em>after</em> you turn this on — tickets already in progress keep following their existing path and
                  won't jump to you. Turning it back off simply means the next new ticket follows normal routing again.
                </p>
              </div>
              <Switch checked={allTicketsToSuperAdmin} onCheckedChange={setAllTicketsToSuperAdmin} />
            </div>
          </CardContent>
        </Card>

        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
