import { supabase } from './supabase'
import type { AuditAction } from '@/types'

interface LogAuditParams {
  schoolId: string | null
  userId: string | null
  action: AuditAction
  entityType: string
  entityId?: string | null
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
}

// Fire-and-forget audit logging. Never throws — a logging failure
// should never block the actual action the user is performing.
// Call this alongside any state-changing mutation you want visible
// in the Super Admin / School Admin audit trail.
export async function logAudit({
  schoolId, userId, action, entityType, entityId, oldValue, newValue
}: LogAuditParams): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      school_id: schoolId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null
    })
  } catch {
    // Intentionally swallowed — see comment above
  }
}
