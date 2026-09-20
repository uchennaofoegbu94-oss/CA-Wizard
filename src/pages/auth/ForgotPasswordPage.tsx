import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({ email: z.string().email('Enter a valid email') })
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async ({ email }: FormData) => {
    // Deliberately shows the same "check your inbox" message whether or
    // not the address matches an account — a different message for
    // "no account found" would let anyone probe which emails are
    // registered. supabase.auth.resetPasswordForEmail is a public
    // endpoint that behaves this way itself (it doesn't error on an
    // unknown email), so this just doesn't undermine that.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    })
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center auth-gradient-bg p-4 relative">
      <Link to="/auth/login" aria-label="Back to sign in" className="absolute top-4 left-4 flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />Back to sign in
      </Link>
      <div className="w-full max-w-md animate-fade-in">
        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>Enter the email on your account and we'll send you a reset link.</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center py-6 space-y-3">
                <MailCheck className="h-10 w-10 mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).</p>
                <Link to="/auth/login" className="text-sm text-primary font-medium hover:underline inline-block mt-2">Back to sign in</Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input id="email" type="email" placeholder="you@school.edu.ng" autoComplete="email" {...register('email')} />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Send Reset Link'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
