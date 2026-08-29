import { LayoutList, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'list' | 'grid'

interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  className?: string
}

// Reusable list/card view switcher. Persists nothing on its own —
// the parent page owns the state (usually just a useState<ViewMode>)
// so each page can default to whichever mode suits its content best.
export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div className={cn('inline-flex items-center rounded-md border p-0.5 bg-muted', className)}>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={cn(
          'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors',
          value === 'list' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={value === 'list'}
      >
        <LayoutList className="h-4 w-4" />
        <span className="hidden sm:inline">List</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={cn(
          'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors',
          value === 'grid' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={value === 'grid'}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="hidden sm:inline">Cards</span>
      </button>
    </div>
  )
}
