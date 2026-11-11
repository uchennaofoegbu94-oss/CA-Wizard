import React, { useLayoutEffect, useRef, useState } from 'react'
import { formatDate } from '@/lib/utils'
import type { School } from '@/types'

// Shared by every generated document (report card, transcript, Pre-CA,
// broadsheet) so a school's downloads read as one consistent family:
// a solid colour-filled header band, a badge-backed logo (legible even
// with a transparent/light logo on a colour fill), a right-aligned
// document-type label, a filled table header row, and a compact
// "school • powered by" footer credit. Every colour comes from the
// `school` prop's own primary/secondary colour — this stays genuinely
// multi-tenant.
//
// ── Why text is fitted in JS and never clipped by CSS ───────────────
// html2canvas (used by pdfExport.ts) slices the TOPS off glyphs when
// text sits inside an `overflow: hidden` box or uses Tailwind's
// `truncate` — regardless of height, line-height, or flex centring.
// This was confirmed with a controlled on/off comparison in a single
// capture run (identical line, with `overflow:hidden` clipped, without
// it perfect). So nothing in this file puts text under overflow:hidden.
// Instead `fitText` measures the string with canvas `measureText`,
// shrinks the font in 0.5px steps down to a floor, and only if it still
// doesn't fit cuts the string to a prefix plus a real "…" character.
// The result is plain, un-clipped text that html2canvas draws faithfully.
//
// The only `overflow-hidden` left is on the circular logo badge, which
// holds an <img> and no text.

export interface FitTextOptions {
  maxSize: number
  minSize: number
  weight?: number | string
  family?: string
  letterSpacingPx?: number
}
export interface FitTextResult { text: string; size: number }

let measureCtx: CanvasRenderingContext2D | null = null
function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

export function measureTextWidth(text: string, size: number, weight: number | string = 400, family = 'sans-serif', letterSpacingPx = 0): number {
  const ctx = getCtx()
  if (!ctx) return text.length * size * 0.55
  ctx.font = `${weight} ${size}px ${family}`
  return ctx.measureText(text).width + letterSpacingPx * text.length
}

export function fitText(text: string, availableWidth: number, opts: FitTextOptions): FitTextResult {
  const { maxSize, minSize, weight = 400, family = 'sans-serif', letterSpacingPx = 0 } = opts
  // Small safety margin: canvas measurement and DOM layout can differ by a pixel or so
  const avail = availableWidth - 2
  if (!text || avail <= 0 || !getCtx()) return { text, size: maxSize }
  const w = (t: string, s: number) => measureTextWidth(t, s, weight, family, letterSpacingPx)

  for (let s = maxSize; s > minSize; s -= 0.5) {
    if (w(text, s) <= avail) return { text, size: s }
  }
  if (w(text, minSize) <= avail) return { text, size: minSize }

  // Still too wide at the floor: longest prefix that fits together with a real ellipsis
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (w(text.slice(0, mid).trimEnd() + '\u2026', minSize) <= avail) lo = mid
    else hi = mid - 1
  }
  return { text: text.slice(0, lo).trimEnd() + '\u2026', size: minSize }
}

// Measures an element's width and computed font family (re-measured on resize)
function useMeasuredBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ width: 0, family: 'sans-serif' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const width = el.offsetWidth
      const family = getComputedStyle(el).fontFamily || 'sans-serif'
      setBox(prev => (prev.width === width && prev.family === family ? prev : { width, family }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

export interface DocumentHeaderProps {
  school: School | null | undefined
  documentType: string // e.g. "REPORT CARD", "TRANSCRIPT", "BROADSHEET", "PRE-CA"
  primaryColor: string
  secondaryColor: string
  compact?: boolean // tighter vertical rhythm for the single-page report card
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({ school, documentType, primaryColor, secondaryColor, compact }) => {
  const [bandRef, { width: bandWidth, family }] = useMeasuredBox<HTMLDivElement>()

  const contactLine = [school?.address, school?.phone, school?.email].filter(Boolean).join('  \u2022  ')
  const badgeSize = compact ? 40 : 52
  const pad = compact ? 10 : 14
  const sidePad = compact ? 20 : 24
  const bandHeight = badgeSize + pad * 2

  const labelSize = compact ? 11 : 13
  const labelSpacing = labelSize * 0.06
  const labelWidth = Math.ceil(measureTextWidth(documentType, labelSize, 700, family, labelSpacing)) + 2

  const textLeft = sidePad + badgeSize + 12
  const textWidth = Math.max(0, bandWidth - textLeft - sidePad - labelWidth - 14)

  const nameLH = compact ? 18 : 21
  const contactLH = compact ? 11 : 12
  const gap = 2
  const blockHeight = nameLH + (contactLine ? gap + contactLH : 0)
  const blockTop = Math.max(0, Math.round((bandHeight - blockHeight) / 2))

  const name = fitText(school?.name ?? '', textWidth, { maxSize: compact ? 15 : 17, minSize: 10, weight: 700, family })
  const contact = contactLine
    ? fitText(contactLine, textWidth, { maxSize: compact ? 8 : 9, minSize: 6.5, weight: 400, family })
    : null

  return (
    <div>
      <div ref={bandRef} style={{ position: 'relative', backgroundColor: primaryColor, height: bandHeight }}>
        {/* Logo badge — an <img> only, so overflow-hidden here is safe */}
        <div
          className="rounded-full bg-white flex items-center justify-center overflow-hidden"
          style={{ position: 'absolute', left: sidePad, top: pad, width: badgeSize, height: badgeSize, padding: 3 }}
        >
          {school?.logo_url && <img src={school.logo_url} alt="" className="h-full w-full object-contain" />}
        </div>

        {/* Document-type label: line-height equals band height, so it centres without flex */}
        <div
          className="font-bold"
          style={{
            position: 'absolute', right: sidePad, top: 0, height: bandHeight, lineHeight: `${bandHeight}px`,
            fontSize: labelSize, color: secondaryColor, letterSpacing: `${labelSpacing}px`, whiteSpace: 'nowrap', textAlign: 'right'
          }}
        >
          {documentType}
        </div>

        {/* School name + contact: plain nowrap blocks, width-fitted in JS, no overflow clipping */}
        <div
          className="font-bold text-white"
          style={{ position: 'absolute', left: textLeft, top: blockTop, width: textWidth, fontSize: name.size, lineHeight: `${nameLH}px`, whiteSpace: 'nowrap' }}
        >
          {name.text}
        </div>
        {contact && (
          <div
            style={{
              position: 'absolute', left: textLeft, top: blockTop + nameLH + gap, width: textWidth,
              fontSize: contact.size, lineHeight: `${contactLH}px`, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap'
            }}
          >
            {contact.text}
          </div>
        )}
      </div>
      {/* Accent divider under the header band */}
      <div style={{ height: 3, backgroundColor: secondaryColor }} />
    </div>
  )
}

export interface DocumentFooterProps {
  school: School | null | undefined
  secondaryColor: string
  rightText?: string // e.g. "Page 1 of 2"; defaults to a generated-on date
}

export const DocumentFooter: React.FC<DocumentFooterProps> = ({ school, secondaryColor, rightText }) => {
  const [boxRef, { width, family }] = useMeasuredBox<HTMLDivElement>()
  const right = rightText ?? `Generated ${formatDate(new Date().toISOString())}`
  const rightWidth = Math.ceil(measureTextWidth(right, 8, 400, family)) + 2
  const leftWidth = Math.max(0, width - rightWidth - 8)
  const left = fitText(`${school?.name ?? ''} \u00B7 Powered by CA-Wizard`, leftWidth, { maxSize: 8, minSize: 6, weight: 400, family })

  return (
    <div>
      <div style={{ height: 2, backgroundColor: secondaryColor, opacity: 0.5 }} />
      <div ref={boxRef} className="relative" style={{ height: 22 }}>
        <div className="text-muted-foreground" style={{ position: 'absolute', left: 0, top: 6, width: leftWidth, fontSize: left.size, lineHeight: '12px', whiteSpace: 'nowrap' }}>
          {left.text}
        </div>
        <div className="text-muted-foreground" style={{ position: 'absolute', right: 0, top: 6, width: rightWidth, fontSize: 8, lineHeight: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {right}
        </div>
      </div>
    </div>
  )
}

// Shared table header row style (filled colour + white text)
export const documentTableHeaderStyle = (primaryColor: string): React.CSSProperties => ({
  backgroundColor: primaryColor,
  color: '#ffffff'
})

export const documentCellBorderColor = '#e2e8f0'
