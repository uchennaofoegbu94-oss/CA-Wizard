import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/table'

interface PlaceholderProps {
  title: string
  description?: string
}

export default function PlaceholderPage({ title, description }: PlaceholderProps) {
  return (
    <EmptyState
      icon={<Construction className="h-12 w-12" />}
      title={title}
      description={description ?? 'This feature is coming in the next phase.'}
    />
  )
}

// Specific placeholder exports for each route
export const SessionsPage = () => <PlaceholderPage title="Sessions" description="Manage academic sessions and terms — Phase 2" />
export const ClassesPage = () => <PlaceholderPage title="Classes" description="Create and manage classes — Phase 2" />
export const StudentsPage = () => <PlaceholderPage title="Students" description="Student management and enrollment — Phase 2" />
export const SubjectsPage = () => <PlaceholderPage title="Subjects" description="Subject configuration per class level — Phase 2" />
export const TeachersPage = () => <PlaceholderPage title="Teachers & Invites" description="Invite teachers and manage assignments — Phase 2" />
export const AssessmentsPage = () => <PlaceholderPage title="Assessment Categories" description="Configure CA categories and weights — Phase 2" />
export const GradingPage = () => <PlaceholderPage title="Grading System" description="Configure grade boundaries and remarks — Phase 2" />
export const ReportsPage = () => <PlaceholderPage title="Reports" description="Generate and export report cards — Phase 3" />
export const SettingsPage = () => <PlaceholderPage title="Settings" description="School configuration — Phase 2" />
export const ScoreEntryPage = () => <PlaceholderPage title="Score Entry" description="Enter CA and exam scores — Phase 2" />
export const BroadsheetPage = () => <PlaceholderPage title="Broadsheet" description="Class CA broadsheet view — Phase 2" />
export const AuditPage = () => <PlaceholderPage title="Audit Logs" description="Platform activity logs — Phase 2" />
export const UsersPage = () => <PlaceholderPage title="Users" description="All platform users — Phase 2" />
export const ProfilePage = () => <PlaceholderPage title="My Profile" description="Update your profile — Phase 2" />
