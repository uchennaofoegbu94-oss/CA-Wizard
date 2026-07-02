import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import toast from 'react-hot-toast'
import type { UserRole } from '@/types'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters')
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const { signIn, profile } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const onSubmit = async (data: FormData) => {
    const { error } = await signIn(data.email, data.password)
    if (error) {
      toast.error(error)
      return
    }
    // Navigate based on role — profile will be loaded by AuthContext
    // We re-read from the DOM after signIn completes
    // A slight wait for the authChange event to fire
    await new Promise(r => setTimeout(r, 300))
    const role = profile?.role as UserRole | null
    const homeMap: Record<UserRole, string> = {
      super_admin: '/super-admin',
      school_admin: '/school',
      teacher: '/teacher'
    }
    navigate(role ? homeMap[role] : '/teacher')
    toast.success('Welcome back!')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-3">
            <span className="text-white font-bold text-2xl">CA</span>
          </div>
          <h1 className="text-3xl font-bold text-white">CA-Wizard</h1>
          <p className="text-brand-200 mt-1 text-sm">School Assessment Management</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@school.edu.ng"
                  autoComplete="email"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
                ) : 'Sign In'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground text-center">
              Teacher joining a school?{' '}
              <Link to="/auth/join" className="text-primary font-medium hover:underline">
                Use an invite code
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
