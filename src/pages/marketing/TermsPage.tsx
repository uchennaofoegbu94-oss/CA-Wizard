import { Link } from 'react-router-dom'
import { GraduationCap, ArrowLeft } from 'lucide-react'

const LAST_UPDATED = 'August 2026'

export default function TermsPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground bg-dot-pattern">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <GraduationCap className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            CA-Wizard
          </Link>
          <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />Back to home
          </Link>
        </div>
      </header>

      <div className="container py-10 max-w-2xl">
        <div className="mb-6 rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 text-sm text-orange-200">
          <strong>Template notice:</strong> this document was drafted to be substantively real and specific to how
          CA-Wizard actually works, but it has not been reviewed by a lawyer. Treat it as a strong starting draft,
          not a finished legal instrument, until it's had that review.
        </div>

        <h1 className="text-2xl font-bold mb-1">Terms & Conditions</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="text-sm leading-relaxed space-y-6">
          <section>
            <h2 className="font-semibold text-base mb-2">1. Who These Terms Are Between</h2>
            <p>
              These Terms govern use of CA-Wizard ("the Platform," "we," "us") by any school ("the School," "you")
              that registers an account, and by any individual (school administrator, teacher) accessing the Platform
              on a School's behalf. Registering a School or accepting an invite to join one means you've read and
              agreed to these Terms on behalf of yourself and, where applicable, the School you represent.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">2. What the Platform Is</h2>
            <p>
              CA-Wizard is a continuous-assessment management platform: it helps schools record scores, compute
              grades, and generate report cards, broadsheets, and transcripts. We provide the software; the School
              is responsible for the accuracy of the academic data entered into it.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">3. Who Owns the Data</h2>
            <p>
              Student and staff records entered by a School remain that School's data. We act as a processor of that
              data on the School's behalf — the School is the data controller under applicable data protection law
              (including Nigeria's Data Protection Act) and is responsible for having a lawful basis to collect and
              process it, including any consent required from parents/guardians of enrolled students.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">4. Accounts & Access</h2>
            <p>
              A School Admin account is created at registration and approved before use. School Admins invite
              Teachers via invite codes; Teacher access is scoped to the classes/subjects they're assigned.
              Each person is responsible for keeping their own login credentials confidential and for all activity
              under their account.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">5. Subscription Plans & Limits</h2>
            <p>
              Access to certain features (student/teacher counts, custom grading scales, batch generation, and
              others listed on our pricing page) depends on the School's subscription plan. We may enforce plan
              limits technically (for example, blocking new student records once a plan's cap is reached). Existing
              data is never deleted for being over a new limit — only the ability to add more, or use
              plan-restricted features, is affected until the School is back within its plan or upgrades.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">6. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Use the Platform to store or process data you don't have a lawful basis to hold</li>
              <li>Attempt to access another School's data, or another user's account, without authorization</li>
              <li>Reverse-engineer, scrape, or attempt to circumvent the Platform's technical limits or security</li>
              <li>Use the Platform in a way that violates the rights of students, staff, or any third party</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">7. Data Retention & Deletion</h2>
            <p>
              We retain a School's data for as long as the School's account is active. If a School's account is
              closed, we retain data for a reasonable period to allow for reactivation or export requests, after
              which it is deleted, except where retention is required by law or for legitimate audit purposes
              (e.g. our own audit logs, which record account and permission changes).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">8. Service Availability</h2>
            <p>
              We aim for high availability but don't guarantee uninterrupted access. We may perform scheduled
              maintenance, during which access may be temporarily limited for non-administrative users. We'll try
              to minimize disruption and communicate significant planned downtime where practical.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">9. Changes to These Terms</h2>
            <p>
              We may update these Terms as the Platform evolves. Material changes will be communicated to School
              Admins; continued use of the Platform after changes take effect constitutes acceptance of the updated
              Terms.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">10. Contact</h2>
            <p>
              Questions about these Terms can be directed to your Platform contact through the support channel
              available in the app.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
