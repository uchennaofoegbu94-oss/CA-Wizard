import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PickerOption {
  value: string
  label: string
  sublabel?: string
  // Extra text that should match a search but isn't displayed (e.g. middle name)
  searchText?: string
}

interface SearchablePickerProps {
  options: PickerOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  loading?: boolean
  // Rendering thousands of rows is slow on phones; show the first N matches
  // and ask the user to refine the search to see the rest.
  maxVisible?: number
  listHeightClass?: string
}

// Lowercase + strip accents so "Chidi" matches "chídí"
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// A search box with a filterable list underneath — replaces a plain dropdown
// when the list is long. Every word the user types must appear somewhere in
// the option's label, sublabel or hidden search text, in any order, so
// "ada ob" or "obi ada" or an admission number all find the same person.
export function SearchablePicker({
  options, value, onChange, placeholder = 'Search…', emptyText = 'No matches',
  disabled, loading, maxVisible = 50, listHeightClass = 'max-h-56'
}: SearchablePickerProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const indexed = useMemo(
    () => options.map(o => ({ o, hay: norm(`${o.label} ${o.sublabel ?? ''} ${o.searchText ?? ''}`) })),
    [options]
  )

  const matches = useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return indexed.map(x => x.o)
    return indexed.filter(x => tokens.every(t => x.hay.includes(t))).map(x => x.o)
  }, [indexed, query])

  const visible = matches.slice(0, maxVisible)
  const selected = options.find(o => o.value === value)

  // Keep the highlighted row valid and in view as the results change
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, visible.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = visible[active]
      if (pick) onChange(pick.value)
    } else if (e.key === 'Escape') setQuery('')
  }

  return (
    <div className={cn('space-y-2', disabled && 'opacity-60 pointer-events-none')}>
      {selected && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium truncate">{selected.label}</div>
            {selected.sublabel && <div className="text-xs text-muted-foreground truncate">{selected.sublabel}</div>}
          </div>
          <button type="button" onClick={() => onChange('')} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={loading ? 'Loading…' : placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex h-10 w-full rounded-md border border-input bg-background text-foreground pl-9 pr-9 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={placeholder}
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="rounded-md border bg-background">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">{loading ? 'Loading…' : options.length === 0 ? emptyText : `${emptyText} for “${query}”`}</p>
        ) : (
          <ul ref={listRef} role="listbox" className={cn('overflow-y-auto py-1', listHeightClass)}>
            {visible.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => onChange(o.value)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                  i === active && 'bg-muted',
                  o.value === value && 'font-medium'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.sublabel && <span className="block truncate text-xs text-muted-foreground">{o.sublabel}</span>}
                </span>
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {matches.length === options.length
            ? `${options.length} available`
            : `${matches.length} of ${options.length} match`}
          {matches.length > visible.length && ` — showing first ${visible.length}, type more to narrow`}
        </div>
      </div>
    </div>
  )
}
