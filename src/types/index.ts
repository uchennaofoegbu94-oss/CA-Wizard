export type UserRole = 'super_admin' | 'school_admin' | 'teacher'
export type SchoolStatus = 'active' | 'suspended' | 'pending'
export type TermName = 'First Term' | 'Second Term' | 'Third Term'
export type AssignmentScope = 'CLASS' | 'SUBJECT'
export type GenderType = 'Male' | 'Female'
export type RatingScale = '5' | '4' | '3' | '2' | '1'
export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT'
  | 'PUBLISH' | 'LOCK' | 'UNLOCK' | 'PROMOTE' | 'SCORE_ENTRY'

export interface School {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  motto: string | null
  principal_name: string | null
  status: SchoolStatus
  subscription_tier: string
  subscription_expires_at: string | null
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

export interface InviteCode {
  id: string
  school_id: string
  code: string
  class_level_id: string | null
  class_arm_id: string | null
  subject_id: string | null
  scope: AssignmentScope
  label: string | null
  created_by: string | null
  used_by: string | null
  expires_at: string
  used_at: string | null
  is_active: boolean
  created_at: string
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

export interface ClassLevel {
  id: string
  school_id: string
  name: string
  order_index: number
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
  // joined
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
  // joined
  class_level?: ClassLevel
}

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
  created_at: string
  updated_at: string
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

export interface AssessmentCategory {
  id: string
  school_id: string
  name: string
  max_score: number
  order_index: number
  is_active: boolean
  created_at: string
}

export interface GradingSystem {
  id: string
  school_id: string
  name: string
  is_default: boolean
  created_at: string
  grade_ranges?: GradeRange[]
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
  rating: RatingScale
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
  rating: RatingScale
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
}

// ─── Broadsheet view types ─────────────────────────────────

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

// ─── Composite / UI types ──────────────────────────────────

export interface SchoolWithStats extends School {
  total_students?: number
  total_teachers?: number
  total_sessions?: number
}

export interface ClassWithDetails extends Class {
  class_level: ClassLevel
  class_arm: ClassArm
  student_count?: number
  subject_count?: number
}

export interface ScoreEntryRow {
  student: Student
  scores: Record<string, number | null>  // category_id → score
  exam_score: number | null
  ca_total: number
  term_total: number
}

export interface BroadsheetSubjectColumn {
  subject: Subject
  ca_max: number
  exam_max: number
  total_max: number
}

export interface BroadsheetStudentRow {
  student: Student
  position: number
  subjects: Record<string, {
    ca_total: number
    exam_score: number
    term_total: number
    grade: string
    remark: string
  }>
  grand_total: number
  average: number
  grade: string
}

// ─── Offline sync types ────────────────────────────────────

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
  table: string
  operation: 'upsert' | 'delete'
  payload: Record<string, unknown>
  timestamp: number
  retries: number
  sync_status: SyncStatus
}
