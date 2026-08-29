import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Cryptographically secure — Math.random() is a fast, predictable PRNG
// (V8 uses xorshift128+), not suitable for anything that gates account
// creation. crypto.getRandomValues() is the Web Crypto API, available
// in every modern browser, and costs nothing extra to use here.
export function generateInviteCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(date))
}

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(date)
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function fullName(profile: { first_name: string; last_name: string }): string {
  return `${profile.first_name} ${profile.last_name}`
}

export function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function clampScore(score: number, max: number): number {
  return Math.max(0, Math.min(score, max))
}

export function percentage(value: number, total: number): number {
  if (total === 0) return 0
  return Math.round((value / total) * 100 * 100) / 100
}

export function gradeFromScore(
  score: number,
  ranges: Array<{ grade: string; min_score: number; max_score: number; remark: string | null }>
): { grade: string; remark: string } {
  const match = ranges.find(r => score >= r.min_score && score <= r.max_score)
  return match
    ? { grade: match.grade, remark: match.remark ?? '' }
    : { grade: 'F', remark: 'Fail' }
}

export function truncate(text: string, length = 40): string {
  if (text.length <= length) return text
  return text.slice(0, length).trimEnd() + '…'
}

export function isExpired(dateStr: string): boolean {
  return new Date(dateStr) < new Date()
}

export function sessionYearLabel(startYear: number, endYear: number): string {
  return `${startYear}/${endYear}`
}

// A stable, anonymous per-browser identity for public interactions that
// don't require an account (currently: blog reactions). Not a security
// token — just enough to stop one click from double-counting itself.
// Generated once and reused; crypto.randomUUID() has no compatibility
// concerns in any browser this app targets.
export function getVisitorToken(): string {
  const KEY = 'ca-wizard-visitor-token'
  let token = window.localStorage.getItem(KEY)
  if (!token) {
    token = crypto.randomUUID()
    window.localStorage.setItem(KEY, token)
  }
  return token
}