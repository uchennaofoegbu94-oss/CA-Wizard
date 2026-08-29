import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Settings, Image as ImageIcon, Palette, Upload, Stamp, PenLine } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  uploadSchoolLogo, uploadSchoolWatermark,
  uploadPrincipalSignature, uploadTeacherSignature, uploadSchoolStamp
} from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import toast from 'react-hot-toast'
import type { School } from '@/types'

const schema = z.object({
  name:           z.string().min(3, 'Name must be at least 3 characters'),
  abbreviation:   z.string().max(10, 'Keep it short — this appears in every admission number').optional(),
  email:          z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone:          z.string().optional(),
  address:        z.string().optional(),
  motto:          z.string().optional(),
  principal_name: z.string().optional()
})

type FormData = z.infer<typeof schema>

type ImageAsset = 'logo' | 'watermark' | 'principal_signature' | 'teacher_signature' | 'stamp'

const ASSET_CONFIG: Record<ImageAsset, {
  label: string
  hint?: string
  column: keyof Pick<School, 'logo_url' | 'watermark_url' | 'principal_signature_url' | 'teacher_signature_url' | 'school_stamp_url'>
  uploader: (schoolId: string, file: File) => Promise<{ url: string | null; error: string | null }>
  previewClass?: string
}> = {
  logo:                { label: 'School Logo',              column: 'logo_url',                uploader: uploadSchoolLogo },
  watermark:           { label: 'Report Card Watermark',     hint: 'Shown faintly behind report card content', column: 'watermark_url', uploader: uploadSchoolWatermark, previewClass: 'opacity-50' },
  principal_signature: { label: "Principal's Signature",     hint: 'Appears above the Principal signature line', column: 'principal_signature_url', uploader: uploadPrincipalSignature },
  teacher_signature:   { label: "Class Teacher's Signature",  hint: 'Appears above the Class Teacher signature line', column: 'teacher_signature_url', uploader: uploadTeacherSignature },
  stamp:               { label: 'School Stamp',               hint: 'Overlaid near the Principal signature to authenticate the document', column: 'school_stamp_url', uploader: uploadSchoolStamp }
}

export default function SettingsPage() {
  const { schoolId } = useAuth()
  const qc = useQueryClient()
  const fileInputRefs = useRef<Record<ImageAsset, HTMLInputElement | null>>({
    logo: null, watermark: null, principal_signature: null, teacher_signature: null, stamp: null
  })
  const [uploading, setUploading] = useState<ImageAsset | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#1e3a8a')
  const [secondaryColor, setSecondaryColor] = useState('#3b82f6')

  const { data: school, isLoading } = useQuery({
    queryKey: ['school-settings', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  const form = useForm<FormData>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (school) {
      form.reset({
        name: school.name,
        abbreviation: school.abbreviation ?? '',
        email: school.email ?? '',
        phone: school.phone ?? '',
        address: school.address ?? '',
        motto: school.motto ?? '',
        principal_name: school.principal_name ?? ''
      })
      setPrimaryColor(school.primary_color)
      setSecondaryColor(school.secondary_color)
    }
  }, [school, form])

  const save = useMutation({
    mutationFn: async (values: FormData) => {
      const { error } = await supabase.from('schools').update({ ...values, updated_at: new Date().toISOString() }).eq('id', schoolId!)
      if (error) throw error
    },
    onSuccess: () => toast.success('Settings saved'),
    onError: (e: Error) => toast.error(e.message)
  })

  const saveColors = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('schools').update({ primary_color: primaryColor, secondary_color: secondaryColor }).eq('id', schoolId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school-settings', schoolId] })
      toast.success('Brand colors updated')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const handleAssetUpload = async (asset: ImageAsset, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !schoolId) return
    const config = ASSET_CONFIG[asset]
    setUploading(asset)
    const { url, error } = await config.uploader(schoolId, file)
    setUploading(null)
    if (error || !url) {
      toast.error(error ?? 'Upload failed')
      return
    }
    const { error: dbError } = await supabase.from('schools').update({ [config.column]: url }).eq('id', schoolId)
    if (dbError) {
      toast.error(dbError.message)
      return
    }
    qc.invalidateQueries({ queryKey: ['school-settings', schoolId] })
    toast.success(`${config.label} updated`)
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  const renderAssetUploader = (asset: ImageAsset, icon: React.ReactNode) => {
    const config = ASSET_CONFIG[asset]
    const currentUrl = school?.[config.column]
    return (
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-lg border flex items-center justify-center bg-muted overflow-hidden shrink-0">
          {currentUrl ? (
            <img src={currentUrl} alt={config.label} className={`h-full w-full object-contain ${config.previewClass ?? ''}`} />
          ) : icon}
        </div>
        <div>
          <p className="text-sm font-medium mb-1">{config.label}</p>
          {config.hint && <p className="text-xs text-muted-foreground mb-1.5">{config.hint}</p>}
          <input
            ref={el => { fileInputRefs.current[asset] = el }}
            type="file" accept="image/*" className="hidden"
            onChange={e => handleAssetUpload(asset, e)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRefs.current[asset]?.click()} disabled={uploading === asset}>
            {uploading === asset ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
            Upload
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="School Settings" description="Update your school's profile, branding, and information" />

      <div className="max-w-2xl space-y-6">
        <Card className="border-brand-200 bg-brand-50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-900">{school?.name}</p>
                <p className="text-xs text-brand-600">slug: {school?.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={school?.status === 'active' ? 'success' : 'destructive'} className="capitalize">{school?.status}</Badge>
                <Badge variant="outline" className="capitalize">{school?.subscription_tier}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Branding */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" />Branding</CardTitle>
            <CardDescription>Your logo, watermark, and colors appear on report cards and transcripts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderAssetUploader('logo', <ImageIcon className="h-6 w-6 text-muted-foreground" />)}
            {renderAssetUploader('watermark', <ImageIcon className="h-6 w-6 text-muted-foreground" />)}

            <div>
              <p className="text-sm font-medium mb-2">Brand Colors</p>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer border" />
                  Primary
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer border" />
                  Secondary
                </label>
                <Button size="sm" onClick={() => saveColors.mutate()} disabled={saveColors.isPending}>
                  {saveColors.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Save Colors
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signatures & Stamp */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Stamp className="h-4 w-4" />Signatures &amp; Stamp</CardTitle>
            <CardDescription>Authenticate report cards with a scanned signature and school stamp — no printing and hand-signing required.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderAssetUploader('principal_signature', <PenLine className="h-6 w-6 text-muted-foreground" />)}
            {renderAssetUploader('teacher_signature', <PenLine className="h-6 w-6 text-muted-foreground" />)}
            {renderAssetUploader('stamp', <Stamp className="h-6 w-6 text-muted-foreground" />)}
          </CardContent>
        </Card>

        {/* School info */}
        <form onSubmit={form.handleSubmit(v => save.mutate(v))} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Settings className="h-4 w-4" />School Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="School Name" error={form.formState.errors.name?.message} required htmlFor="sname">
                <Input id="sname" {...form.register('name')} />
              </FormField>
              <FormField
                label="Abbreviation"
                hint="Auto-suggested from the school name — used in every admission number (e.g. JHS/2026/004)"
                error={form.formState.errors.abbreviation?.message}
                htmlFor="abbreviation"
              >
                <Input id="abbreviation" placeholder="JHS" maxLength={10} {...form.register('abbreviation')} />
              </FormField>
              <FormField label="Principal's Name" htmlFor="principal">
                <Input id="principal" placeholder="Mr. Okafor" {...form.register('principal_name')} />
              </FormField>
              <FormField label="School Motto" htmlFor="motto">
                <Input id="motto" placeholder="Excellence Through Knowledge" {...form.register('motto')} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormGrid cols={2}>
                <FormField label="Email" error={form.formState.errors.email?.message} htmlFor="semail">
                  <Input id="semail" type="email" {...form.register('email')} />
                </FormField>
                <FormField label="Phone" htmlFor="sphone">
                  <Input id="sphone" {...form.register('phone')} />
                </FormField>
              </FormGrid>
              <FormField label="Address" htmlFor="saddress">
                <Textarea id="saddress" rows={2} {...form.register('address')} />
              </FormField>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
