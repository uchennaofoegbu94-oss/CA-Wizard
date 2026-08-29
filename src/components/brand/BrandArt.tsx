// Inline SVG brand art. Deliberately NOT loaded via <img src="/*.svg">
// (which was where the actual rendering bug came from — see the git
// history around when these were first added) — every path/gradient
// here is compiled directly into the JS bundle, so there is no
// separate network request, no MIME-type dependency, no file-path
// dependency, and no caching layer that can serve something stale or
// broken. What renders in the browser is exactly what's written here,
// full stop.
//
// public/favicon.svg (and the derived favicon.ico / PWA icon PNGs)
// still exist as real files — those genuinely have to be files for
// the browser tab icon and "Add to Home Screen" to work — but nothing
// in-page reads them anymore.

export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="CA-Wizard"
    >
      <defs>
        <linearGradient id="logo-mark-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#logo-mark-g)" />
      <path d="M32 15.5 L52 24 L32 32.5 L12 24 Z" fill="#ffffff" />
      <path
        d="M20 27.3 V37 C20 40.5 25.4 43.5 32 43.5 C38.6 43.5 44 40.5 44 37 V27.3 L32 32.5 Z"
        fill="#ffffff"
        fillOpacity={0.92}
      />
      <path d="M49.5 26.2 V36.5" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" />
      <circle cx="49.5" cy="39.2" r="2.3" fill="#ffffff" />
    </svg>
  )
}

export function HeroVisual({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 480" width="100%" height="100%" className={className} role="presentation" aria-hidden="true">
      <defs>
        <radialGradient id="hero-blob1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#3b82f6" stopOpacity={0.35} />
          <stop offset="1" stopColor="#3b82f6" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="hero-blob2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#818cf8" stopOpacity={0.28} />
          <stop offset="1" stopColor="#818cf8" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="hero-panel-border" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.16} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0.03} />
        </linearGradient>
        <linearGradient id="hero-bar-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      <circle cx="180" cy="140" r="180" fill="url(#hero-blob1)" />
      <circle cx="470" cy="340" r="160" fill="url(#hero-blob2)" />

      {/* back panel: grade distribution bars, gently rotated */}
      <g transform="translate(60,150) rotate(-6)">
        <rect width="230" height="230" rx="18" fill="#0f172a" fillOpacity={0.5} stroke="url(#hero-panel-border)" />
        <rect x="24" y="24" width="120" height="12" rx="6" fill="#93c5fd" fillOpacity={0.5} />
        <rect x="24" y="46" width="80" height="9" rx="4.5" fill="#64748b" fillOpacity={0.55} />
        <rect x="28" y="150" width="24" height="50" rx="4" fill="url(#hero-bar-fill)" fillOpacity={0.9} />
        <rect x="64" y="120" width="24" height="80" rx="4" fill="url(#hero-bar-fill)" />
        <rect x="100" y="95" width="24" height="105" rx="4" fill="url(#hero-bar-fill)" />
        <rect x="136" y="130" width="24" height="70" rx="4" fill="url(#hero-bar-fill)" fillOpacity={0.75} />
        <rect x="172" y="160" width="24" height="40" rx="4" fill="url(#hero-bar-fill)" fillOpacity={0.55} />
      </g>

      {/* front panel: report card mockup */}
      <g transform="translate(260,90) rotate(4)">
        <rect width="290" height="320" rx="20" fill="#111827" stroke="url(#hero-panel-border)" />
        <rect x="26" y="30" width="150" height="14" rx="7" fill="#93c5fd" fillOpacity={0.6} />
        <rect x="26" y="54" width="90" height="10" rx="5" fill="#64748b" fillOpacity={0.6} />
        <rect x="26" y="90" width="238" height="1" fill="#334155" />

        <g opacity={0.9}>
          <rect x="26" y="112" width="150" height="11" rx="5.5" fill="#cbd5e1" fillOpacity={0.35} />
          <rect x="222" y="110" width="42" height="16" rx="5" fill="#3b82f6" fillOpacity={0.5} stroke="#3b82f6" strokeOpacity={0.5} />
        </g>
        <g opacity={0.75}>
          <rect x="26" y="140" width="110" height="11" rx="5.5" fill="#cbd5e1" fillOpacity={0.3} />
          <rect x="222" y="138" width="42" height="16" rx="5" fill="#22c55e" fillOpacity={0.35} stroke="#22c55e" strokeOpacity={0.5} />
        </g>
        <g opacity={0.85}>
          <rect x="26" y="168" width="130" height="11" rx="5.5" fill="#cbd5e1" fillOpacity={0.32} />
          <rect x="222" y="166" width="42" height="16" rx="5" fill="#3b82f6" fillOpacity={0.5} stroke="#3b82f6" strokeOpacity={0.5} />
        </g>
        <g opacity={0.7}>
          <rect x="26" y="196" width="95" height="11" rx="5.5" fill="#cbd5e1" fillOpacity={0.28} />
          <rect x="222" y="194" width="42" height="16" rx="5" fill="#f59e0b" fillOpacity={0.35} stroke="#f59e0b" strokeOpacity={0.5} />
        </g>

        <rect x="26" y="230" width="238" height="1" fill="#334155" />

        <rect x="26" y="254" width="110" height="46" rx="10" fill="#1e293b" stroke="#334155" />
        <rect x="150" y="254" width="114" height="46" rx="10" fill="#3b82f6" fillOpacity={0.18} stroke="#3b82f6" strokeOpacity={0.4} />
        <circle cx="207" cy="270" r="9" fill="#3b82f6" />
        <rect x="222" y="266" width="34" height="8" rx="4" fill="#93c5fd" fillOpacity={0.7} />
      </g>

      {/* floating checkmark badge accent */}
      <g transform="translate(492,300)">
        <circle r="26" fill="#0f172a" stroke="#22c55e" strokeOpacity={0.5} />
        <path d="M-10 0 L-3 8 L11 -9" stroke="#4ade80" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    </svg>
  )
}
