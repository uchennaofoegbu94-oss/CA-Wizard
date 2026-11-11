import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Accepts "#1e3a8a", "1e3a8a", "#fff" or "fff" (any case, surrounding
// whitespace ignored) and returns a canonical lowercase "#rrggbb", or
// null if it isn't a valid 3- or 6-digit hex colour.
export function normalizeHex(input: string): string | null {
  const m = input.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(m)) return `#${m}`
  if (/^[0-9a-f]{3}$/.test(m)) return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`
  return null
}

interface ColorFieldProps {
  label: string
  value: string // canonical "#rrggbb"
  onChange: (hex: string) => void
}

// Native colour swatch + a typeable hex-code input, kept in sync both ways.
// While typing, only a complete 6-digit code is committed (so the swatch
// never flickers through half-typed values); 3-digit shorthand is expanded
// on blur. Invalid text shows a red border + hint and reverts to the last
// valid colour on blur.
export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)

  // Follow outside changes (swatch picker, data load)
  useEffect(() => {
    setText(value)
    setInvalid(false)
  }, [value])

  const handleText = (raw: string) => {
    setText(raw)
    const stripped = raw.trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
      const hex = normalizeHex(raw)!
      setInvalid(false)
      if (hex !== value) onChange(hex)
    } else {
      // Not (yet) a full code: flag only if it already can't become one
      setInvalid(stripped.length > 0 && !/^[0-9a-fA-F]{0,6}$/.test(stripped))
    }
  }

  const handleBlur = () => {
    const hex = normalizeHex(text)
    if (hex) {
      setText(hex)
      setInvalid(false)
      if (hex !== value) onChange(hex)
    } else {
      setText(value)
      setInvalid(false)
    }
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value.toLowerCase())}
          className="h-9 w-9 rounded cursor-pointer border"
          aria-label={`${label} colour picker`}
        />
        <span>{label}</span>
        <Input
          value={text}
          onChange={e => handleText(e.target.value)}
          onBlur={handleBlur}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder="#1e3a8a"
          aria-label={`${label} colour hex code`}
          aria-invalid={invalid}
          className={cn('h-9 w-28 font-mono uppercase', invalid && 'border-destructive focus-visible:ring-destructive')}
        />
      </label>
      {invalid && <p className="text-xs text-destructive mt-1">Use a hex code like #1E3A8A</p>}
    </div>
  )
}
