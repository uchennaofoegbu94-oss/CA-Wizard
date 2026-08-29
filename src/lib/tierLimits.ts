// Mirrors migration 020's tier_student_limit / tier_grading_system_limit
// SQL functions exactly (Starter's student cap updated in migration 046 —
// keep this file and that function in sync if the pricing page ever
// changes again; there is currently no single source of truth shared
// between SQL and TypeScript for these numbers).
//
// 'free' isn't a tier the pricing page defines — see migration 020's
// comment for the same caveat: treated as the most conservative tier,
// an assumption flagged for review, not a documented product decision.

export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise' | string | null | undefined

export function studentLimit(tier: SubscriptionTier): number | null {
  switch (tier) {
    case 'free': return 20
    case 'starter': return 49
    case 'professional': return 1500
    default: return null // enterprise, unrecognized, or null/undefined: unlimited
  }
}

export function gradingSystemLimit(tier: SubscriptionTier): number | null {
  switch (tier) {
    case 'free': return 1
    case 'starter': return 1
    default: return null // professional/enterprise/null: unlimited
  }
}

// Teacher caps exist ONLY client-side — see migration 020's note on why
// a DB trigger can't safely enforce this one (handle_new_user's
// exception handler swallows profile-insert failures, which would
// silently orphan the auth account instead of cleanly rejecting it).
// This is the actual enforcement, not just a UI courtesy.
export function teacherLimit(tier: SubscriptionTier): number | null {
  switch (tier) {
    case 'free': return 1
    case 'starter': return 9
    default: return null // professional/enterprise/null: unlimited
  }
}

// "Batch Transcript & Report Card Generation" is explicitly a
// Professional+ feature per the pricing page.
export function canUseBulkGeneration(tier: SubscriptionTier): boolean {
  return tier === 'professional' || tier === 'enterprise'
}

export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case 'free': return 'Free'
    case 'starter': return 'Starter'
    case 'professional': return 'Professional'
    case 'enterprise': return 'Enterprise'
    default: return tier ?? 'Free'
  }
}
