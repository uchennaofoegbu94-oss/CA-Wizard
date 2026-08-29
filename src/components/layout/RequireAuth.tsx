import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/types'
import { Spinner } from '@/components/ui/table'
import { MaintenancePage } from '@/components/layout/MaintenancePage'

const HOME_MAP: Record<UserRole, string> = {
  super_admin:  '/super-admin',
  school_admin: '/school',
  teacher:      '/teacher',
  group_admin:  '/group-admin'
}

interface RequireAuthProps {
  allowedRoles?: UserRole[]
  redirectTo?: string
}

export function RequireAuth({ allowedRoles, redirectTo = '/auth/login' }: RequireAuthProps) {
  const { user, profile, loading, signOut } = useAuth()

  // Polled lightly (5 min) rather than on every navigation — maintenance
  // mode being on for up to 5 extra minutes after a super admin flips it
  // is an acceptable trade against querying this on every route change.
  const { data: maintenance } = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_maintenance_status')
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000
  })

  // CRITICAL: signOut must NEVER be called during render — it triggers
  // onAuthStateChange which causes a re-render cascade (the "Maximum
  // update depth exceeded" loop). useEffect guarantees it fires as a
  // side-effect, after render completes, exactly once per dependency change.
  useEffect(() => {
    if (!loading && user && profile && !profile.is_active) {
      signOut()
    }
  }, [loading, user, profile, signOut])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // Not authenticated or suspended (is_active = false)
  if (!user || !profile || !profile.is_active) {
    return <Navigate to={redirectTo} replace />
  }

  // Maintenance mode blocks everyone except super_admin, who needs
  // access specifically to be able to turn it back off again.
  if (maintenance?.maintenance_mode && profile.role !== 'super_admin') {
    return <MaintenancePage message={maintenance.maintenance_message} />
  }

  // Authenticated but wrong role for this section
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={HOME_MAP[profile.role]} replace />
  }

  return <Outlet />
}

export function RequireGuest() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // User exists but profile hasn't resolved yet — show spinner,
  // don't flash the login form
  if (user && !profile) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // Fully authenticated — send to the right dashboard
  if (user && profile) {
    return <Navigate to={HOME_MAP[profile.role]} replace />
  }

  // No session — render the login / register / join page
  return <Outlet />
}
