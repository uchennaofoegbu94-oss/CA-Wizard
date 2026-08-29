import { Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SchoolStatus } from '@/types'

// Wraps school_admin (and, in future, teacher) routes.
// A school created via self-serve registration starts as 'pending'
// and must be approved by a Super Admin before its admin can use
// the dashboard. This guard blocks access until that happens,
// regardless of the person's role — a school_admin whose school
// hasn't been approved has nothing safe to manage yet.
export function RequireActiveSchool() {
  const { schoolId, signOut } = useAuth()

  const { data: school, isLoading } = useQuery({
    queryKey: ['school-status-check', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, status')
        .eq('id', schoolId!)
        .single()
      if (error) throw error
      return data as { id: string; name: string; status: SchoolStatus }
    },
    enabled: !!schoolId
  })

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (school && school.status !== 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-4">
        <Card className="w-full max-w-md border-0 shadow-2xl">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-orange-100 flex items-center justify-center mb-4">
              <Clock className="h-7 w-7 text-orange-600" />
            </div>
            <h2 className="text-xl font-bold mb-2">
              {school.status === 'pending' ? 'Pending Approval' : 'School Suspended'}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {school.status === 'pending' ? (
                <>
                  <strong>{school.name}</strong> is awaiting review by our team.
                  You'll be able to access your dashboard once it's approved.
                </>
              ) : (
                <>
                  <strong>{school.name}</strong> has been suspended.
                  Contact support for more information.
                </>
              )}
            </p>
            <Button variant="outline" onClick={() => signOut()} className="w-full">
              <LogOut className="mr-2 h-4 w-4" />Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <Outlet />
}
