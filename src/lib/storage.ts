import { supabase } from './supabase'

interface UploadResult {
  url: string | null
  error: string | null
}

async function uploadToBucket(bucket: string, path: string, file: File): Promise<UploadResult> {
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: '3600'
  })
  if (uploadError) return { url: null, error: uploadError.message }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

// Path convention matches the storage RLS policies in migration 007 —
// the first path segment must be the school's own ID.
export async function uploadSchoolLogo(schoolId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'png'
  return uploadToBucket('school-branding', `${schoolId}/logo.${ext}`, file)
}

export async function uploadSchoolWatermark(schoolId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'png'
  return uploadToBucket('school-branding', `${schoolId}/watermark.${ext}`, file)
}

export async function uploadStudentPhoto(schoolId: string, studentId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  return uploadToBucket('people-photos', `${schoolId}/students/${studentId}.${ext}`, file)
}

export async function uploadTeacherPhoto(schoolId: string, profileId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  return uploadToBucket('people-photos', `${schoolId}/teachers/${profileId}.${ext}`, file)
}

export async function uploadPrincipalSignature(schoolId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'png'
  return uploadToBucket('school-branding', `${schoolId}/principal-signature.${ext}`, file)
}

export async function uploadTeacherSignature(schoolId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'png'
  return uploadToBucket('school-branding', `${schoolId}/teacher-signature.${ext}`, file)
}

export async function uploadSchoolStamp(schoolId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'png'
  return uploadToBucket('school-branding', `${schoolId}/stamp.${ext}`, file)
}

// Not school-scoped — RLS on this bucket checks is_super_admin()
// directly rather than a folder-prefix match, since blog posts have
// no school context at all. Path is keyed by post id, timestamped so
// repeated uploads for the same post (swapping a cover image while
// editing) don't collide with a stale cached URL.
export async function uploadBlogCoverImage(postId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  return uploadToBucket('blog-media', `${postId}/cover-${Date.now()}.${ext}`, file)
}

// Same is_super_admin()-checked bucket pattern, one shared bucket
// across all three "site content" tables since none of them are
// school-scoped and there's no need for three near-identical buckets.
export async function uploadTeamMemberPhoto(memberId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  return uploadToBucket('site-content', `team/${memberId}-${Date.now()}.${ext}`, file)
}

export async function uploadTestimonialPhoto(testimonialId: string, file: File): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  return uploadToBucket('site-content', `testimonials/${testimonialId}-${Date.now()}.${ext}`, file)
}
