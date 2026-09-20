import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import toast from 'react-hot-toast'

const schema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string()
}).refine(d => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
type FormData = z.infer<typeof schema>

// Deliberately NOT wrapped in RequireGuest/RequireAuth (see App.tsx) —
// following the emailed link makes Supabase establish a temporary
// "recovery" session, which AuthContext's onAuthStateChange treats
// exactly like a normal sign-in (sets user + profile). Wrapping this
// page in RequireGuest would bounce the person straight to their
// dashboard before they ever get to set a new password.
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) })

  useEffect(() => {
    // onAuthStateChange (in AuthContext, mounted above this page) has
    // already parsed the recovery token from the URL by the time we
    // get here, so a plain getSession() tells us whether the link was
    // valid — no need to touch the URL hash ourselves.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setReady(session ? 'valid' : 'invalid')
    })
  }, [])

  const onSubmit = async ({ password }: FormData) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Password updated — please sign in again')
    // Sign out deliberately rather than letting the recovery session
    // stand in as a normal one, so there's no ambiguity about session
    // freshness/duration after a password reset.
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4">
      <div className="w-full max-w-md animate-fade-in">
        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            {ready === 'checking' && (
              <p className="text-sm text-muted-foreground text-center py-6">Verifying your link…</p>
            )}

            {ready === 'invalid' && (
              <div className="text-center py-6 space-y-3">
                <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
                <p className="text-sm text-muted-foreground">This link is invalid or has expired. Reset links are only valid for a short time.</p>
                <Link to="/auth/forgot-password" className="text-sm text-primary font-medium hover:underline inline-block mt-2">Request a new link</Link>
              </div>
            )}

            {ready === 'valid' && (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password')} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input id="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('confirmPassword')} />
                  {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating…</> : 'Update Password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
