import * as React from 'react'
import { cn } from '@/lib/utils'
import { Label } from './input'

interface FormFieldProps {
  label: string
  error?: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
  htmlFor?: string
}

export function FormField({
  label, error, required, hint, className, children, htmlFor
}: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface FormSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

export function FormGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <div className={cn(
      'grid gap-4',
      cols === 1 && 'grid-cols-1',
      cols === 2 && 'grid-cols-1 sm:grid-cols-2',
      cols === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    )}>
      {children}
    </div>
  )
}
