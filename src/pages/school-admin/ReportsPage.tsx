import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardList, Trophy, FileText, FileArchive, Download, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { exportNodeToPdf } from '@/lib/pdfExport'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { groupBySection } from '@/lib/sections'
import { ordinalSuffix } from '@/lib/utils'
import { canUseBulkGeneration, tierLabel } from '@/lib/tierLimits'
import toast from 'react-hot-toast'
import type { Term, Subject, Student, StudentEnrollment, ClassSubjectTermResult, Class, Session, School, SchoolSection } from '@/types'

interface StudentTotals {
  student: Student
  perSubject: Record<string, number>
  grandTotal: number
  average: number
}

// School admins always see the complete picture — there's no scope
// restriction here the way there is on the teacher Broadsheet page,
// since an admin isn't tied to specific teacher_assignments rows.
export default function ReportsPage() {
  const { schoolId, subscriptionTier } = useAuth()

  // Session/class/term selection lives in the URL, not local state —
  // that's what makes this page's view survive navigating away (e.g.
  // to a single student's report card) and back: the "Back to
  // Reports" link on those pages carries the same session/class/term
  // straight through, and browser back/forward + refresh all
  // correctly restore the exact view instead of resetting to blank.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedSessionId = searchParams.get('session') ?? ''
  const selectedClassId = searchParams.get('class') ?? ''
  const selectedTermId = searchParams.get('term') ?? ''

  const setSelectedSessionId = (v: string) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (v) next.set('session', v); else next.delete('session')
    next.delete('class'); next.delete('term')
    return next
  })
  const setSelectedClassId = (v: string) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (v) next.set('class', v); else next.delete('class')
    return next
  }, { replace: true })
  const setSelectedTermId = (v: string) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (v) next.set('term', v); else next.delete('term')
    return next
  }, { replace: true })

  const [downloadingBroadsheet, setDownloadingBroadsheet] = useState(false)
  const broadsheetRef = useRef<HTMLDivElement>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['reports-sessions', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).order('start_year', { ascending: false })
      if (error) throw error
      return data as Session[]
    },
    enabled: !!schoolId
  })

  const { data: school } = useQuery({
    queryKey: ['reports-school', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId!).single()
      if (error) throw error
      return data as School
    },
    enabled: !!schoolId
  })

  const effectiveSessionId = selectedSessionId || sessions.find(s => s.is_current)?.id || sessions[0]?.id || ''

  const { data: terms = [] } = useQuery({
    queryKey: ['reports-terms', effectiveSessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('session_id', effectiveSessionId).order('created_at')
      if (error) throw error
      return data as Term[]
    },
    enabled: !!effectiveSessionId
  })

  const effectiveTermId = selectedTermId || terms.find(t => t.is_current)?.id || terms[0]?.id || ''
  const selectedTerm = terms.find(t => t.id === effectiveTermId)

  const { data: sections = [] } = useQuery({
    queryKey: ['reports-sections', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('school_sections').select('*').eq('school_id', schoolId!).order('order_index')
      if (error) throw error
      return data as SchoolSection[]
    },
    enabled: !!schoolId
  })

  const { data: classes = [] } = useQuery({
    queryKey: ['reports-classes', schoolId, effectiveSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*, class_level:class_levels(*, section:school_sections(*)), class_arm:class_arms(*)')
        .eq('school_id', schoolId!)
        .eq('session_id', effectiveSessionId)
      if (error) throw error
      return data as Class[]
    },
    enabled: !!schoolId && !!effectiveSessionId
  })

  const selectedClass = classes.find(c => c.id === selectedClassId)

  const { data: subjects = [] } = useQuery({
    queryKey: ['reports-subjects', selectedClass?.class_level_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_offerings')
        .select('subject:subjects(*)')
        .eq('class_level_id', selectedClass!.class_level_id)
      if (error) throw error
      return (data as unknown as { subject: Subject }[]).map(o => o.subject).filter(Boolean)
    },
    enabled: !!selectedClass?.class_level_id
  })

  const { data: enrollments = [] } = useQuery({
    queryKey: ['reports-enrollments', selectedClassId],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('*, student:students(*)').eq('class_id', selectedClassId)
      if (error) throw error
      return (data as StudentEnrollment[]).filter(e => e.student?.is_active)
    },
    enabled: !!selectedClassId
  })

  // One get_class_subject_term_results RPC call per subject offered at
  // this class's level — was previously a single query against the
  // now-removed v_term_results view; same pattern as BroadsheetPage.
  const { data: resultsBySubject = {}, isLoading: loadingResults } = useQuery({
    queryKey: ['reports-results', selectedClassId, effectiveTermId, subjects.map(s => s.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(subjects.map(async subj => {
        const { data, error } = await supabase.rpc('get_class_subject_term_results', {
          p_class_id: selectedClassId, p_subject_id: subj.id, p_term_id: effectiveTermId
        })
        if (error) throw error
        return [subj.id, (data ?? []) as ClassSubjectTermResult[]] as const
      }))
      return Object.fromEntries(entries) as Record<string, ClassSubjectTermResult[]>
    },
    enabled: !!selectedClassId && !!effectiveTermId && subjects.length > 0
  })

  const rows: StudentTotals[] = useMemo(() => {
    const students = enrollments.map(e => e.student!).filter(Boolean)
    const computed = students.map(student => {
      const perSubject: Record<string, number> = {}
      let grandTotal = 0
      subjects.forEach(subj => {
        const subjResults = resultsBySubject[subj.id] ?? []
        const totalRow = subjResults.find(r => r.student_id === student.id && r.is_total_field)
        const total = totalRow?.value ?? 0
        perSubject[subj.id] = total
        grandTotal += total
      })
      const average = subjects.length > 0 ? Math.round((grandTotal / subjects.length) * 100) / 100 : 0
      return { student, perSubject, grandTotal, average }
    })
    return computed.sort((a, b) => b.grandTotal - a.grandTotal)
  }, [enrollments, subjects, resultsBySubject])

  const classLabel = (cls?: Class) =>
    cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  const selectedSession = sessions.find(s => s.id === effectiveSessionId)

  const downloadBroadsheet = async () => {
    if (!broadsheetRef.current) return
    setDownloadingBroadsheet(true)
    const termSession = [selectedTerm?.name, selectedSession?.name].filter(Boolean).join('-')
    const filename = `${classLabel(selectedClass)}_Broadsheet_${termSession || ''}.pdf`.replace(/\s+/g, '_')
    toast.loading('Generating broadsheet PDF…', { id: 'broadsheet-pdf' })
    try {
      await exportNodeToPdf(broadsheetRef.current, filename)
      toast.success('Broadsheet downloaded', { id: 'broadsheet-pdf' })
    } catch {
      toast.error('Could not generate the broadsheet PDF', { id: 'broadsheet-pdf' })
    } finally {
      setDownloadingBroadsheet(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Full class broadsheet and report card generation"
      />

      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <Select value={effectiveSessionId} onValueChange={setSelectedSessionId}>
            <SelectTrigger className="sm:w-52"><SelectValue placeholder="Session" /></SelectTrigger>
            <SelectContent>
              {sessions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={effectiveTermId} onValueChange={setSelectedTermId}>
            <SelectTrigger className="sm:w-52"><SelectValue placeholder="Term" /></SelectTrigger>
            <SelectContent>
              {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="sm:w-52"><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {sections.length > 0 ? (
                groupBySection(classes, c => c.class_level, sections).map(group => (
                  <SelectGroup key={group.section?.id ?? 'ungrouped'}>
                    <SelectLabel>{group.section?.name ?? 'Ungrouped'}</SelectLabel>
                    {group.items.map(cls => <SelectItem key={cls.id} value={cls.id}>{classLabel(cls)}</SelectItem>)}
                  </SelectGroup>
                ))
              ) : (
                classes.map(cls => <SelectItem key={cls.id} value={cls.id}>{classLabel(cls)}</SelectItem>)
              )}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!selectedClassId || !effectiveTermId || !canUseBulkGeneration(subscriptionTier)}
            asChild={!!selectedClassId && !!effectiveTermId && canUseBulkGeneration(subscriptionTier)}
            className="sm:ml-auto"
            title={!canUseBulkGeneration(subscriptionTier) ? `Batch generation requires the Professional plan (currently ${tierLabel(subscriptionTier ?? 'free')})` : undefined}
          >
            {selectedClassId && effectiveTermId && canUseBulkGeneration(subscriptionTier) ? (
              <Link to={`/school/reports/bulk-report-cards?class=${selectedClassId}&term=${effectiveTermId}&session=${effectiveSessionId}`}>
                <FileArchive className="mr-2 h-4 w-4" />Bulk Generate
              </Link>
            ) : (
              <><FileArchive className="mr-2 h-4 w-4" />Bulk Generate</>
            )}
          </Button>
          <Button
            variant="outline"
            disabled={!selectedClassId || !canUseBulkGeneration(subscriptionTier)}
            asChild={!!selectedClassId && canUseBulkGeneration(subscriptionTier)}
            title={!canUseBulkGeneration(subscriptionTier) ? `Batch generation requires the Professional plan (currently ${tierLabel(subscriptionTier ?? 'free')})` : undefined}
          >
            {selectedClassId && canUseBulkGeneration(subscriptionTier) ? (
              <Link to={`/school/reports/bulk-transcripts?class=${selectedClassId}&session=${effectiveSessionId}`}>
                <FileArchive className="mr-2 h-4 w-4" />Bulk Transcripts
              </Link>
            ) : (
              <><FileArchive className="mr-2 h-4 w-4" />Bulk Transcripts</>
            )}
          </Button>
          <Button variant="outline" disabled={!selectedClassId || !effectiveTermId || downloadingBroadsheet || rows.length === 0} onClick={downloadBroadsheet}>
            {downloadingBroadsheet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Broadsheet
          </Button>
        </CardContent>
      </Card>

      {!selectedClassId ? (
        <EmptyState icon={<ClipboardList className="h-12 w-12" />} title="Select a class" description="Choose a session, term, and class to view its broadsheet." />
      ) : !selectedTerm ? (
        <EmptyState title="Select a term" />
      ) : subjects.length === 0 ? (
        <EmptyState title="No subjects offered at this class level" description="Add subjects under Subjects → Class Level Offerings." />
      ) : loadingResults ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No students enrolled" />
      ) : (
        <Card>
          <CardContent className="p-0" ref={broadsheetRef}>
            <div className="bg-white force-light-surface p-6" style={{ borderTop: `4px solid ${school?.primary_color ?? '#1e3a8a'}` }}>
              {/* Header: school branding + which class/term/session this is —
                  previously the exported PDF was just the bare table with no
                  indication of any of this at all. */}
              <div className="flex items-center gap-3 border-b-2 pb-3 mb-3" style={{ borderColor: school?.secondary_color ?? '#3b82f6' }}>
                {school?.logo_url && <img src={school.logo_url} alt="" className="h-12 w-12 object-contain shrink-0" />}
                <div className="flex-1 text-center">
                  <h1 className="font-bold leading-tight text-lg" style={{ color: school?.primary_color ?? '#1e3a8a' }}>{school?.name}</h1>
                  {school?.address && <p className="text-muted-foreground text-xs">{school.address}</p>}
                </div>
                {school?.logo_url && <div className="h-12 w-12 shrink-0" />}
              </div>
              <p className="text-center font-semibold text-sm mb-4">
                Broadsheet — {classLabel(selectedClass)} — {selectedTerm?.name} — {sessions.find(s => s.id === effectiveSessionId)?.name}
              </p>

              <div className="overflow-x-auto">
                <Table containerClassName="max-h-[70vh]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 top-0 z-30 bg-background w-8 px-2 py-2 text-xs">Pos</TableHead>
                      <TableHead className="sticky left-8 top-0 z-30 bg-background px-2 py-2 text-xs">Student</TableHead>
                      {subjects.map(s => (
                        <TableHead key={s.id} className="sticky top-0 z-20 bg-background text-center whitespace-nowrap px-1.5 py-2 text-xs w-14">{s.code ?? s.name.slice(0, 3).toUpperCase()}</TableHead>
                      ))}
                      <TableHead className="sticky top-0 z-20 bg-background text-center font-semibold px-2 py-2 text-xs w-14">Total</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background text-center font-semibold px-2 py-2 text-xs w-16">Avg</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-background w-8 px-1 no-print" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={row.student.id}>
                        <TableCell className="sticky left-0 z-10 bg-background px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {idx === 0 && <Trophy className="h-3 w-3 text-yellow-500" />}
                            <span className="text-xs font-medium">{ordinalSuffix(idx + 1)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="sticky left-8 z-10 bg-background font-medium text-xs whitespace-nowrap px-2 py-1.5">
                          {row.student.last_name}, {row.student.first_name}
                        </TableCell>
                        {subjects.map(s => (
                          <TableCell key={s.id} className="text-center text-xs px-1.5 py-1.5">{row.perSubject[s.id] || '—'}</TableCell>
                        ))}
                        <TableCell className="text-center font-semibold text-xs px-2 py-1.5">{row.grandTotal}</TableCell>
                        <TableCell className="text-center px-2 py-1.5">
                          <Badge variant={row.average >= 50 ? 'success' : 'destructive'} className="text-[10px] px-1.5 py-0">{row.average}</Badge>
                        </TableCell>
                        <TableCell className="px-1 py-1.5 no-print">
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <Link to={`/school/reports/report-card?student=${row.student.id}&class=${selectedClassId}&term=${effectiveTermId}&session=${effectiveSessionId}`} aria-label={`View report card for ${row.student.first_name} ${row.student.last_name}`}>
                              <FileText className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Footer: generation date + signature line, same treatment as
                  report cards/transcripts */}
              <div className="flex items-center justify-between mt-6 pt-3 border-t text-xs text-muted-foreground" style={{ borderColor: school?.secondary_color ?? '#3b82f6' }}>
                <span>Generated {new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <div className="text-center">
                  <div className="h-8 flex items-end justify-center">
                    {school?.principal_signature_url && <img src={school.principal_signature_url} alt="" className="max-h-8 object-contain" />}
                  </div>
                  <div className="border-t border-dashed mt-0.5 w-32" />
                  <p className="mt-0.5">Principal's Signature</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
