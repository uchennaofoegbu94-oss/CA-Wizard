import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/table'

interface PlaceholderProps {
  title: string
  description?: string
}

function PlaceholderPage({ title, description }: PlaceholderProps) {
  return (
    <EmptyState
      icon={<Construction className="h-12 w-12" />}
      title={title}
      description={description ?? 'This feature is coming in the next phase.'}
    />
  )
}

// ── Phase 3 stubs ────────────────────────────────────────────
export const ReportsPage    = () => <PlaceholderPage title="Reports" description="Broadsheet, report card generation and PDF export — Phase 3" />
export const ScoreEntryPage = () => <PlaceholderPage title="Score Entry" description="Offline-capable CA and exam score entry grid — Phase 3" />
export const BroadsheetPage = () => <PlaceholderPage title="Broadsheet" description="Class CA broadsheet with computed totals — Phase 3" />

// ── Super Admin stubs ────────────────────────────────────────
export const AuditPage = () => <PlaceholderPage title="Audit Logs" description="Platform-wide activity log — Phase 3" />
export const UsersPage = () => <PlaceholderPage title="Users" description="All platform users — Phase 3" />

// ── Shared stubs ─────────────────────────────────────────────
export const ProfilePage = () => <PlaceholderPage title="My Profile" description="Update your profile — Phase 3" />

export default PlaceholderPage
