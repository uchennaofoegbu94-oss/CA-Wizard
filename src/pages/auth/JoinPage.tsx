import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2, Key } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import type { InviteCode, School } from '@/types'
import { isExpired } from '@/lib/utils'

const schema = z.object({
  code: z.string().min(6, 'Enter your invite code').toUpperCase(),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string()
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})

type FormData = z.infer<typeof schema>

export default function JoinPage() {
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const [codeData, setCodeData] = useState<(InviteCode & { school?: School }) | null>(null)
  const [verifying, setVerifying] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const codeValue = watch('code')

  const verifyCode = async () => {
    const raw = codeValue?.trim().toUpperCase()
    if (!raw || raw.length < 6) return
    setVerifying(true)
    const { data, error } = await supabase
      .from('invite_codes')
      .select('*, school:schools(*)')
      .eq('code', raw)
      .single()

    setVerifying(false)

    if (error || !data) {
      toast.error('Invalid invite code')
      setCodeData(null)
      return
    }
    if (!data.is_active) {
      toast.error('This invite code has already been used')
      setCodeData(null)
      return
    }
    if (isExpired(data.expires_at)) {
      toast.error('This invite code has expired')
      setCodeData(null)
      return
    }
    setCodeData(data as InviteCode & { school?: School })
    toast.success('Code verified!')
  }

  const onSubmit = async (data: FormData) => {
    if (!codeData) {
      toast.error('Please verify your invite code first')
      return
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          role: 'teacher',
          school_id: codeData.school_id
        }
      }
    })

    if (signUpError) {
      toast.error(signUpError.message)
      return
    }

    // Update profile with school_id and mark invite used
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .update({ school_id: codeData.school_id, role: 'teacher' })
        .eq('user_id', user.id)

      await supabase
        .from('invite_codes')
        .update({ used_by: user.id, used_at: new Date().toISOString(), is_active: false })
        .eq('id', codeData.id)
    }

    toast.success('Account created! Redirecting…')
    navigate('/teacher')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-3">
            <span className="text-white font-bold text-2xl">CA</span>
          </div>
          <h1 className="text-3xl font-bold text-white">CA-Wizard</h1>
          <p className="text-brand-200 mt-1 text-sm">Teacher Registration</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>Join Your School</CardTitle>
            <CardDescription>Enter the invite code from your school admin</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Invite Code */}
              <div className="space-y-1.5">
                <Label htmlFor="code">Invite Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
                    placeholder="e.g. ABC12345"
                    className="uppercase font-mono tracking-widest"
                    {...register('code')}
                    onChange={e => {
                      setValue('code', e.target.value.toUpperCase())
                      setCodeData(null)
                    }}
                  />
                  <Button type="button" variant="outline" onClick={verifyCode} disabled={verifying}>
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
              </div>

              {/* School Preview */}
              {codeData && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-900">{codeData.school?.name}</p>
                    <p className="text-xs text-green-700">{codeData.label ?? 'Teacher access'}</p>
                  </div>
                  <Badge variant="success">Verified</Badge>
                </div>
              )}

              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" {...register('firstName')} />
                  {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" {...register('lastName')} />
                  {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPw ? 'text' : 'password'} {...register('password')} />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type={showPw ? 'text' : 'password'} {...register('confirmPassword')} />
                {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || !codeData}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</> : 'Create Account & Join'}
              </Button>
            </form>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-muted-foreground text-center w-full">
              Already have an account?{' '}
              <Link to="/auth/login" className="text-primary font-medium hover:underline">Sign in</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
