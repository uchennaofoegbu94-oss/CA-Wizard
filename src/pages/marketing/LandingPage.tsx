import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Check, ArrowRight, Menu, X, GraduationCap,
  FileText, Users, ShieldCheck, Zap, BarChart3, Building2, Sparkles, School
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { LogoMark, HeroVisual } from '@/components/brand/BrandArt'

// ══════════════════════════════════════════════════════════════
// Pricing data — mirrors the provided mockup exactly, with every
// amount at -50% per instruction. Nothing else about structure,
// copy, feature lists, or layout deviates from the mockup.
//
// Starter and Professional were later revised to flat instructed
// amounts (₦1,999/mo, ₦19,999/yr and ₦4,999/mo, ₦49,999/yr
// respectively) — yearlySave / yearlyEquivalent below are
// recalculated from those exact figures (yearly ÷ 12 vs. monthly ×
// 12), not eyeballed. Enterprise is untouched, per instruction.
// Starter's feature list also now states the 49-student / 9-teacher
// cap explicitly — those numbers are enforced separately (see
// src/lib/tierLimits.ts and migration 046), this is just making sure
// the page tells a prospective customer about the limit before they
// hit it, not inventing a new restriction.
// ══════════════════════════════════════════════════════════════
const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'Designed for Individual Tutors & Private Educators',
    monthly: '₦1,999',
    monthlyUnit: '/ mo',
    yearly: '₦19,999',
    yearlyUnit: '/ yr',
    yearlySave: 'SAVE ~16.6%',
    yearlyEquivalent: '(Equivalent to ₦1,666.58 / month)',
    cta: 'Get Started',
    ctaHref: '/auth/register-school?plan=starter',
    featuresHeading: "WHAT'S INCLUDED:",
    features: [
      'Up to 49 Active Students',
      'Up to 9 Teacher Accounts',
      'Automated CA Score Calculation',
      'Standardized Transcript Exports (PDF)',
      'Basic Grade Analytics',
      'Email Support'
    ],
    highlighted: false
  },
  {
    key: 'professional',
    name: 'Professional',
    tagline: 'Tailored for Secondary Schools & Colleges',
    monthly: '₦4,999',
    monthlyUnit: '/ mo',
    yearly: '₦49,999',
    yearlyUnit: '/ yr',
    yearlySave: 'SAVE ~16.7%',
    yearlyEquivalent: '(Equivalent to ₦4,166.58 / month)',
    cta: 'Start Free Trial',
    ctaHref: '/auth/register-school?plan=professional',
    featuresHeading: 'EVERYTHING IN STARTER, PLUS:',
    features: [
      'Multi-Teacher / Department Access',
      'Up to 1,500 Active Students',
      'Custom Grading Scales & Rubrics',
      'Batch Transcript & Report Card Generation',
      'Priority School Support'
    ],
    highlighted: true,
    badge: 'MOST POPULAR'
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    tagline: 'Built for Universities & Large Academic Organizations',
    monthly: '₦49,290.30',
    monthlyUnit: '/ mo',
    yearly: 'Flexible',
    yearlyUnit: '',
    yearlySave: 'ANNUAL DISCOUNT',
    yearlyEquivalent: '(Request a Quote)',
    cta: 'Contact Sales',
    ctaHref: 'mailto:sales@ca-wizard.app?subject=Enterprise%20Plan%20Inquiry',
    featuresHeading: 'EVERYTHING IN PROFESSIONAL, PLUS:',
    features: [
      'Unlimited Students & Faculty Accounts',
      'SIS & Portal API Integrations',
      'Custom Official Transcript Templates',
      'Dedicated Account Manager & SLA',
      'Advanced Audit Logs & Compliance'
    ],
    highlighted: false
  }
] as const

const FEATURES = [
  {
    icon: BarChart3,
    title: 'Automated CA-to-Transcript Pipeline',
    description: 'Enter continuous assessment scores once — grade computation, broadsheets, report cards, and transcripts all update automatically.'
  },
  {
    icon: FileText,
    title: 'Client-Generated PDF Report Cards',
    description: 'Genuinely clean PDF exports (not browser print dialogs), with school branding, signatures, stamps, and rating grids built in.'
  },
  {
    icon: Zap,
    title: 'Bulk Generation for Whole Classes',
    description: 'Generate every student\'s report card in a class at once — one combined PDF for printing, or a zip for individual distribution.'
  },
  {
    icon: Users,
    title: 'Role-Based Access, Built In',
    description: 'Super Admin, School Admin, and Teacher roles — with Form Teachers seeing full broadsheets and Subject Teachers scoped to their own column.'
  },
  {
    icon: ShieldCheck,
    title: 'Multi-Tenant, Isolated by Design',
    description: 'Every school\'s data is isolated at the database layer with row-level security — not just filtered in the app.'
  },
  {
    icon: Building2,
    title: 'Offline-Capable Score Entry',
    description: 'Teachers can enter scores without a connection; entries sync automatically the moment they\'re back online.'
  }
]

// ══════════════════════════════════════════════════════════════
// Live counter — reads get_platform_stats() (migration 030).
// `enabled` reflects the manually-flipped toggle in Platform
// Settings (default off); counts come back already banded to a
// round number by the database, never the exact figure. If the
// toggle is off, or both counts happen to band down to 0 (a brand
// new platform), this renders nothing rather than a hollow "0+
// schools" — same "no forced content" principle as item #9.
// ══════════════════════════════════════════════════════════════
function LiveCounter() {
  const { data } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_platform_stats')
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row as { enabled: boolean; schools_count: number; teachers_count: number } | null
    },
    staleTime: 5 * 60 * 1000
  })

  if (!data?.enabled) return null
  const showSchools = data.schools_count > 0
  const showTeachers = data.teachers_count > 0

  const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)

  // Toggle is on, but "active schools" and "active teachers" both
  // currently band to zero (e.g. every school is still 'pending', or
  // there are no teacher accounts marked active yet) — render a soft
  // fallback instead of nothing at all. A silently-vanishing widget
  // is indistinguishable from a broken one; this way, turning the
  // toggle on always visibly does *something*.
  if (!showSchools && !showTeachers) {
    return (
      <p className="mt-8 text-sm text-muted-foreground italic">Just getting started — check back soon.</p>
    )
  }

  return (
    <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
      {showSchools && (
        <span className="flex items-center gap-1.5">
          <School className="h-4 w-4 text-primary" />
          <strong className="text-foreground">{fmt(data.schools_count)}+</strong> schools
        </span>
      )}
      {showTeachers && (
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-primary" />
          <strong className="text-foreground">{fmt(data.teachers_count)}+</strong> teachers
        </span>
      )}
    </div>
  )
}

export default function LandingPage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div
      className="dark min-h-screen bg-background text-foreground bg-dot-pattern"
    >
      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2 font-bold text-lg"
          >
            <LogoMark size={32} className="rounded-lg" />
            CA-Wizard
          </button>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#enterprise" className="hover:text-foreground transition-colors">Enterprise</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link to="/auth/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link to="/auth/register-school">
                Get Started<ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <button className="md:hidden p-2" onClick={() => setMobileNavOpen(o => !o)} aria-label="Toggle menu">
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileNavOpen && (
          <div className="md:hidden border-t border-border/60 bg-background">
            <div className="container flex flex-col gap-1 py-3">
              <a href="#features" onClick={() => setMobileNavOpen(false)} className="px-2 py-2.5 text-sm font-medium">Features</a>
              <a href="#pricing" onClick={() => setMobileNavOpen(false)} className="px-2 py-2.5 text-sm font-medium">Pricing</a>
              <a href="#enterprise" onClick={() => setMobileNavOpen(false)} className="px-2 py-2.5 text-sm font-medium">Enterprise</a>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" asChild>
                  <Link to="/auth/login">Sign In</Link>
                </Button>
                <Button className="flex-1" asChild>
                  <Link to="/auth/register-school">Get Started</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero (mirrors mockup header block) ─────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-40"
          style={{ background: 'radial-gradient(60% 60% at 50% 0%, hsl(var(--primary)/0.25), transparent 70%)' }}
        />
        <div className="container relative pt-20 pb-16 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase mb-4">CA-Wizard Platform</p>
          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl font-bold leading-tight tracking-tight">
            From CA Scores to Transcripts — All in One Place
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-muted-foreground text-lg">
            Streamline continuous assessment, grade computation, and automated transcript generation with ease.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/auth/register-school?plan=professional">
                Start Free Trial<ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#pricing">See Pricing</a>
            </Button>
          </div>

          <LiveCounter />

          <p className="mt-6 text-sm text-muted-foreground">
            Flexibility built in: choose between Monthly Flexibility or Yearly Savings across all 3 tiers.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Need a custom deployment or university-wide installation?{' '}
            <a href="#enterprise" className="text-primary font-medium hover:underline">
              Speak with our academic solutions team.
            </a>
          </p>

          {/* Hero visual — an abstract, on-brand illustration (report
              card + grade chart), not a literal screenshot. Inline
              SVG (compiled into the bundle, not a separate file
              request — see components/brand/BrandArt.tsx), so it
              costs nothing meaningful in load time and can't fail to
              load the way an external file reference can. */}
          <div className="mx-auto mt-14 w-full max-w-md">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="container py-20 border-t border-border/60">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase mb-3">Features</p>
          <h2 className="text-3xl font-bold">Everything a school needs to run assessments end-to-end</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing (matches mockup layout/copy exactly, -50% pricing) ── */}
      <section id="pricing" className="container py-20 border-t border-border/60">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl font-bold mb-3">Simple, Transparent Pricing</h2>
          <p className="text-muted-foreground">
            Flexibility built in: choose between Monthly Flexibility or Yearly Savings across all 3 tiers.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
          {PLANS.map(plan => (
            <div
              key={plan.key}
              id={plan.key === 'enterprise' ? 'enterprise' : undefined}
              className={cn(
                'relative rounded-2xl border bg-card p-6 flex flex-col',
                plan.highlighted
                  ? 'border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.3),0_0_40px_-10px_hsl(var(--primary)/0.5)] lg:-translate-y-2'
                  : plan.key === 'enterprise'
                    ? 'border-amber-500/30 shadow-[0_0_40px_-14px_rgba(245,158,11,0.35)] overflow-hidden'
                    : 'border-border'
              )}
            >
              {plan.key === 'enterprise' && (
                // Subtle premium accent glow — visual only, doesn't
                // touch any pricing figure or copy in this card.
                <div
                  className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-40"
                  style={{ background: 'radial-gradient(closest-side, rgba(245,158,11,0.35), transparent)' }}
                  aria-hidden="true"
                />
              )}

              {'badge' in plan && plan.badge && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">{plan.badge}</Badge>
              )}

              <h3 className="text-lg font-bold">{plan.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground min-h-[2.5rem]">{plan.tagline}</p>

              <div className="mt-5">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Monthly Plan</p>
                <p className="mt-1 text-3xl font-bold">
                  {plan.monthly}<span className="text-base font-medium text-muted-foreground">{plan.monthlyUnit}</span>
                </p>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Yearly Plan</p>
                  <Badge variant="outline" className="text-primary border-primary/40 text-[10px] px-1.5 py-0">
                    {plan.yearlySave}
                  </Badge>
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {plan.yearly}{plan.yearlyUnit && <span className="text-base font-medium text-muted-foreground">{plan.yearlyUnit}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{plan.yearlyEquivalent}</p>
              </div>

              <Button
                asChild
                className="mt-6 w-full"
                variant={plan.highlighted ? 'default' : 'outline'}
              >
                {plan.ctaHref.startsWith('mailto:')
                  ? <a href={plan.ctaHref}>{plan.cta}</a>
                  : <Link to={plan.ctaHref}>{plan.cta}</Link>}
              </Button>

              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-3">{plan.featuresHeading}</p>
                <ul className="space-y-2.5">
                  {plan.features.map(feature => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-10">
          Need a custom deployment or university-wide installation?{' '}
          <a href="mailto:sales@ca-wizard.app?subject=Custom%20Deployment%20Inquiry" className="text-primary font-medium hover:underline">
            Speak with our academic solutions team.
          </a>
        </p>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────── */}
      <section className="container pb-20">
        <div className="rounded-2xl border border-border bg-card px-8 py-14 text-center">
          <Sparkles className="h-8 w-8 text-primary mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold">Ready to simplify your school's assessments?</h2>
          <p className="mt-3 text-muted-foreground max-w-md mx-auto">
            Get your school approved and start entering scores in minutes.
          </p>
          <Button size="lg" className="mt-6" asChild>
            <Link to="/auth/register-school">
              Register Your School<ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-border/60">
        <div className="container py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <GraduationCap className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            CA-Wizard
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
            <Link to="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link to="/work-with-us" className="hover:text-foreground transition-colors">Get Involved</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/auth/login" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} CA-Wizard. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
