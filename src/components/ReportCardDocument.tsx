import { forwardRef } from 'react'
import { formatDate, initials, ordinalSuffix } from '@/lib/utils'
import { DocumentHeader, DocumentFooter, documentTableHeaderStyle, documentCellBorderColor } from './DocumentChrome'
import type {
  Student, Class, Term, School, GradeRange, Attendance, Comment,
  AffectiveMetric, AffectiveScore, PsychomotorMetric, PsychomotorScore
} from '@/types'

// Pure presentational report card. Deliberately has no data-fetching of its
// own — every value it needs is passed in as a prop — so it can be reused
// both by the single-student ReportCardPage (one query set, one document)
// and by BulkReportCardPage (many students, many rows of precomputed data,
// rendered off-screen and captured to PDF one at a time). Keeping this
// component free of hooks/queries is what prevents the single and bulk
// report cards from drifting out of visual sync over time.

// ── Fixed A4-proportioned page ──────────────────────────────
// 780px wide matches the existing capture-width convention used
// elsewhere (BulkReportCardPage's off-screen render). Height is that
// same width scaled to A4's real 210mm : 297mm ratio, so this is
// genuinely "one page," not an approximation.
const PAGE_WIDTH_PX = 780
const PAGE_HEIGHT_PX = Math.round(PAGE_WIDTH_PX * (297 / 210)) // 1103

// Fixed row count for the subjects table, regardless of how many
// subjects actually have scores — this is what gives every report
// card the same shape whether it's a 5-subject or 17-subject class.
// Superseded the earlier dynamic scale-to-fit approach: that made the
// page fit correctly, but a shorter subject list left the whole middle
// section vertically centered (floating below the header instead of
// starting immediately under it) and the page's *visual density*
// still varied card to card. Padding to a constant row count fixes
// both — content always starts right under the photo, and the table
// itself is always the same height.
// Trimmed from 20 to 17 to make room for the new branded header band
// + footer credit line below (see DocumentChrome) within the same
// fixed one-page budget — a school with more than 17 subjects still
// never gets truncated, just a taller table, exactly as before.
const SUBJECT_ROW_SLOTS = 17

// A school-configurable field's value for one subject row. Only fields
// with show_on_report_card=true are ever passed in here — the caller
// filters before handing rows to this component.
export interface ReportCardFieldValue {
  field_id: string
  value: number
}

export interface ReportCardRow {
  subject: { id: string; name: string }
  fields: ReportCardFieldValue[] // parallel to fieldColumns, looked up by field_id
  total: number
  totalMax: number
  percentage: number
  grade: string
  remark: string
}

export interface ReportCardPosition {
  rank: number
  outOf: number
}

export interface ReportCardDocumentProps {
  school: School | null | undefined
  student: Student | null | undefined
  cls: Class | null | undefined
  term: Term | null | undefined
  // The school's configured, show_on_report_card, non-total fields, in
  // order_index order — these become the dynamic columns between
  // Subject and Total. Total/Grade/Remark are always rendered
  // regardless of what's in here, per the system guarantee.
  fieldColumns: { id: string; name: string }[]
  rows: ReportCardRow[]
  grandTotal: number
  average: number
  position: ReportCardPosition | null
  attendance: Attendance | null | undefined
  comment: Comment | null | undefined
  gradeRanges: GradeRange[]
  affectiveMetrics: AffectiveMetric[]
  affectiveScores: AffectiveScore[]
  psychomotorMetrics: PsychomotorMetric[]
  psychomotorScores: PsychomotorScore[]
}

export const ReportCardDocument = forwardRef<HTMLDivElement, ReportCardDocumentProps>(function ReportCardDocument(
  {
    school, student, cls, term, fieldColumns, rows, grandTotal, average, position,
    attendance, comment, gradeRanges, affectiveMetrics, affectiveScores,
    psychomotorMetrics, psychomotorScores
  },
  ref
) {
  const primaryColor = school?.primary_color ?? '#1e3a8a'
  const secondaryColor = school?.secondary_color ?? '#3b82f6'

  // Overall remark for the Performance Summary box — reads off the
  // exact same grading system as each subject's per-row grade/remark
  // (gradeRanges is already threaded through as a prop), just matched
  // against the student's overall average instead of one subject's
  // percentage. Kept local to this component rather than passed in
  // separately so every caller (ReportCardPage, BulkReportCardPage)
  // doesn't have to duplicate the lookup.
  const overallRemark = gradeRanges.find(r => average >= r.min_score && average <= r.max_score)?.remark ?? null

  // Pad (never truncate — a school with more than 20 subjects just gets
  // a taller table, rather than silently dropping subjects) to a
  // constant number of row slots.
  const rowSlots: (ReportCardRow | null)[] = [
    ...rows,
    ...Array.from({ length: Math.max(0, SUBJECT_ROW_SLOTS - rows.length) }, () => null)
  ]

  return (
    <div
      ref={ref}
      className="relative bg-white force-light-surface flex flex-col overflow-hidden"
      style={{ fontSize: '10.5px', width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX }}
    >
      {school?.watermark_url && (
        <img src={school.watermark_url} alt="" className="absolute inset-0 m-auto max-h-56 max-w-56 opacity-[0.06] pointer-events-none select-none" />
      )}

      {/* Full-bleed branded band, edge to edge — everything else below stays inset */}
      <DocumentHeader school={school} documentType="REPORT CARD" primaryColor={primaryColor} secondaryColor={secondaryColor} compact />

      <div className="relative flex flex-col flex-1 min-h-0 px-7 pb-6">
        {/* ── Header: always pinned to the top of the page ── */}
        <div className="shrink-0">
          {/* Term/session label bar — echoes the reference PDF's dark
              term bar, sized to stay within this page's tight budget */}
          <div
            className="flex items-center justify-between px-2.5 py-1 mt-3 mb-2 rounded"
            style={{ backgroundColor: primaryColor, fontSize: '9.5px' }}
          >
            <span className="text-white font-semibold">{term?.name} — {cls?.session?.name}</span>
            {position && <span className="text-white" style={{ opacity: 0.85 }}>Avg: {average}%  •  Position: {ordinalSuffix(position.rank)}/{position.outOf}</span>}
          </div>

          {/* Student info bar — light tint instead of the reference's
              gray-blue, using the school's own secondary colour so it
              stays on-brand per school rather than a fixed gray */}
          <div
            className="flex items-start gap-3 mb-2 px-2.5 py-2 rounded"
            style={{ backgroundColor: `${secondaryColor}12` }}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 flex-1" style={{ fontSize: '10px' }}>
              <p><span className="text-muted-foreground">Name:</span> <strong style={{ fontSize: '11.5px' }}>{student?.first_name} {student?.last_name}</strong></p>
              <p><span className="text-muted-foreground">Adm. No:</span> {student?.admission_number}</p>
              <p><span className="text-muted-foreground">Class:</span> {cls?.class_level?.name}{cls?.class_arm ? ` ${cls.class_arm.name}` : ''}</p>
              <p><span className="text-muted-foreground">Date Issued:</span> {formatDate(new Date().toISOString())}</p>
            </div>
            {student?.photo_url ? (
              <img src={student.photo_url} alt="" className="h-16 w-16 rounded-md object-cover border-2 shrink-0" style={{ borderColor: secondaryColor }} />
            ) : (
              <div className="h-16 w-16 rounded-md flex items-center justify-center text-white font-semibold shrink-0" style={{ backgroundColor: primaryColor, fontSize: '16px' }}>
                {student ? initials(student.first_name, student.last_name) : ''}
              </div>
            )}
          </div>
        </div>

        {/* ── Middle: subjects table starts immediately below the photo
            (no centering — sits at the top of this flex-1 area), other
            sections follow directly after with minimal spacing, footer
            stays pinned to the bottom of the fixed page regardless of
            how much of this section is actually filled. ── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <table className="w-full border-collapse mb-2" style={{ fontSize: '10px' }}>
            <thead>
              <tr style={documentTableHeaderStyle(primaryColor)}>
                <th className="text-left py-1.5 px-1.5 font-semibold">Subject</th>
                {fieldColumns.map(col => (
                  <th key={col.id} className="text-center py-1.5 px-1 font-semibold w-10">{col.name}</th>
                ))}
                <th className="text-center py-1.5 px-1 font-semibold w-10">Total</th>
                <th className="text-center py-1.5 px-1 font-semibold w-8">Grd</th>
                <th className="text-left py-1.5 px-1.5 font-semibold">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rowSlots.map((r, i) => (
                <tr key={r?.subject.id ?? `empty-${i}`} style={{ border: `1px solid ${documentCellBorderColor}`, backgroundColor: i % 2 ? '#f8fafc' : '#ffffff', height: '19px' }}>
                  <td className="py-1 px-1.5" style={{ border: `1px solid ${documentCellBorderColor}` }}>{r?.subject.name ?? '\u00A0'}</td>
                  {fieldColumns.map(col => {
                    const fv = r?.fields.find(f => f.field_id === col.id)
                    return (
                      <td key={col.id} className="text-center py-1 px-1" style={{ border: `1px solid ${documentCellBorderColor}` }}>{fv?.value ?? ''}</td>
                    )
                  })}
                  <td className="text-center py-1 px-1 font-semibold" style={{ border: `1px solid ${documentCellBorderColor}` }}>{r?.total ?? ''}</td>
                  <td className="text-center py-1 px-1 font-semibold" style={{ border: `1px solid ${documentCellBorderColor}`, color: primaryColor }}>{r?.grade ?? ''}</td>
                  <td className="py-1 px-1.5 text-muted-foreground" style={{ border: `1px solid ${documentCellBorderColor}` }}>{r?.remark ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Performance / Attendance / Grade Scale — three compact boxes */}
          <div className="grid grid-cols-3 gap-2 mb-3" style={{ fontSize: '9px' }}>
            <div className="border rounded p-1.5" style={{ borderColor: `${secondaryColor}40` }}>
              <p className="font-semibold mb-1 pb-0.5 border-b" style={{ color: primaryColor, borderColor: secondaryColor, fontSize: '9.5px' }}>Performance Summary</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><strong>{grandTotal}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Average</span><strong>{average}</strong></div>
              {position && (
                <div className="flex justify-between"><span className="text-muted-foreground">Position</span><strong>{ordinalSuffix(position.rank)}/{position.outOf}</strong></div>
              )}
              {overallRemark && (
                <div className="flex justify-between"><span className="text-muted-foreground">Remark</span><strong>{overallRemark}</strong></div>
              )}
            </div>

            <div className="border rounded p-1.5" style={{ borderColor: `${secondaryColor}40` }}>
              <p className="font-semibold mb-1 pb-0.5 border-b" style={{ color: primaryColor, borderColor: secondaryColor, fontSize: '9.5px' }}>Attendance</p>
              {attendance ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Present</span><strong>{attendance.days_present}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Absent</span><strong>{attendance.days_absent}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total Days</span><strong>{attendance.total_days}</strong></div>
                </>
              ) : (
                <p className="text-muted-foreground">Not recorded</p>
              )}
            </div>

            {gradeRanges.length > 0 && (
              <div className="border rounded p-1.5" style={{ borderColor: `${secondaryColor}40` }}>
                <p className="font-semibold mb-1 pb-0.5 border-b" style={{ color: primaryColor, borderColor: secondaryColor, fontSize: '9.5px' }}>Grade Scale</p>
                {gradeRanges.slice().sort((a, b) => b.min_score - a.min_score).map(r => (
                  <div key={r.id} className="flex justify-between">
                    <span className="text-muted-foreground">{r.grade} ({r.min_score}-{r.max_score})</span>
                    <span>{r.remark}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(affectiveMetrics.length > 0 || psychomotorMetrics.length > 0) && (
            <div className="grid grid-cols-2 gap-4" style={{ fontSize: '9px' }}>
              {affectiveMetrics.length > 0 && (
                <RatingGrid title="Affective Domain" metrics={affectiveMetrics} scores={affectiveScores} color={primaryColor} borderColor={secondaryColor} />
              )}
              {psychomotorMetrics.length > 0 && (
                <RatingGrid title="Psychomotor Domain" metrics={psychomotorMetrics} scores={psychomotorScores} color={primaryColor} borderColor={secondaryColor} />
              )}
            </div>
          )}
        </div>

        {/* ── Footer: always pinned to the bottom of the page ── */}
        <div className="shrink-0">
          <div className="space-y-1.5 mb-4" style={{ fontSize: '9.5px' }}>
            <p><span className="font-semibold" style={{ color: primaryColor }}>Teacher's Comment: </span><span className="text-muted-foreground">{comment?.teacher_comment ?? 'Not recorded yet'}</span></p>
            <p><span className="font-semibold" style={{ color: primaryColor }}>Management's Comment: </span><span className="text-muted-foreground">{comment?.management_comment ?? 'Not recorded yet'}</span></p>
          </div>

          <div className="grid grid-cols-2 gap-8 pt-3 border-t" style={{ borderColor: secondaryColor, fontSize: '9px' }}>
            <div className="text-center">
              <div className="h-10 flex items-end justify-center">
                {school?.teacher_signature_url && <img src={school.teacher_signature_url} alt="" className="max-h-10 object-contain" />}
              </div>
              <div className="border-t border-dashed mt-0.5" />
              <p className="text-muted-foreground mt-0.5">Class Teacher's Signature</p>
            </div>
            <div className="text-center relative">
              <div className="h-10 flex items-end justify-center relative">
                {school?.principal_signature_url && <img src={school.principal_signature_url} alt="" className="max-h-10 object-contain" />}
                {school?.school_stamp_url && (
                  <img
                    src={school.school_stamp_url}
                    alt=""
                    className="absolute -right-2 -top-2 h-14 w-14 object-contain opacity-80 pointer-events-none select-none"
                    style={{ transform: 'rotate(-8deg)' }}
                  />
                )}
              </div>
              <div className="border-t border-dashed mt-0.5" />
              <p className="text-muted-foreground mt-0.5">Principal's Signature &amp; Stamp</p>
            </div>
          </div>

          <div className="mt-2">
            <DocumentFooter school={school} secondaryColor={secondaryColor} />
          </div>
        </div>
      </div>
    </div>
  )
})

const RATING_COLUMNS = ['5', '4', '3', '2', '1'] as const

interface RatingGridProps {
  title: string
  metrics: { id: string; name: string }[]
  scores: { metric_id: string; rating: string }[]
  color: string
  borderColor: string
}

function RatingGrid({ title, metrics, scores, color, borderColor }: RatingGridProps) {
  return (
    <div className="border rounded p-1.5" style={{ borderColor: `${borderColor}40` }}>
      <p className="font-semibold mb-1" style={{ color, fontSize: '9.5px' }}>{title}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left font-normal text-muted-foreground" style={{ fontSize: '8px' }}></th>
            {RATING_COLUMNS.map(r => (
              <th key={r} className="text-center font-semibold" style={{ fontSize: '8px', width: '14px' }}>{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => {
            const rating = scores.find(s => s.metric_id === m.id)?.rating
            return (
              <tr key={m.id} className="border-t" style={{ borderColor: '#f3f3f3' }}>
                <td className="py-0.5 text-muted-foreground truncate max-w-[90px]">{m.name}</td>
                {RATING_COLUMNS.map(r => (
                  <td key={r} className="text-center py-0.5" style={{ color }}>
                    {rating === r ? '●' : ''}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
