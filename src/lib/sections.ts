import type { ClassLevel, SchoolSection } from '@/types'

// Groups items by their class_level's section, in section order_index
// order (the sections array is expected pre-sorted by the caller's
// query, same as everywhere else in this codebase) — with a single
// flat "ungrouped" bucket whenever the school has no sections
// configured at all, so a school that never opts into this feature
// sees exactly the same flat list it always has. Shared across every
// page that lists class levels or classes (ClassesPage, ReportsPage,
// BroadsheetPage, SchoolAdminAnalyticsPage, the teacher dashboard/
// class picker) so the grouping behavior can't drift between them.
export function groupBySection<T>(
  items: T[],
  getLevel: (item: T) => ClassLevel | null | undefined,
  sections: SchoolSection[]
): { section: SchoolSection | null; items: T[] }[] {
  if (sections.length === 0) {
    return [{ section: null, items }]
  }
  const bySectionId = new Map<string, T[]>()
  const ungrouped: T[] = []
  items.forEach(item => {
    const sectionId = getLevel(item)?.section_id
    if (sectionId) {
      if (!bySectionId.has(sectionId)) bySectionId.set(sectionId, [])
      bySectionId.get(sectionId)!.push(item)
    } else {
      ungrouped.push(item)
    }
  })
  const groups: { section: SchoolSection | null; items: T[] }[] = sections
    .map(s => ({ section: s as SchoolSection | null, items: bySectionId.get(s.id) ?? [] }))
    .filter(g => g.items.length > 0)
  if (ungrouped.length > 0) groups.push({ section: null, items: ungrouped })
  return groups
}
