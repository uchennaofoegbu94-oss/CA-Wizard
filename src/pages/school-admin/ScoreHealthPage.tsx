import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Info, Wrench, Loader2, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { round2 } from '@/lib/utils'
import { PageHeader, Spinner } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'

interface SummaryRow { status: 'RESTORED' | 'STILL_HIDDEN'; reason: string; scores: number; students: number; what_it_means: string; how_to_fix: string }
interface DetailRow {
  status: 'RESTORED' | 'STILL_HIDDEN'; reason: string; student_name: string; admission_number: string; session_name: string
  class_name: string; subject_name: string; term_name: string; field_name: string; score: number
}
interface StaleRow {
  snapshot_id: string; student_name: string; admission_number: string; session_name: string; session_id: string
  class_id: string; class_name: string; term_id: string; term_name: string; missing_subjects: string
}

const REASON_TITLE: Record<string, string> = {
  WRONG_LAYOUT: 'Recorded on a field from the wrong assessment layout',
  NOT_ENROLLED_IN_CLASS: 'Student is not enrolled in the class the scores belong to',
  SUBJECT_NOT_OFFERED: 'Subject is not offered at this class level',
  FIELD_INACTIVE: 'The assessment field is switched off',
  GROUP_ONLY_IN_OTHER_SESSION: 'Subject is group-restricted and the student has a group only in another session',
  NO_GROUP_ASSIGNED: 'Subject is group-restricted and the student has no group',
  IN_DIFFERENT_GROUP: 'Subject is group-restricted and the student is in a different group',
  NOT_OPTED_IN: 'Subject is chosen individually and the student is not ticked',
  OTHER: 'Not plainly visible (unclassified)'
}

// Every recorded score that is not simply visible, with the reason and how to fix it.
//  • STILL HIDDEN  — hidden for a reason a student group cannot fix.
//  • RESTORED      — visible again only because scores are recorded; the group/tick that should
//                    give the student the subject is missing or different (nothing is lost).
// Group changes can no longer hide a recorded score (migration 058), so STILL HIDDEN is never
// caused by groups; it is the genuine leftovers.
export default function ScoreHealthPage() {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const [showDetails, setShowDetails] = useState(false)
  const [filter, setFilter] = useState<'ALL' | 'STILL_HIDDEN' | 'RESTORED'>('ALL')
  const [search, setSearch] = useState('')

  const { data: summary = [], isLoading, error } = useQuery({
    queryKey: ['score-health-summary', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('diagnose_hidden_scores', { p_school_id: schoolId })
      if (error) throw error
      return (data ?? []) as SummaryRow[]
    },
    enabled: !!schoolId
  })
  const { data: stale = [] } = useQuery({
    queryKey: ['score-health-stale', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('diagnose_stale_snapshots', { p_school_id: schoolId })
      if (error) throw error
      return (data ?? []) as StaleRow[]
    },
    enabled: !!schoolId
  })
  const { data: details = [], isLoading: loadingDetails } = useQuery({
    queryKey: ['score-health-details', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_hidden_scores', { p_school_id: schoolId, p_limit: 500 })
      if (error) throw error
      return (data ?? []) as DetailRow[]
    },
    enabled: !!schoolId && showDetails
  })

  const refresh = () => ['score-health-summary', 'score-health-stale', 'score-health-details', 'class-subject-roster']
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }))

  // Safe automatic repair: move scores recorded on the wrong layout's field to the same-named field of the
  // class's layout. Never overwrites an existing score (those are reported as conflicts).
  const repair = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('repair_layout_scores', { p_school_id: schoolId })
      if (error) throw error
      return (data as { moved: number; conflicts: number; unmappable: number }[])[0]
    },
    onSuccess: r => {
      refresh()
      toast.success(`${r.moved} score${r.moved !== 1 ? 's' : ''} moved to the right field.${r.conflicts + r.unmappable > 0 ? ` ${r.conflicts} conflict${r.conflicts !== 1 ? 's' : ''} and ${r.unmappable} unmatched left for you to review.` : ''}`, { duration: 7000 })
      logAudit({ schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'score_repair', entityId: schoolId!, newValue: r })
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const stillHidden = summary.filter(r => r.status === 'STILL_HIDDEN')
  const restored = summary.filter(r => r.status === 'RESTORED')
  const totalHidden = stillHidden.reduce((n, r) => n + Number(r.scores), 0)
  const totalRestored = restored.reduce((n, r) => n + Number(r.scores), 0)
  const allClear = stillHidden.length === 0 && stale.length === 0

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return details.filter(d => (filter === 'ALL' || d.status === filter) &&
      (!q || `${d.student_name} ${d.admission_number} ${d.subject_name} ${d.class_name}`.toLowerCase().includes(q)))
  }, [details, filter, search])

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) {
    return (
      <div>
        <PageHeader title="Score Health" description="Find recorded scores that are not showing, and why" />
        <p className="text-sm text-destructive">Couldn&apos;t run the check: {(error as Error).message}. If this says a function doesn&apos;t exist, the latest database update hasn&apos;t been applied yet.</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Score Health" description="Find recorded scores that are not showing on reports, and the reason — nothing here is ever deleted" />

      <Card className={`mb-6 ${allClear ? 'border-green-300' : 'border-yellow-400'}`}>
        <CardContent className="pt-5 pb-5 flex items-start gap-3">
          {allClear ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" /> : <AlertTriangle className="h-6 w-6 text-yellow-600 shrink-0" />}
          <div className="text-sm space-y-1">
            <div className="font-semibold text-base">
              {allClear ? 'Every recorded score is showing where it belongs' : `${totalHidden} recorded score${totalHidden !== 1 ? 's are' : ' is'} still not showing`}
            </div>
            <p className="text-muted-foreground">
              {totalRestored > 0 && <>{totalRestored} score{totalRestored !== 1 ? 's were' : ' was'} hidden by student groups and are <strong>visible again</strong> — a student keeps any subject they already have scores in, so changing groups can no longer hide results. </>}
              {stale.length > 0 && <>{stale.length} saved report-card snapshot{stale.length !== 1 ? 's are' : ' is'} missing subjects that now have scores (transcripts read these). </>}
              {allClear && totalRestored === 0 && 'Nothing needs attention.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {stillHidden.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Still hidden — needs your action</h2>
          <div className="space-y-3">
            {stillHidden.map(r => (
              <Card key={r.reason} className="border-destructive/40">
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{REASON_TITLE[r.reason] ?? r.reason}</span>
                    <Badge variant="destructive">{r.scores} score{Number(r.scores) !== 1 ? 's' : ''}</Badge>
                    <Badge variant="secondary">{r.students} student{Number(r.students) !== 1 ? 's' : ''}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{r.what_it_means}</p>
                  <p className="text-sm"><strong>Fix:</strong> {r.how_to_fix}</p>
                  {r.reason === 'WRONG_LAYOUT' && (
                    <Button size="sm" onClick={() => repair.mutate()} disabled={repair.isPending}>
                      {repair.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}Repair layout scores
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {restored.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Info className="h-4 w-4 text-blue-600" />Visible again — worth tidying</h2>
          <p className="text-xs text-muted-foreground mb-3">These scores show because they exist. Setting the group or tick below makes the subject theirs properly for the future; nothing is lost either way.</p>
          <div className="space-y-3">
            {restored.map(r => (
              <Card key={r.reason}>
                <CardContent className="pt-4 pb-4 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{REASON_TITLE[r.reason] ?? r.reason}</span>
                    <Badge variant="info">{r.scores} score{Number(r.scores) !== 1 ? 's' : ''}</Badge>
                    <Badge variant="secondary">{r.students} student{Number(r.students) !== 1 ? 's' : ''}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{r.what_it_means}</p>
                  <p className="text-sm"><strong>Tidy:</strong> {r.how_to_fix}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {stale.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><FileText className="h-4 w-4 text-yellow-600" />Report-card snapshots to refresh</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Transcripts are built from saved snapshots. These were saved while a subject&apos;s scores were hidden, so they&apos;re missing it. Open the class&apos;s bulk report cards and press <em>Save snapshots</em> to refresh them.
          </p>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-2 font-medium">Student</th><th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Term</th><th className="px-3 py-2 font-medium">Missing subjects</th><th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {stale.map(s => (
                    <tr key={s.snapshot_id} className="border-b last:border-0">
                      <td className="px-4 py-2"><div className="font-medium">{s.student_name}</div><div className="text-xs text-muted-foreground">{s.admission_number}</div></td>
                      <td className="px-3 py-2">{s.class_name} <span className="text-xs text-muted-foreground">{s.session_name}</span></td>
                      <td className="px-3 py-2">{s.term_name}</td>
                      <td className="px-3 py-2 text-destructive">{s.missing_subjects}</td>
                      <td className="px-3 py-2 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/school/reports/bulk-report-cards?class=${s.class_id}&term=${s.term_id}&session=${s.session_id}`}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Every affected score</CardTitle>
            {!showDetails && <Button variant="outline" size="sm" onClick={() => setShowDetails(true)} disabled={summary.length === 0}>Show list</Button>}
          </div>
        </CardHeader>
        {showDetails && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Filter by status">
                <option value="ALL">All</option><option value="STILL_HIDDEN">Still hidden</option><option value="RESTORED">Visible again</option>
              </select>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student, subject, class…"
                className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm" aria-label="Search" />
            </div>
            {loadingDetails ? <Spinner /> : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Student</th><th className="px-3 py-2 font-medium">Class</th>
                    <th className="px-3 py-2 font-medium">Subject</th><th className="px-3 py-2 font-medium">Term</th><th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium text-right">Score</th><th className="px-3 py-2 font-medium">Reason</th>
                  </tr></thead>
                  <tbody>
                    {shown.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Nothing matches</td></tr> : shown.map((d, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-1.5"><Badge variant={d.status === 'STILL_HIDDEN' ? 'destructive' : 'info'}>{d.status === 'STILL_HIDDEN' ? 'Hidden' : 'Visible'}</Badge></td>
                        <td className="px-3 py-1.5"><div>{d.student_name}</div><div className="text-xs text-muted-foreground">{d.admission_number}</div></td>
                        <td className="px-3 py-1.5">{d.class_name}<div className="text-xs text-muted-foreground">{d.session_name}</div></td>
                        <td className="px-3 py-1.5">{d.subject_name}</td><td className="px-3 py-1.5">{d.term_name}</td><td className="px-3 py-1.5">{d.field_name}</td>
                        <td className="px-3 py-1.5 text-right">{round2(d.score)}</td>
                        <td className="px-3 py-1.5 text-xs">{REASON_TITLE[d.reason] ?? d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {details.length >= 500 && <p className="text-xs text-muted-foreground">Showing the first 500. Fix the reasons above and this list shrinks.</p>}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
