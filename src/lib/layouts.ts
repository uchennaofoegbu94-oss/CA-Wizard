import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { AssessmentLayout } from '@/types'

// All assessment layouts for a school: the school default (section_id null)
// plus any per-section layouts. Small table (one row per section at most).
export function useAssessmentLayouts(schoolId: string | null | undefined) {
  return useQuery({
    queryKey: ['assessment-layouts', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('assessment_layouts').select('*').eq('school_id', schoolId!)
      if (error) throw error
      return data as AssessmentLayout[]
    },
    enabled: !!schoolId
  })
}

// Mirrors the database's layout_for_class(): the section's own layout if it
// has one, otherwise the school default. (The scoring RPCs resolve this on
// the server; this exists so pages can pick the matching COLUMNS to show.)
export function layoutIdForSection(layouts: AssessmentLayout[] | undefined, sectionId: string | null | undefined): string | undefined {
  if (!layouts || layouts.length === 0) return undefined
  const own = sectionId ? layouts.find(l => l.section_id === sectionId) : undefined
  return (own ?? layouts.find(l => l.section_id === null))?.id
}
