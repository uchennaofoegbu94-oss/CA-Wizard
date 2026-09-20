import { forwardRef } from 'react'
import { formatDateTime } from '@/lib/utils'
import type { School, Class, Subject, Term } from '@/types'

// Pure presentational, no data-fetching of its own — same convention as
// ReportCardDocument, for the same reason: the caller (ScoreEntryPage)
// already has every value in state, and keeping this component free of
// hooks/queries is what makes "exactly as it appears on screen right
// now" a true statement rather than a second, possibly-out-of-sync
// fetch of the same data.
//
// Deliberately renders every value as plain text, never as an <input>
// — html2canvas (which captures this node to the PDF) is known to
// render form control VALUES unreliably, especially controlled React
// inputs, so a live capture of the actual editable grid would risk
// producing a PDF with blank cells. A dedicated read-only render sidesteps
// that entirely, the same way the real report card and broadsheet
// already do rather than capturing their interactive equivalents.
export interface PreCaColumn {
  key: string       // field id for an input column, or 'preview:<field_id>' for a computed one
  label: string
  maxValue: number
  isComputed: boolean
}

export interface PreCaRow {
  studentId: string
  name: string
  admissionNumber: string
  values: Record<string, number | null> // keyed by PreCaColumn.key
}

export interface PreCaDocumentProps {
  school: School | null | undefined
  cls: Class | null | undefined
  subject: Subject | null | undefined
  term: Term | null | undefined
  teacherName: string
  generatedAt: Date
  columns: PreCaColumn[]
  rows: PreCaRow[]
}

export const PreCaDocument = forwardRef<HTMLDivElement, PreCaDocumentProps>(function PreCaDocument(
  { school, cls, subject, term, teacherName, generatedAt, columns, rows },
  ref
) {
  const primaryColor = school?.primary_color ?? '#1e3a8a'
  const secondaryColor = school?.secondary_color ?? '#3b82f6'
  const classLabel = cls ? `${cls.class_level?.name ?? ''}${cls.class_arm ? ' ' + cls.class_arm.name : ''}`.trim() : ''

  return (
    <div
      ref={ref}
      className="bg-white force-light-surface px-8 py-6"
      style={{ borderTop: `5px solid ${primaryColor}`, fontSize: '11px', width: '1100px' }}
    >
      {/* Letterhead — same convention as ReportCardDocument, so a
          Pre-CA sheet is instantly recognizable as belonging to the
          same school/branding as every other generated document. */}
      <div className="flex items-center gap-3 border-b-2 pb-3 mb-4" style={{ borderColor: secondaryColor }}>
        {school?.logo_url && <img src={school.logo_url} alt="" className="h-12 w-12 object-contain shrink-0" />}
        <div className="flex-1 text-center">
          <h1 className="font-bold leading-tight" style={{ color: primaryColor, fontSize: '20px' }}>{school?.name}</h1>
          {school?.motto && <p className="italic text-muted-foreground" style={{ fontSize: '10px' }}>"{school.motto}"</p>}
        </div>
        {school?.logo_url && <div className="h-12 w-12 shrink-0" />}
      </div>

      <p className="text-center font-semibold mb-1" style={{ fontSize: '15px', color: primaryColor }}>Pre-CA</p>
      <p className="text-center text-muted-foreground mb-4" style={{ fontSize: '10px' }}>
        Working score sheet — not an official result. Generated {formatDateTime(generatedAt)}
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4" style={{ fontSize: '11px' }}>
        <p><span className="text-muted-foreground">Class:</span> <strong>{classLabel}</strong></p>
        <p><span className="text-muted-foreground">Subject:</span> <strong>{subject?.name}</strong></p>
        <p><span className="text-muted-foreground">Term:</span> {term?.name}{cls?.session?.name ? ` — ${cls.session.name}` : ''}</p>
        <p><span className="text-muted-foreground">Teacher:</span> {teacherName}</p>
      </div>

      <table className="w-full border-collapse" style={{ fontSize: '10.5px' }}>
        <thead>
          <tr style={{ backgroundColor: primaryColor }}>
            <th className="text-white text-left p-2 border" style={{ borderColor: secondaryColor }}>#</th>
            <th className="text-white text-left p-2 border" style={{ borderColor: secondaryColor }}>Student</th>
            <th className="text-white text-left p-2 border" style={{ borderColor: secondaryColor }}>Adm. No.</th>
            {columns.map(col => (
              <th key={col.key} className="text-white text-center p-2 border" style={{ borderColor: secondaryColor }}>
                {col.label}{col.isComputed ? ' (Σ)' : ''}<br /><span style={{ fontWeight: 400, fontSize: '9px' }}>/{col.maxValue}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.studentId} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
              <td className="p-2 border" style={{ borderColor: '#e2e8f0' }}>{i + 1}</td>
              <td className="p-2 border font-medium" style={{ borderColor: '#e2e8f0' }}>{row.name}</td>
              <td className="p-2 border" style={{ borderColor: '#e2e8f0' }}>{row.admissionNumber}</td>
              {columns.map(col => (
                <td key={col.key} className="p-2 border text-center" style={{ borderColor: '#e2e8f0' }}>
                  {row.values[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
