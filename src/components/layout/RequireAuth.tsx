import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'
import { Spinner } from '@/components/ui/table'

interface RequireAuthProps {
  allowedRoles?: UserRole[]
  redirectTo?: string
}

export function RequireAuth({ allowedRoles, redirectTo = '/auth/login' }: RequireAuthProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user || !profile) {
    return <Navigate to={redirectTo} replace />
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    // Redirect to role's home
    const homeMap: Record<UserRole, string> = {
      super_admin: '/super-admin',
      school_admin: '/school',
      teacher: '/teacher'
    }
    return <Navigate to={homeMap[profile.role]} replace />
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

  if (user && profile) {
    const homeMap: Record<UserRole, string> = {
      super_admin: '/super-admin',
      school_admin: '/school',
      teacher: '/teacher'
    }
    return <Navigate to={homeMap[profile.role]} replace />
  }

  return <Outlet />
}
