import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GraduationCap, ArrowLeft, Rocket, BookOpen, Users, ClipboardList,
  FileText, HelpCircle, ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DocArticle {
  id: string
  title: string
  content: React.ReactNode
}

interface DocSection {
  id: string
  label: string
  icon: typeof Rocket
  articles: DocArticle[]
}

const SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: Rocket,
    articles: [
      {
        id: 'registration',
        title: 'Registering Your School',
        content: (
          <>
            <p>Register from the pricing section on the homepage, or the general "Register Your School" link. You'll provide your school's name, address, principal's name, and an admin email/password.</p>
            <p>New registrations start as <strong>pending</strong> and require approval before the admin account can sign in — this keeps the platform limited to real schools. Once approved, you'll be notified and can sign in immediately.</p>
            <p>Your school's abbreviation (used in every student's admission number) is inferred automatically from your school's name, stopping at the first word like "School," "College," or "University." You can correct it afterward in Settings if the inference gets it wrong.</p>
          </>
        )
      },
      {
        id: 'first-setup',
        title: 'First-Time Setup',
        content: (
          <>
            <p>After your first sign-in, a typical setup order is:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Confirm your current <strong>Session</strong> (academic year) — creating one automatically sets up all three terms</li>
              <li>Add your <strong>Class Levels</strong> and, if needed, <strong>Class Arms</strong> (e.g. "JSS 1" with arms "A" and "B")</li>
              <li>Review the <strong>Subjects</strong> offered at each class level</li>
              <li>Generate invite codes for your <strong>Teachers</strong>, then assign them to classes/subjects once they've signed up</li>
              <li>Add <strong>Students</strong> and enroll them into classes</li>
            </ol>
          </>
        )
      }
    ]
  },
  {
    id: 'core-concepts',
    label: 'Core Concepts',
    icon: BookOpen,
    articles: [
      {
        id: 'sessions-terms',
        title: 'Sessions & Terms',
        content: (
          <>
            <p>A <strong>Session</strong> is an academic year (e.g. "2025/2026"). Each session has exactly three <strong>Terms</strong> — First, Second, and Third — created automatically the moment you create the session.</p>
            <p>Only one session can be "current" at a time, and only a term within that current session can be marked as the current term — this is enforced by the platform, not just a suggestion.</p>
            <p>A term can be <strong>locked</strong> (closes score entry) and <strong>published</strong> (makes report cards/results visible). Both are reversible until a term has real data recorded against it.</p>
          </>
        )
      },
      {
        id: 'classes-subjects',
        title: 'Classes & Subjects',
        content: (
          <>
            <p><strong>Class Levels</strong> (e.g. "JSS 1") and <strong>Class Arms</strong> (e.g. "A", "B") are school-wide and persist across sessions. A <strong>Class</strong> is the combination of a level, an optional arm, and a session — this is what students actually enroll into.</p>
            <p>New sessions automatically copy the previous session's class structure (and form teacher assignments), so you don't need to recreate classes every year.</p>
            <p><strong>Subjects</strong> are a global catalog per school, offered at specific class levels via Subject Offerings — a subject only shows up for grading at the levels it's explicitly offered at.</p>
          </>
        )
      },
      {
        id: 'roles',
        title: 'Roles & Permissions',
        content: (
          <>
            <p><strong>School Admin</strong> has full control over their school — students, teachers, classes, grading, sessions.</p>
            <p><strong>Teacher</strong> access depends on assignment scope: a <em>Subject</em> assignment gives access to just that subject's scores in that class; a <em>Class</em> (Form Teacher) assignment gives access to every subject in that class, plus the full broadsheet with class-wide rankings — subject teachers only ever see their own subject's column.</p>
          </>
        )
      }
    ]
  },
  {
    id: 'admin-guide',
    label: 'School Admin Guide',
    icon: Users,
    articles: [
      {
        id: 'teachers',
        title: 'Managing Teachers',
        content: (
          <>
            <p>Generate an invite code (you can request several at once), share it with a teacher, and they redeem it during sign-up to create their account. Once they've signed up, assign them to classes and/or subjects from the Teachers page.</p>
            <p>If a teacher leaves your school, use <strong>Archive</strong> rather than deleting anything — this blocks their login and clears their assignments, but keeps their profile so past scores and comments still show correct attribution. Archived teachers can be restored later.</p>
          </>
        )
      },
      {
        id: 'students',
        title: 'Managing Students',
        content: (
          <>
            <p>Admission numbers are generated automatically in the format <code>ABBREVIATION/YEAR/003</code>, but remain editable in case of a correction. When a student leaves, use <strong>Graduate</strong>, <strong>Transfer</strong>, or <strong>Withdraw</strong> to keep their historical records intact — reserve permanent deletion for genuine data-entry mistakes.</p>
          </>
        )
      },
      {
        id: 'grading',
        title: 'Grading Systems',
        content: (
          <>
            <p>Define grade boundaries (e.g. A: 70–100) and remarks under Grading. One grading system is marked default and used across report cards and transcripts. Custom, additional grading scales are a Professional-plan feature.</p>
          </>
        )
      }
    ]
  },
  {
    id: 'reports',
    label: 'Report Cards & Transcripts',
    icon: FileText,
    articles: [
      {
        id: 'report-cards',
        title: 'Generating Report Cards',
        content: (
          <>
            <p>Report cards are generated per student per term from the Reports page, and downloaded as a genuine PDF (not a browser print-to-PDF), with your school's branding, signatures, and stamp if uploaded in Settings.</p>
            <p>Report cards always render as a single page, with the subjects table starting immediately below the student's photo — 20 row slots are always shown, filled with whatever subjects have scores, so every report card keeps the same shape regardless of how many subjects a class has.</p>
          </>
        )
      },
      {
        id: 'bulk',
        title: 'Bulk Generation',
        content: (
          <>
            <p>Generate every student's report card in a class at once — either as one combined PDF for printing, or a zip of individually-named PDFs for distribution. Bulk transcript generation works similarly but compiles each student's <em>entire</em> academic history, not just one term. Both require the Professional plan.</p>
          </>
        )
      },
      {
        id: 'transcripts',
        title: 'Transcripts',
        content: (
          <>
            <p>A transcript compiles every saved report-card snapshot a student has across all their sessions into one document — search by name or admission number, independent of which session you currently have selected.</p>
          </>
        )
      }
    ]
  },
  {
    id: 'faq',
    label: 'FAQ',
    icon: HelpCircle,
    articles: [
      {
        id: 'faq-general',
        title: 'Frequently Asked Questions',
        content: (
          <div className="space-y-4">
            <div>
              <p className="font-semibold">Can I use CA-Wizard offline?</p>
              <p className="text-muted-foreground">Score entry works offline and syncs automatically once you're back online. Most other features need a connection.</p>
            </div>
            <div>
              <p className="font-semibold">What happens if I downgrade my plan?</p>
              <p className="text-muted-foreground">Existing data is never deleted for being over a new plan's limit. You just won't be able to add more students/teachers past the new cap, or use plan-restricted features, until you're back within it.</p>
            </div>
            <div>
              <p className="font-semibold">Can I delete a session or term?</p>
              <p className="text-muted-foreground">Yes, but only if it has no real activity recorded under it — this protects historical academic records from accidental loss.</p>
            </div>
          </div>
        )
      }
    ]
  }
]

export default function DocumentationPage() {
  const [activeArticle, setActiveArticle] = useState(SECTIONS[0].articles[0].id)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const current = SECTIONS.flatMap(s => s.articles).find(a => a.id === activeArticle) ?? SECTIONS[0].articles[0]

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

      <div className="container py-8 flex flex-col md:flex-row gap-8">
        {/* Mobile section picker */}
        <button
          onClick={() => setMobileNavOpen(o => !o)}
          className="md:hidden flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm font-medium"
        >
          Browse Documentation
          <ChevronRight className={cn('h-4 w-4 transition-transform', mobileNavOpen && 'rotate-90')} />
        </button>

        <nav className={cn('w-full md:w-64 shrink-0 space-y-6', !mobileNavOpen && 'hidden md:block')}>
          {SECTIONS.map(section => (
            <div key={section.id}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                <section.icon className="h-3.5 w-3.5" />{section.label}
              </div>
              <div className="space-y-0.5">
                {section.articles.map(article => (
                  <button
                    key={article.id}
                    onClick={() => { setActiveArticle(article.id); setMobileNavOpen(false) }}
                    className={cn(
                      'block w-full text-left text-sm rounded-md px-3 py-1.5 transition-colors',
                      activeArticle === article.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    {article.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <article className="flex-1 min-w-0 max-w-2xl">
          <h1 className="text-2xl font-bold mb-4">{current.title}</h1>
          <div className="text-sm leading-relaxed space-y-3 [&_strong]:text-foreground [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
            {current.content}
          </div>
        </article>
      </div>
    </div>
  )
}
