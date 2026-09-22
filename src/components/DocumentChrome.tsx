import React from 'react'
import { formatDate } from '@/lib/utils'
import type { School } from '@/types'

// Shared by every generated document (report card, transcript, Pre-CA,
// broadsheet) so a school's downloads read as one consistent family —
// pulled together after comparing our own documents against a
// reference PDF from another platform (ReflectED, for Mirror
// International School) the user liked the look of. What's actually
// borrowed from it: a solid colour-filled header band instead of a
// thin border, a badge-backed logo (so a logo with a transparent or
// light background stays legible sitting on a colour fill), a
// right-aligned document-type label, a filled/white-text table header
// row instead of a faint tint, visible cell borders, and a compact
// "school • powered by" footer credit.
//
// What's deliberately NOT copied: the reference hardcodes one navy/
// gold palette for its one school. Every colour here comes from the
// `school` prop's own primary_color/secondary_color — this has to
// stay genuinely multi-tenant, which is the whole point of a school
// branding system in the first place. A QR code and a graphic
// "APPROVED" stamp seal are also left out — those aren't styling, they
// imply a verification feature (a scannable link resolving to a real
// record) that's a product decision on its own, not a restyle. Noted
// as a follow-up rather than faked with a placeholder image.

export interface DocumentHeaderProps {
  school: School | null | undefined
  documentType: string // e.g. "REPORT CARD", "TRANSCRIPT", "BROADSHEET", "PRE-CA"
  primaryColor: string
  secondaryColor: string
  compact?: boolean // tighter vertical rhythm for the single-page report card, which has a fixed page budget
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({ school, documentType, primaryColor, secondaryColor, compact }) => {
  const contactLine = [school?.address, school?.phone, school?.email].filter(Boolean).join('  •  ')
  const badgeSize = compact ? 40 : 52

  return (
    <div>
      <div
        className="flex items-center gap-3"
        style={{ backgroundColor: primaryColor, padding: compact ? '10px 20px' : '14px 24px' }}
      >
        {school?.logo_url ? (
          <div
            className="shrink-0 rounded-full bg-white flex items-center justify-center overflow-hidden"
            style={{ width: badgeSize, height: badgeSize, padding: 3 }}
          >
            <img src={school.logo_url} alt="" className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="shrink-0" style={{ width: badgeSize, height: badgeSize }} />
        )}

        <div className="flex-1 min-w-0">
          <h1 className="font-bold leading-tight text-white truncate" style={{ fontSize: compact ? '15px' : '17px' }}>
            {school?.name}
          </h1>
          {contactLine && (
            <p className="truncate" style={{ fontSize: compact ? '8px' : '9px', color: 'rgba(255,255,255,0.75)' }}>
              {contactLine}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <span
            className="font-bold tracking-wide"
            style={{ fontSize: compact ? '11px' : '13px', color: secondaryColor, letterSpacing: '0.06em' }}
          >
            {documentType}
          </span>
        </div>
      </div>
      {/* Accent divider, echoing the reference's gold rule under its header band */}
      <div style={{ height: 3, backgroundColor: secondaryColor }} />
    </div>
  )
}

export interface DocumentFooterProps {
  school: School | null | undefined
  secondaryColor: string
  rightText?: string // e.g. "Page 1 of 2" for a multi-page document; defaults to a generated-on date
}

export const DocumentFooter: React.FC<DocumentFooterProps> = ({ school, secondaryColor, rightText }) => (
  <div>
    <div style={{ height: 2, backgroundColor: secondaryColor, opacity: 0.5 }} />
    <div className="flex items-center justify-between pt-1.5" style={{ fontSize: '8px' }}>
      <span className="text-muted-foreground">{school?.name} &middot; Powered by CA-Wizard</span>
      <span className="text-muted-foreground">{rightText ?? `Generated ${formatDate(new Date().toISOString())}`}</span>
    </div>
  </div>
)

// Shared table header row style (filled colour + white text) — used
// as a style object rather than a component since each document's
// table has a different column set.
export const documentTableHeaderStyle = (primaryColor: string): React.CSSProperties => ({
  backgroundColor: primaryColor,
  color: '#ffffff'
})

export const documentCellBorderColor = '#e2e8f0'
