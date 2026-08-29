import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2, School, CheckCircle2, Sparkles, ArrowLeft, Building2, Mail, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription,
  CardFooter, CardHeader, CardTitle
} from '@/components/ui/card'
import { FormField, FormGrid, FormSection } from '@/components/ui/form-field'
import toast from 'react-hot-toast'

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional'
}

const schema = z.object({
  schoolName:     z.string().min(3, 'School name must be at least 3 characters'),
  address:        z.string().optional(),
  phone:          z.string().optional(),
  motto:          z.string().optional(),
  principalName:  z.string().optional(),
  firstName:      z.string().min(1, 'Required'),
  lastName:       z.string().min(1, 'Required'),
  email:          z.string().email('Enter a valid email'),
  password:       z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string(),
  agreedToTerms:  z.boolean().refine(v => v === true, { message: 'You must agree to the Terms & Conditions to register' })
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})

type FormData = z.infer<typeof schema>

export default function RegisterSchoolPage() {
  const [showPw, setShowPw] = useState(false)
  const [submitted, setSubmitted] = useState<{ schoolName: string } | null>(null)
  const [searchParams] = useSearchParams()

  // Onboarding flow, step 1: what kind of institution is this for.
  // Confirmed scope: only the school branch (tiers 1/2 — Starter/
  // Professional) is actually built. University/College is a real
  // option in the picker, but selecting it goes straight to a
  // "Coming Soon" panel — no schema, no form, no registration path.
  // It routes to the same Enterprise "Contact Sales" mailto the
  // pricing page already uses, rather than inventing a second
  // parallel contact mechanism for the same underlying need.
  type InstitutionType = 'school' | 'university' | null
  const [institutionType, setInstitutionType] = useState<InstitutionType>(null)

  // Carried over from the landing page pricing section's "Get Started" /
  // "Start Free Trial" buttons — e.g. ?plan=professional. Falls back to
  // 'free' (silently, no UI badge) for anyone who lands here directly.
  const rawPlan = (searchParams.get('plan') ?? '').toLowerCase()
  const plan = rawPlan in PLAN_LABELS ? rawPlan : null

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    // Step 1 — create the school (status: pending) via the
    // SECURITY DEFINER RPC. This is safe to call before auth
    // because the function only ever creates 'pending' schools.
    const { data: schoolResult, error: schoolError } = await supabase.rpc('register_school_public', {
      p_name: data.schoolName,
      p_address: data.address || null,
      p_phone: data.phone || null,
      p_email: data.email,
      p_motto: data.motto || null,
      p_principal_name: data.principalName || null,
      p_subscription_tier: plan ?? 'free'
    })

    if (schoolError || !schoolResult?.[0]) {
      toast.error(schoolError?.message ?? 'Could not register school. Try a different school name.')
      return
    }

    const schoolId = schoolResult[0].id

    // Step 2 — create the admin account, linked to that school
    // via signup metadata. handle_new_user validates the school_id
    // actually exists before trusting it.
    const { error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          role: 'school_admin',
          school_id: schoolId
        }
      }
    })

    if (signUpError) {
      // Step 1 already committed the school — without this, a failed
      // signup (bad email format Supabase's own validator rejects,
      // rate limit, network blip) leaves a permanently orphaned
      // 'pending' school with no admin who can ever log into it. This
      // is safe to call even if it turns out the school ISN'T actually
      // orphaned (e.g. a retry raced with a real success elsewhere) —
      // see migration 018's own safety condition.
      await supabase.rpc('rollback_pending_school_registration', { p_school_id: schoolId })
      toast.error(`Account setup failed: ${signUpError.message}. Please check your details and try again.`)
      return
    }

    setSubmitted({ schoolName: data.schoolName })
  }

  // ── Step 1: institution type ────────────────────────────────
  if (institutionType === null) {
    return (
      <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4 relative">
        <Link
          to="/"
          aria-label="Back to home"
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />Back to home
        </Link>
        <div className="w-full max-w-2xl animate-fade-in text-center">
          <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-3 mx-auto">
            <School className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">What are you setting up?</h1>
          <p className="text-brand-200 mt-1 text-sm mb-8">This just decides which registration path to show you.</p>

          <div className="grid sm:grid-cols-2 gap-4 text-left">
            <button type="button" onClick={() => setInstitutionType('school')}>
              <Card className="h-full border-0 shadow-2xl hover:ring-2 hover:ring-primary transition-shadow cursor-pointer">
                <CardContent className="pt-6 pb-6">
                  <School className="h-8 w-8 text-primary mb-3" />
                  <p className="font-semibold">Primary / Secondary School</p>
                  <p className="text-sm text-muted-foreground mt-1">Register your school and get started right away — Starter or Professional plans.</p>
                </CardContent>
              </Card>
            </button>
            <button type="button" onClick={() => setInstitutionType('university')}>
              <Card className="h-full border-0 shadow-2xl hover:ring-2 hover:ring-primary transition-shadow cursor-pointer">
                <CardContent className="pt-6 pb-6">
                  <Building2 className="h-8 w-8 text-primary mb-3" />
                  <p className="font-semibold">University / College</p>
                  <p className="text-sm text-muted-foreground mt-1">Larger-scale, multi-department deployments — our Enterprise plan.</p>
                </CardContent>
              </Card>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── University/College branch: Coming Soon, no schema ────────
  if (institutionType === 'university') {
    return (
      <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4">
        <Card className="w-full max-w-md border-0 shadow-2xl animate-fade-in">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Clock className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Self-Serve Coming Soon</h2>
            <p className="text-sm text-muted-foreground mb-6">
              University and multi-department deployments need a bit more setup than a self-serve form can handle right now —
              custom integrations, SLAs, and account structure. Our team can get you started manually in the meantime.
            </p>
            <Button asChild className="w-full">
              <a href="mailto:sales@ca-wizard.app?subject=Enterprise%20Plan%20Inquiry">
                <Mail className="mr-2 h-4 w-4" />Contact Sales
              </a>
            </Button>
            <button
              type="button"
              onClick={() => setInstitutionType(null)}
              className="text-sm text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />Back
            </button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4">
        <Card className="w-full max-w-md border-0 shadow-2xl animate-fade-in">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <h2 className="text-xl font-bold mb-2">Registration Received</h2>
            <p className="text-sm text-muted-foreground mb-6">
              <strong>{submitted.schoolName}</strong> has been submitted for approval.
              You'll be able to sign in once our team activates your school —
              this usually takes less than 24 hours.
            </p>
            <Button asChild className="w-full">
              <Link to="/auth/login">Back to Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4 py-10 relative">
      <button
        type="button"
        onClick={() => setInstitutionType(null)}
        aria-label="Back"
        className="absolute top-4 left-4 flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />Back
      </button>
      <div className="w-full max-w-lg animate-fade-in">
        <div className="flex flex-col items-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-3">
            <School className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Register Your School</h1>
          <p className="text-brand-200 mt-1 text-sm">Get started with CA-Wizard</p>
          {plan && (
            <Badge variant="default" className="mt-3 gap-1">
              <Sparkles className="h-3 w-3" />{PLAN_LABELS[plan]} plan selected
            </Badge>
          )}
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>School & Admin Details</CardTitle>
            <CardDescription>
              Your school will be reviewed and activated by our team before you can sign in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <FormSection title="School Information">
                <FormField label="School Name" error={errors.schoolName?.message} required htmlFor="schoolName">
                  <Input id="schoolName" placeholder="Mirror International School" {...register('schoolName')} />
                </FormField>
                <FormGrid cols={2}>
                  <FormField label="Principal's Name" htmlFor="principalName">
                    <Input id="principalName" placeholder="Mr. Okafor" {...register('principalName')} />
                  </FormField>
                  <FormField label="Phone" htmlFor="phone">
                    <Input id="phone" placeholder="+234-800-000-0000" {...register('phone')} />
                  </FormField>
                </FormGrid>
                <FormField label="Address" htmlFor="address">
                  <Textarea id="address" rows={2} placeholder="123 School Road, Port Harcourt" {...register('address')} />
                </FormField>
                <FormField label="School Motto" htmlFor="motto">
                  <Input id="motto" placeholder="Excellence Through Knowledge" {...register('motto')} />
                </FormField>
              </FormSection>

              <FormSection title="Your Admin Account">
                <FormGrid cols={2}>
                  <FormField label="First Name" error={errors.firstName?.message} required htmlFor="firstName">
                    <Input id="firstName" {...register('firstName')} />
                  </FormField>
                  <FormField label="Last Name" error={errors.lastName?.message} required htmlFor="lastName">
                    <Input id="lastName" {...register('lastName')} />
                  </FormField>
                </FormGrid>
                <FormField label="Email" error={errors.email?.message} required htmlFor="email">
                  <Input id="email" type="email" placeholder="you@school.edu.ng" {...register('email')} />
                </FormField>
                <FormGrid cols={2}>
                  <FormField label="Password" error={errors.password?.message} required htmlFor="password">
                    <div className="relative">
                      <Input id="password" type={showPw ? 'text' : 'password'} {...register('password')} />
                      <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormField>
                  <FormField label="Confirm Password" error={errors.confirmPassword?.message} required htmlFor="confirmPassword">
                    <Input id="confirmPassword" type={showPw ? 'text' : 'password'} {...register('confirmPassword')} />
                  </FormField>
                </FormGrid>
              </FormSection>

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
                    {' '}on behalf of my school.
                  </span>
                </label>
                {errors.agreedToTerms && (
                  <p className="text-xs text-destructive mt-1">{errors.agreedToTerms.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
                  : 'Register School'
                }
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
