import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator
} from '@/components/ui/select'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor }
]

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const ActiveIcon = resolvedTheme === 'dark' ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${theme} (currently ${resolvedTheme})`}>
          <ActiveIcon className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Radix's radio-group primitives give this the correct
            role="menuitemradio"/aria-checked semantics for a screen
            reader, rather than plain items with a manually-drawn
            checkmark that carries no such meaning. */}
        <DropdownMenuRadioGroup value={theme} onValueChange={v => setTheme(v as ThemePreference)}>
          {OPTIONS.map(opt => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value} className="gap-2">
              <opt.icon className="h-4 w-4" />{opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
