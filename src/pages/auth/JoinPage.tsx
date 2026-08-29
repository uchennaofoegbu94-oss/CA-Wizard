import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2, Key, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import { teacherLimit, tierLabel } from '@/lib/tierLimits'
import { logAudit } from '@/lib/audit'
import type { InviteCode, School } from '@/types'

const schema = z.object({
  code: z.string().min(6, 'Enter your invite code').toUpperCase(),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string(),
  agreedToTerms: z.boolean().refine(v => v === true, { message: 'You must agree to the Terms & Conditions' })
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})

type FormData = z.infer<typeof schema>

export default function JoinPage() {
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const [codeData, setCodeData] = useState<(InviteCode & { school?: School | null }) | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Staff invites (target_role: 'group_admin') carry no school —
  // codeData.school is null for those, same shape everywhere else.
  const isStaffInvite = codeData?.target_role === 'group_admin'

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const codeValue = watch('code')

  const verifyCode = async () => {
    const raw = codeValue?.trim().toUpperCase()
    if (!raw || raw.length < 6) {
      toast.error('Enter the full invite code first')
      return
    }
    setVerifying(true)

    const { data, error } = await supabase
      .from('invite_codes')
      .select('*, school:schools(*)')
      .eq('code', raw)
      .maybeSingle()

    setVerifying(false)

    // Surface the ACTUAL database error instead of a generic message —
    // this is the difference between "invalid code" (doesn't exist)
    // and a permissions/RLS problem, which look identical to the user
    // otherwise but need completely different fixes.
    if (error) {
      toast.error(`Lookup failed: ${error.message}`)
      setCodeData(null)
      return
    }
    if (!data) {
      toast.error(`No invite code found matching "${raw}". Ask your school admin to confirm it.`)
      setCodeData(null)
      return
    }
    if (!data.is_active) {
      toast.error('This invite code has already been used.')
      setCodeData(null)
      return
    }
    if (new Date(data.expires_at) < new Date()) {
      toast.error('This invite code has expired. Ask your school admin for a new one.')
      setCodeData(null)
      return
    }

    setCodeData(data as InviteCode & { school?: School | null })
    toast.success('Code verified!')
  }

  const onSubmit = async (data: FormData) => {
    if (!codeData) {
      toast.error('Please verify your invite code first')
      return
    }

    // The teacher-cap check only applies to school-scoped (teacher)
    // invites — a staff (group_admin) invite has no school and no
    // tier to check against. The real check happens here, before
    // signUp is ever called — not as a DB trigger on profiles, which
    // migration 020 explains would silently orphan the auth account
    // instead of cleanly rejecting it. Re-checked here (not just at
    // invite generation) because a code generated when there was
    // headroom could still be redeemed later after the school filled up.
    if (!isStaffInvite) {
      const cap = teacherLimit(codeData.school?.subscription_tier)
      if (cap !== null) {
        const { data: activeCount, error: countError } = await supabase.rpc('count_active_teachers', { p_school_id: codeData.school_id! })
        if (!countError && (activeCount ?? 0) >= cap) {
          toast.error(`This school has reached its ${cap}-teacher limit for the ${tierLabel(codeData.school?.subscription_tier ?? 'free')} plan. Ask your school admin to upgrade before using this code.`)
          return
        }
      }
    }

    // Atomically claim the code BEFORE creating any account — this is
    // what actually prevents reuse (a plain UPDATE after signUp used
    // to silently fail under RLS for a fresh teacher/group_admin
    // account, so is_active/used_at never changed, no matter how many
    // times a code was redeemed). Claiming first also closes the race
    // where two people verify the same code moments apart: whoever's
    // claim_invite_code call runs first wins, the second gets nothing
    // back and never reaches signUp at all — no orphaned account.
    const { data: claimed, error: claimError } = await supabase.rpc('claim_invite_code', { p_code: codeData.code })
    if (claimError || !claimed || claimed.length === 0) {
      toast.error('This invite code was just used or is no longer valid. Ask your school admin for a new one.')
      setCodeData(null)
      return
    }
    const claimedCode = claimed[0] as InviteCode

    const { error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          role: codeData.target_role,
          // Staff invites are never school-scoped — omit school_id
          // entirely rather than sending it as null, so handle_new_user
          // has nothing to (mis)parse for this account.
          ...(isStaffInvite ? {} : { school_id: codeData.school_id })
        }
      }
    })

    if (signUpError) {
      // Already claimed the code above — release it rather than
      // permanently burning it for a signup that never actually happened.
      await supabase.rpc('release_invite_code', { p_id: claimedCode.id })
      toast.error(signUpError.message)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .update(
          isStaffInvite
            ? { school_id: null, role: codeData.target_role }
            : { school_id: codeData.school_id, role: codeData.target_role }
        )
        .eq('user_id', user.id)
        .select('id')
        .single()

      // Invites only bring a teacher into the school now — no class or
      // subject is attached at signup. A school admin assigns classes
      // and subjects afterward from the Teachers page, which also lets
      // a teacher be assigned multiple subjects across multiple classes.
      // Staff invites bring a group_admin onto the platform with no
      // group assigned yet — a super admin assigns them to an
      // admin_groups row afterward from the Groups page.

      if (newProfile) {
        await supabase.rpc('finalize_invite_code_redemption', { p_id: claimedCode.id, p_used_by: newProfile.id })

        // Same treatment as student creation, which already logs to
        // the audit trail as an admin-initiated action — a teacher
        // joining has no admin actor performing it (it's self-service
        // via invite code), but it's just as worth a durable record of
        // who joined, when, and via which code. Staff (group_admin)
        // joins have no school_id at all; migration 035 is what makes
        // that half of this actually work (a school-less actor
        // couldn't log anything under RLS before it).
        logAudit({
          schoolId: isStaffInvite ? null : codeData.school_id,
          userId: newProfile.id,
          action: 'CREATE',
          entityType: isStaffInvite ? 'staff_joined' : 'teacher_joined',
          entityId: newProfile.id,
          newValue: { invite_code_id: claimedCode.id, role: codeData.target_role }
        })
      }
    }

    toast.success('Account created! Redirecting…')
    navigate(isStaffInvite ? '/group-admin' : '/teacher')
  }

  return (
    <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4 relative">
      <Link
        to="/"
        aria-label="Back to home"
        className="absolute top-4 left-4 flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />Back to home
      </Link>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-3">
            <span className="text-white font-bold text-2xl">CA</span>
          </div>
          <h1 className="text-3xl font-bold text-white">CA-Wizard</h1>
          <p className="text-brand-200 mt-1 text-sm">
            {isStaffInvite ? 'Staff Registration' : 'Teacher Registration'}
          </p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>{isStaffInvite ? 'Join the CA-Wizard Team' : 'Join Your School'}</CardTitle>
            <CardDescription>
              {isStaffInvite
                ? 'Enter the staff invite code from your super admin'
                : 'Enter the invite code from your school admin'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                {!codeData && (
                  <p className="text-xs text-muted-foreground">
                    Click the key button to verify your code before filling out the rest of the form.
                  </p>
                )}
              </div>

              {codeData && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-900">
                      {isStaffInvite ? 'CA-Wizard Platform Team' : codeData.school?.name}
                    </p>
                    <p className="text-xs text-green-700">
                      {codeData.label ?? (isStaffInvite ? 'Group Admin access' : 'Teacher access')}
                    </p>
                  </div>
                  <Badge variant="success">Verified</Badge>
                </div>
              )}

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

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPw ? 'text' : 'password'} {...register('password')} />
                  <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
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

              <div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input"
                    {...register('agreedToTerms')}
                  />
                  <span>
                    I agree to CA-Wizard's{' '}
                    <Link to="/terms" target="_blank" className="text-primary hover:underline">Terms &amp; Conditions</Link>
                  </span>
                </label>
                {errors.agreedToTerms && (
                  <p className="text-xs text-destructive mt-1">{errors.agreedToTerms.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || !codeData}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</> : 'Create Account & Join'}
              </Button>
              {!codeData && (
                <p className="text-xs text-center text-muted-foreground">
                  Verify your invite code above to enable this button
                </p>
              )}
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
