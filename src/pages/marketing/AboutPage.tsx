import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GraduationCap, ArrowLeft, Star, Linkedin, Twitter } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { TeamMember, HistoryEvent, Testimonial } from '@/types'
import { Spinner } from '@/components/ui/table'

export default function AboutPage() {
  const { data: team = [], isLoading: loadingTeam } = useQuery({
    queryKey: ['public-team-members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('is_active', true).order('display_order')
      if (error) throw error
      return data as TeamMember[]
    }
  })

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['public-history-events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('history_events').select('*').eq('is_active', true).order('display_order')
      if (error) throw error
      return data as HistoryEvent[]
    }
  })

  const { data: testimonials = [], isLoading: loadingTestimonials } = useQuery({
    queryKey: ['public-testimonials'],
    queryFn: async () => {
      const { data, error } = await supabase.from('testimonials').select('*').eq('is_active', true).order('display_order')
      if (error) throw error
      return data as Testimonial[]
    }
  })

  const isLoading = loadingTeam || loadingHistory || loadingTestimonials
  const hasAnyContent = team.length > 0 || history.length > 0 || testimonials.length > 0

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

      <div className="container py-12 max-w-4xl">
        <h1 className="text-3xl font-bold">About CA-Wizard</h1>

        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : !hasAnyContent ? (
          <p className="text-muted-foreground mt-4">More to come here soon.</p>
        ) : (
          <div className="mt-10 space-y-16">
            {/* ── Meet the Team ────────────────────────────── */}
            {team.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-6">Meet the Team</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
                  {team.map(m => (
                    <div key={m.id} className="text-center">
                      {m.photo_url ? (
                        <img src={m.photo_url} alt="" className="h-20 w-20 rounded-full object-cover mx-auto" />
                      ) : (
                        <div className="h-20 w-20 rounded-full bg-muted mx-auto" />
                      )}
                      <p className="font-medium mt-3">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.role_title}</p>
                      {m.bio && <p className="text-xs text-muted-foreground mt-1.5">{m.bio}</p>}
                      {(m.linkedin_url || m.twitter_url) && (
                        <div className="flex justify-center gap-2 mt-2">
                          {m.linkedin_url && (
                            <a href={m.linkedin_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                              <Linkedin className="h-4 w-4" />
                            </a>
                          )}
                          {m.twitter_url && (
                            <a href={m.twitter_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                              <Twitter className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── History ──────────────────────────────────── */}
            {history.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-6">Our Story</h2>
                <div className="relative border-l border-border pl-6 space-y-8">
                  {history.map(h => (
                    <div key={h.id} className="relative">
                      <div className="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-primary" />
                      <p className="text-xs font-semibold text-primary">{h.date_label}</p>
                      <p className="font-medium mt-0.5">{h.title}</p>
                      {h.description && <p className="text-sm text-muted-foreground mt-1">{h.description}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Testimonials ─────────────────────────────── */}
            {testimonials.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-6">What Schools Say</h2>
                <div className="grid sm:grid-cols-2 gap-6">
                  {testimonials.map(t => (
                    <div key={t.id} className="rounded-xl border p-5">
                      {t.rating && (
                        <div className="flex gap-0.5 mb-2">
                          {Array.from({ length: t.rating }).map((_, idx) => (
                            <Star key={idx} className="h-3.5 w-3.5 fill-current text-amber-500" />
                          ))}
                        </div>
                      )}
                      <p className="text-sm italic">"{t.quote}"</p>
                      <div className="flex items-center gap-2 mt-4">
                        {t.photo_url ? (
                          <img src={t.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-muted" />
                        )}
                        <div>
                          <p className="text-xs font-medium">{t.author_name}</p>
                          {t.author_role && <p className="text-xs text-muted-foreground">{t.author_role}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
