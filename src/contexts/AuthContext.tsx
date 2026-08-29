import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import type { Profile, UserRole } from '@/types'

interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: Profile | null
  role: UserRole | null
  schoolId: string | null
  subscriptionTier: string | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (data: SignUpData) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

interface SignUpData {
  email: string
  password: string
  firstName: string
  lastName: string
  role?: UserRole
  schoolId?: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Uses a SECURITY DEFINER RPC that bypasses RLS.
  // auth.uid() inside the function still scopes the result to the calling user —
  // so this is secure: each user can only ever get their own row back.
  const fetchProfile = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_my_profile')
    if (error) {
      console.error('[AuthContext] fetchProfile RPC error:', error.message, error.code)
      return
    }
    if (Array.isArray(data) && data.length > 0) {
      const p = data[0] as Profile
      setProfile(p)
      // Super admins aren't attached to a single school, so there's no
      // tier to fetch for them — tier-gating simply doesn't apply.
      if (p.school_id) {
        const { data: school } = await supabase.from('schools').select('subscription_tier').eq('id', p.school_id).single()
        setSubscriptionTier(school?.subscription_tier ?? null)
      } else {
        setSubscriptionTier(null)
      }
    } else {
      console.warn('[AuthContext] fetchProfile: RPC returned no rows')
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    await fetchProfile()
  }, [fetchProfile])

  useEffect(() => {
    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile().finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Show loading spinner in RequireGuest immediately on sign-in
        // so the login form disappears and the user sees a spinner
        // while the profile RPC resolves
        if (event === 'SIGNED_IN') setLoading(true)

        setSession(session)
        setUser(session?.user ?? null)

        if (session?.user) {
          await fetchProfile()
        } else {
          setProfile(null)
          setSubscriptionTier(null)
        }

        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // signIn just authenticates — profile loading is handled by onAuthStateChange above
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data.user) {
      // Fire-and-forget: log the login against the audit trail. We look
      // school_id up directly rather than waiting on the profile state
      // (which hasn't loaded yet — onAuthStateChange resolves it after
      // this function returns) so this doesn't delay the sign-in itself.
      supabase.from('profiles').select('school_id').eq('id', data.user.id).single()
        .then(({ data: row }) => {
          logAudit({ schoolId: row?.school_id ?? null, userId: data.user!.id, action: 'LOGIN', entityType: 'auth_session' })
        })
    }
    return { error: error?.message ?? null }
  }

  const signUp = async ({ email, password, firstName, lastName, role, schoolId }: SignUpData) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role: role ?? 'teacher',
          school_id: schoolId ?? null
        }
      }
    })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    // Capture before clearing — profile is about to be nulled below,
    // and we still want this logout attributed to who it was.
    if (profile) {
      logAudit({ schoolId: profile.school_id, userId: profile.id, action: 'LOGOUT', entityType: 'auth_session' })
    }
    await supabase.auth.signOut()
    setProfile(null)
    setSubscriptionTier(null)
    setUser(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      role: profile?.role ?? null,
      schoolId: profile?.school_id ?? null,
      subscriptionTier,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
