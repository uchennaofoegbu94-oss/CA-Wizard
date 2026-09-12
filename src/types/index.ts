export type UserRole = 'super_admin' | 'school_admin' | 'teacher' | 'group_admin'
export type SchoolStatus = 'active' | 'suspended' | 'pending'
export type TermName = 'First Term' | 'Second Term' | 'Third Term'
export type AssignmentScope = 'CLASS' | 'SUBJECT'
export type GenderType = 'Male' | 'Female'
export type RatingScale = '5' | '4' | '3' | '2' | '1'

export interface School {
  id: string
  name: string
  slug: string
  abbreviation: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  motto: string | null
  principal_name: string | null
  status: SchoolStatus
  subscription_tier: string
  subscription_expires_at: string | null
  primary_color: string
  secondary_color: string
  watermark_url: string | null
  principal_signature_url: string | null
  teacher_signature_url: string | null
  school_stamp_url: string | null
  group_id: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  user_id: string
  school_id: string | null
  role: UserRole
  first_name: string
  last_name: string
  email: string
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  school_id: string
  name: string
  start_year: number
  end_year: number
  is_current: boolean
  created_at: string
  updated_at: string
}

export interface Term {
  id: string
  school_id: string
  session_id: string
  name: TermName
  start_date: string | null
  end_date: string | null
  is_current: boolean
  is_published: boolean
  is_locked: boolean
  published_at: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
}

export interface SchoolSection {
  id: string
  school_id: string
  name: string
  order_index: number
  created_at: string
}

export interface ClassLevel {
  id: string
  school_id: string
  name: string
  order_index: number
  section_id: string | null
  section?: SchoolSection | null
  created_at: string
}

export interface ClassArm {
  id: string
  school_id: string
  name: string
  created_at: string
}

export interface Class {
  id: string
  school_id: string
  session_id: string
  class_level_id: string
  class_arm_id: string
  form_teacher_id: string | null
  created_at: string
  class_level?: ClassLevel
  class_arm?: ClassArm
  session?: Session
  form_teacher?: Profile
}

export interface Subject {
  id: string
  school_id: string
  class_level_id: string
  name: string
  code: string | null
  created_at: string
  class_level?: ClassLevel
}

export interface InviteCode {
  id: string
  school_id: string | null
  code: string
  class_level_id: string | null
  class_arm_id: string | null
  subject_id: string | null
  scope: AssignmentScope
  target_role: UserRole
  label: string | null
  created_by: string | null
  used_by: string | null
  expires_at: string
  used_at: string | null
  is_active: boolean
  created_at: string
  class_level?: ClassLevel
  class_arm?: ClassArm
  subject?: Subject
}

export interface StudentEnrollment {
  id: string
  school_id: string
  student_id: string
  class_id: string
  session_id: string
  enrolled_at: string
  class?: Class
}

export type StudentStatus = 'active' | 'graduated' | 'transferred_out' | 'withdrawn'

export interface Student {
  id: string
  school_id: string
  admission_number: string
  first_name: string
  last_name: string
  middle_name: string | null
  gender: GenderType | null
  date_of_birth: string | null
  photo_url: string | null
  is_active: boolean
  status: StudentStatus
  is_transfer_student: boolean
  previous_school_name: string | null
  transfer_in_date: string | null
  transfer_out_date: string | null
  transfer_out_reason: string | null
  created_at: string
  updated_at: string
}

export interface TeacherAssignment {
  id: string
  school_id: string
  teacher_id: string
  class_id: string
  subject_id: string | null
  scope: AssignmentScope
  invite_code_id: string | null
  created_at: string
  teacher?: Profile
  class?: Class
  subject?: Subject
}

export type ScoreFieldType = 'input' | 'computed'
export type ScoreComputeOperation = 'sum' | 'average' | 'weighted_percentage'

export interface AssessmentCategory {
  id: string
  school_id: string
  name: string
  max_score: number
  order_index: number
  is_active: boolean
  field_type: ScoreFieldType
  compute_operation: ScoreComputeOperation | null
  show_on_report_card: boolean
  is_total_field: boolean
  created_at: string
}

export interface ScoreFieldSource {
  id: string
  school_id: string
  field_id: string
  source_field_id: string
  weight: number
  created_at: string
}

// One row per field, as returned by get_score_fields / get_class_subject_term_results
// / get_class_all_fields. student_id/subject_id are present only on the bulk variants.
export interface ScoreFieldValue {
  student_id?: string
  subject_id?: string
  field_id: string
  field_name: string
  field_type: ScoreFieldType
  compute_operation: ScoreComputeOperation | null
  order_index: number
  show_on_report_card: boolean
  is_total_field: boolean
  value: number
  max_value: number
}

// Row shape from get_class_subject_term_results (and get_class_all_fields,
// which additionally includes subject_id since it spans subjects) — one row
// per field per student. Used by BroadsheetPage, ReportsPage, ReportCardPage
// ranking, and BulkReportCardPage.
export type ClassSubjectTermResult = ScoreFieldValue

// Row shape from get_school_term_totals — lean, total-field-only, for
// school-wide analytics (SchoolAdminAnalyticsPage). Deliberately has no
// per-field breakdown and no embedded class/subject names since RPCs can't
// do PostgREST-style embedded joins — callers join those by ID client-side.
export interface SchoolTermTotal {
  student_id: string
  class_id: string
  subject_id: string
  percentage: number
}

export interface GradingSystem {
  id: string
  school_id: string
  name: string
  is_default: boolean
  created_at: string
}

export interface StudentEnrollment {
  id: string
  school_id: string
  student_id: string
  class_id: string
  session_id: string
  enrolled_at: string
  student?: Student
  class?: Class
}

export interface GradeRange {
  id: string
  school_id: string
  grading_system_id: string
  grade: string
  min_score: number
  max_score: number
  remark: string | null
  created_at: string
}

// ─── Phase 3: Terms, Scores, Offline Sync ──────────────────

export interface StudentScore {
  id: string
  school_id: string
  student_id: string
  class_id: string
  subject_id: string
  term_id: string
  assessment_category_id: string
  score: number | null
  entered_by: string | null
  is_synced: boolean
  created_at: string
  updated_at: string
}

export interface ExamScore {
  id: string
  school_id: string
  student_id: string
  class_id: string
  subject_id: string
  term_id: string
  score: number | null
  max_score: number
  entered_by: string | null
  is_synced: boolean
  created_at: string
  updated_at: string
}

export interface CABroadsheetRow {
  school_id: string
  student_id: string
  class_id: string
  subject_id: string
  term_id: string
  ca_total: number
  ca_max: number
  categories_entered: number
}

export interface TermResultRow extends CABroadsheetRow {
  exam_score: number
  exam_max: number
  term_total: number
  term_percentage: number
}

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

export interface OfflineScore {
  id: string
  school_id: string
  student_id: string
  class_id: string
  subject_id: string
  term_id: string
  assessment_category_id: string
  score: number | null
  entered_by: string
  timestamp: number
  sync_status: SyncStatus
  error_message?: string
}

export interface SyncQueueItem {
  id: string
  school_id: string
  student_id: string
  class_id: string
  subject_id: string
  term_id: string
  score: number | null
  max_score: number
  entered_by: string
  timestamp: number
  sync_status: SyncStatus
  error_message?: string
}

export interface SubjectOffering {
  id: string
  school_id: string
  subject_id: string
  class_level_id: string
  created_at: string
  subject?: Subject
  class_level?: ClassLevel
}

// ─── Phase 3 completion / Phase 4 kickoff types ────────────

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT'
  | 'PUBLISH' | 'LOCK' | 'UNLOCK' | 'PROMOTE' | 'SCORE_ENTRY'

export interface AuditLog {
  id: string
  school_id: string | null
  user_id: string | null
  action: AuditAction
  entity_type: string
  entity_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  // joined (populated client-side, not real FKs on the table)
  user_email?: string
  school_name?: string
}

export interface Attendance {
  id: string
  school_id: string
  student_id: string
  class_id: string
  term_id: string
  days_present: number
  days_absent: number
  total_days: number
  entered_by: string | null
  created_at: string
  updated_at: string
}

export interface AffectiveMetric {
  id: string
  school_id: string
  name: string
  order_index: number
  created_at: string
}

export interface PsychomotorMetric {
  id: string
  school_id: string
  name: string
  order_index: number
  created_at: string
}

export interface AffectiveScore {
  id: string
  school_id: string
  student_id: string
  metric_id: string
  term_id: string
  class_id: string
  rating: '5' | '4' | '3' | '2' | '1'
  entered_by: string | null
  created_at: string
}

export interface PsychomotorScore {
  id: string
  school_id: string
  student_id: string
  metric_id: string
  term_id: string
  class_id: string
  rating: '5' | '4' | '3' | '2' | '1'
  entered_by: string | null
  created_at: string
}

export interface Comment {
  id: string
  school_id: string
  student_id: string
  term_id: string
  class_id: string
  teacher_comment: string | null
  management_comment: string | null
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  school_id: string | null
  recipient_id: string
  type: string
  title: string
  body: string | null
  link_path: string | null
  is_read: boolean
  requires_email: boolean
  email_sent_at: string | null
  created_at: string
}

export interface ReportSnapshot {
  id: string
  school_id: string
  student_id: string
  term_id: string
  class_id: string
  snapshot_data: Record<string, unknown>
  pdf_url: string | null
  generated_by: string | null
  generated_at: string
}

// ─── Tier 3: Group Admin + Support Tickets ─────────────────

export interface AdminGroup {
  id: string
  name: string
  group_admin_id: string | null
  created_at: string
  updated_at: string
  group_admin?: Profile
  schools?: School[]
}

export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_requester' | 'resolved' | 'closed' | 'reopened'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketCategory = 'technical' | 'billing' | 'account' | 'feature_request' | 'other'
export type TicketEscalationLevel = 'school' | 'group' | 'platform'

export interface SupportTicket {
  id: string
  submitted_by: string
  school_id: string
  group_id: string | null
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  escalation_level: TicketEscalationLevel
  assigned_to: string | null
  resolved_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  // joined (populated client-side, not real FKs on the table)
  submitter?: Profile
  school?: School
  assignee?: Profile
}

export interface TicketMessage {
  id: string
  ticket_id: string
  sender_id: string
  message: string
  created_at: string
  sender?: Profile
}

// ─── Tier 3: Announcements ──────────────────────────────────

export interface Announcement {
  id: string
  created_by: string
  title: string
  body: string
  audience_label: string
  pinned: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  // joined (populated client-side)
  creator?: Profile
  target_count?: number
  read_count?: number
  is_read?: boolean
}

export interface AnnouncementTarget {
  id: string
  announcement_id: string
  school_id: string
  created_at: string
  school?: School
}

export interface AnnouncementRead {
  id: string
  announcement_id: string
  profile_id: string
  read_at: string
}

// ─── Tier 3: Blog / CMS ─────────────────────────────────────

export type BlogPostStatus = 'draft' | 'published'

export interface BlogPost {
  id: string
  author_id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  cover_image_url: string | null
  status: BlogPostStatus
  published_at: string | null
  tags: string[]
  meta_description: string | null
  created_at: string
  updated_at: string
  author?: Profile
}

export type BlogReactionType = 'like' | 'love' | 'insightful'

export interface BlogPostReaction {
  id: string
  post_id: string
  visitor_token: string
  reaction: BlogReactionType
  created_at: string
}

// ─── Tier 3: Meet the Team / History / Testimonials ─────────

export interface TeamMember {
  id: string
  name: string
  role_title: string
  bio: string | null
  photo_url: string | null
  linkedin_url: string | null
  twitter_url: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface HistoryEvent {
  id: string
  date_label: string
  title: string
  description: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Testimonial {
  id: string
  quote: string
  author_name: string
  author_role: string | null
  photo_url: string | null
  rating: number | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}
