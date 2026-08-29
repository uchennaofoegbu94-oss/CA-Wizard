import { Link } from 'react-router-dom'
import { GraduationCap, ArrowLeft, Users, FlaskConical, Gift, Briefcase, Mail, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Tier 3, Item #20. Confirmed scope: Coming Soon placeholder only, no
// reward mechanics — there's no billing system yet for a referral
// credit or loyalty discount to actually apply against, so nothing
// here tracks referrals, points, or beta invites. Every card routes
// to the same sales@ca-wizard.app inbox the pricing page's Enterprise
// CTA already uses, rather than a dedicated signup form that would
// collect interest with nowhere real to route it yet.
const PROGRAMS = [
  {
    icon: Users,
    title: 'Referral Program',
    blurb: 'Know a school that would love CA-Wizard? Refer them and we\'ll make it worth your while.'
  },
  {
    icon: FlaskConical,
    title: 'Beta Program',
    blurb: 'Get early access to new features before they ship, and help shape what we build next.'
  },
  {
    icon: Gift,
    title: 'Loyalty Rewards',
    blurb: 'Perks for schools who\'ve been with us a while — details coming as the program takes shape.'
  },
  {
    icon: Briefcase,
    title: 'Partnerships & Careers',
    blurb: 'Interested in partnering with us, or joining the team? We\'d love to hear from you.'
  }
]

export default function WorkWithUsPage() {
  return (
    <div className="min-h-screen bg-background bg-dot-pattern">
      <header className="border-b border-border/60">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <GraduationCap className="h-4 w-4 text-primary-foreground" />
            </div>
            CA-Wizard
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to home
          </Link>
        </div>
      </header>

      <div className="container py-12 max-w-3xl">
        <h1 className="text-3xl font-bold">Get Involved</h1>
        <p className="text-muted-foreground mt-2">
          A few ways we're planning to work more closely with schools, testers, and partners.
          None of these are live yet — reach out and we'll keep you posted.
        </p>

        <div className="mt-10 grid sm:grid-cols-2 gap-4">
          {PROGRAMS.map(p => (
            <Card key={p.title}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p.icon className="h-6 w-6 text-primary" />
                  <Badge variant="secondary">
                    <Clock className="mr-1 h-3 w-3" />Coming Soon
                  </Badge>
                </div>
                <p className="font-semibold mt-3">{p.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{p.blurb}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 rounded-xl border bg-muted/30 p-6 text-center">
          <p className="font-medium">Want to be first in line?</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Drop us a line and mention which one you're interested in — we'll reach out once it's ready.
          </p>
          <Button asChild>
            <a href="mailto:sales@ca-wizard.app?subject=Interested%20in%20Get%20Involved%20Programs">
              <Mail className="mr-2 h-4 w-4" />Get in Touch
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
