import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, User, KeyRound, Eye, EyeOff, Camera } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { uploadTeacherPhoto } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import { initials } from '@/lib/utils'

const detailsSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name:  z.string().min(1, 'Required'),
  phone:      z.string().optional()
})

const passwordSchema = z.object({
  newPassword: z.string().min(8, 'At least 8 characters'),
  confirmPassword: z.string()
}).refine(d => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})

type DetailsForm = z.infer<typeof detailsSchema>
type PasswordForm = z.infer<typeof passwordSchema>

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  teacher: 'Teacher'
}

export default function ProfilePage() {
  const { profile, refreshProfile, schoolId } = useAuth()
  const [showPw, setShowPw] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoUpload = async (file: File) => {
    if (!profile || !schoolId) return
    setUploadingPhoto(true)
    const { url, error } = await uploadTeacherPhoto(schoolId, profile.id, file)
    setUploadingPhoto(false)
    if (error || !url) {
      toast.error(error ?? 'Upload failed')
      return
    }
    const { error: dbError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id)
    if (dbError) {
      toast.error(dbError.message)
      return
    }
    await refreshProfile()
    toast.success('Photo updated')
  }

  const detailsForm = useForm<DetailsForm>({ resolver: zodResolver(detailsSchema) })
  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })

  useEffect(() => {
    if (profile) {
      detailsForm.reset({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone ?? ''
      })
    }
  }, [profile, detailsForm])

  const saveDetails = async (values: DetailsForm) => {
    if (!profile) return
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: values.first_name, last_name: values.last_name, phone: values.phone || null })
      .eq('id', profile.id)

    if (error) {
      toast.error(error.message)
      return
    }
    await refreshProfile()
    toast.success('Profile updated')
  }

  const changePassword = async (values: PasswordForm) => {
    const { error } = await supabase.auth.updateUser({ password: values.newPassword })
    if (error) {
      toast.error(error.message)
      return
    }
    passwordForm.reset({ newPassword: '', confirmPassword: '' })
    toast.success('Password changed')
  }

  if (!profile) return null

  return (
    <div>
      <PageHeader title="My Profile" description="Update your account details and password" />

      <div className="max-w-xl space-y-6">
        {/* Identity card */}
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="relative shrink-0">
              <Avatar className="h-16 w-16">
                <AvatarImage src={profile.avatar_url ?? ''} />
                <AvatarFallback className="bg-brand-100 text-brand-700 text-xl">
                  {initials(profile.first_name, profile.last_name)}
                </AvatarFallback>
              </Avatar>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f) }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700"
              >
                {uploadingPhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
              </button>
            </div>
            <div>
              <p className="font-semibold text-lg">{profile.first_name} {profile.last_name}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <Badge variant="outline" className="mt-1">{ROLE_LABEL[profile.role] ?? profile.role}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Edit details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" />Personal Details</CardTitle>
            <CardDescription>Your name and phone number</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={detailsForm.handleSubmit(saveDetails)} className="space-y-4">
              <FormGrid cols={2}>
                <FormField label="First Name" error={detailsForm.formState.errors.first_name?.message} required htmlFor="pfname">
                  <Input id="pfname" {...detailsForm.register('first_name')} />
                </FormField>
                <FormField label="Last Name" error={detailsForm.formState.errors.last_name?.message} required htmlFor="plname">
                  <Input id="plname" {...detailsForm.register('last_name')} />
                </FormField>
              </FormGrid>
              <FormField label="Phone" htmlFor="pphone">
                <Input id="pphone" placeholder="+234-800-000-0000" {...detailsForm.register('phone')} />
              </FormField>
              <div className="flex justify-end">
                <Button type="submit" disabled={detailsForm.formState.isSubmitting}>
                  {detailsForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" />Change Password</CardTitle>
            <CardDescription>Choose a new password for your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit(changePassword)} className="space-y-4">
              <FormField label="New Password" error={passwordForm.formState.errors.newPassword?.message} required htmlFor="newPw">
                <div className="relative">
                  <Input id="newPw" type={showPw ? 'text' : 'password'} {...passwordForm.register('newPassword')} />
                  <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>
              <FormField label="Confirm New Password" error={passwordForm.formState.errors.confirmPassword?.message} required htmlFor="confirmPw">
                <Input id="confirmPw" type={showPw ? 'text' : 'password'} {...passwordForm.register('confirmPassword')} />
              </FormField>
              <div className="flex justify-end">
                <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                  {passwordForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change Password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
