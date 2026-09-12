import { forwardRef } from 'react'
import type { Student, School } from '@/types'

// Mirrors ReportCardDocument's reasoning exactly: pure presentational,
// no data-fetching of its own, so the single-student TranscriptPage and
// BulkTranscriptPage render from the exact same markup and can't drift
// out of visual sync.
//
// Unlike the report card, this deliberately does NOT get the fixed-
// height single-page treatment — a transcript spans however many
// sessions a student has been enrolled in and is expected to run
// multiple pages; pdfExport's existing multi-page slicing already
// handles that correctly.

const TERM_ORDER: Record<string, number> = { 'First Term': 0, 'Second Term': 1, 'Third Term': 2 }

export interface SnapshotSubjectRow { subject: { id: string; name: string }; total: number; grade: string; remark: string }
export interface SnapshotDomainRow { name: string; rating: string | null }

export interface SnapshotRow {
  id: string
  term_id: string
  snapshot_data: {
    term?: string
    class?: string
    subjects?: SnapshotSubjectRow[]
    grandTotal?: number
    average?: number
    student?: { photo_url?: string | null }
    affective?: SnapshotDomainRow[]
    psychomotor?: SnapshotDomainRow[]
  }
  term_info: { name: string; session: { id: string; name: string; start_year: number } }
}

export interface TranscriptDocumentProps {
  school: School | null | undefined
  student: Student | null | undefined
  groupedBySessions: { name: string; startYear: number; rows: SnapshotRow[] }[]
  overallAverage: number
  snapshotCount: number
  compiledAffective: { name: string; average: number }[]
  compiledPsychomotor: { name: string; average: number }[]
  studentPhoto: string | null
}

export const TranscriptDocument = forwardRef<HTMLDivElement, TranscriptDocumentProps>(function TranscriptDocument(
  { school, student, groupedBySessions, overallAverage, snapshotCount, compiledAffective, compiledPsychomotor, studentPhoto },
  ref
) {
  const primaryColor = school?.primary_color ?? '#1e3a8a'
  const secondaryColor = school?.secondary_color ?? '#3b82f6'

  return (
    <div ref={ref} className="relative bg-white force-light-surface p-8" style={{ borderTop: `6px solid ${primaryColor}` }}>
      {school?.watermark_url && (
        <img src={school.watermark_url} alt="" className="absolute inset-0 m-auto max-h-96 max-w-96 opacity-[0.06] pointer-events-none select-none" />
      )}

      <div className="relative">
        <div className="text-center border-b-2 pb-4 mb-6" style={{ borderColor: secondaryColor }}>
          {school?.logo_url && <img src={school.logo_url} alt="" className="h-16 mx-auto mb-2 object-contain" />}
          <h1 className="font-bold" style={{ color: primaryColor, fontSize: '20px' }}>{school?.name}</h1>
          {school?.motto && <p className="italic text-muted-foreground text-sm">"{school.motto}"</p>}
          <p className="text-sm font-semibold mt-3">Official Academic Transcript</p>
        </div>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="grid grid-cols-2 gap-2 text-sm flex-1">
            <p><span className="text-muted-foreground">Name:</span> <strong>{student?.first_name} {student?.last_name}</strong></p>
            <p><span className="text-muted-foreground">Admission No:</span> {student?.admission_number}</p>
            <p><span className="text-muted-foreground">Overall Average:</span> <strong>{overallAverage}%</strong></p>
            <p><span className="text-muted-foreground">Terms Recorded:</span> {snapshotCount}</p>
          </div>
          {studentPhoto ? (
            <img src={studentPhoto} alt="" className="h-20 w-20 rounded-md object-cover border-2 shrink-0" style={{ borderColor: secondaryColor }} />
          ) : (
            <div className="h-20 w-20 rounded-md flex items-center justify-center text-white font-semibold text-lg shrink-0" style={{ backgroundColor: primaryColor }}>
              {student ? `${student.first_name[0]}${student.last_name[0]}` : ''}
            </div>
          )}
        </div>

        <div className="space-y-8">
          {groupedBySessions.map(session => (
            <div key={session.name}>
              <h2 className="text-sm font-bold mb-2" style={{ color: primaryColor }}>{session.name}</h2>
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map(termIdx => {
                  const snap = session.rows.find(r => (TERM_ORDER[r.term_info.name] ?? -1) === termIdx)
                  if (!snap) {
                    return (
                      <div key={termIdx} className="border rounded-md p-2 flex items-center justify-center text-xs text-muted-foreground min-h-[120px]">
                        No record
                      </div>
                    )
                  }
                  return (
                    <div key={termIdx} className="border rounded-md p-2" style={{ borderColor: `${secondaryColor}40` }}>
                      <p className="text-xs font-semibold mb-1.5 pb-1 border-b" style={{ color: primaryColor, borderColor: secondaryColor }}>
                        {snap.term_info.name}
                      </p>
                      <table className="w-full text-[10px]">
                        <tbody>
                          {(snap.snapshot_data.subjects ?? []).map((r, i) => (
                            <tr key={i} className="border-b border-dashed">
                              <td className="py-0.5 pr-1 truncate max-w-[70px]">{r.subject?.name}</td>
                              <td className="py-0.5 text-right font-semibold">{r.total}</td>
                              <td className="py-0.5 text-right pl-1" style={{ color: primaryColor }}>{r.grade}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-between mt-1.5 pt-1 border-t text-[10px] font-semibold" style={{ borderColor: secondaryColor }}>
                        <span>Total: {snap.snapshot_data.grandTotal}</span>
                        <span>Avg: {snap.snapshot_data.average}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {(compiledAffective.length > 0 || compiledPsychomotor.length > 0) && (
          <div className="grid grid-cols-2 gap-6 mt-8 pt-6 border-t" style={{ borderColor: secondaryColor }}>
            {compiledAffective.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: primaryColor }}>Affective Domain (Overall Average)</h3>
                {compiledAffective.map(d => (
                  <div key={d.name} className="flex justify-between text-sm py-0.5">
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-medium">{d.average}</span>
                  </div>
                ))}
              </div>
            )}
            {compiledPsychomotor.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: primaryColor }}>Psychomotor Domain (Overall Average)</h3>
                {compiledPsychomotor.map(d => (
                  <div key={d.name} className="flex justify-between text-sm py-0.5">
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-medium">{d.average}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-8 mt-10 pt-6 border-t text-sm" style={{ borderColor: secondaryColor }}>
          <div className="text-center">
            <div className="h-10 flex items-end justify-center">
              {school?.teacher_signature_url && <img src={school.teacher_signature_url} alt="" className="max-h-10 object-contain" />}
            </div>
            <div className="border-t border-dashed mt-0.5" />
            <p className="text-xs text-muted-foreground mt-1">Class Teacher's Signature</p>
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
            <p className="text-xs text-muted-foreground mt-1">Principal's Signature &amp; Stamp</p>
          </div>
        </div>
      </div>
    </div>
  )
})
