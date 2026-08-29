import { supabase } from './supabase'

// Every notification "event" the app currently fires. Keeping this as a
// union (rather than a free string) means adding a new trigger site is a
// two-step, compiler-checked process: add the type here, then call
// notifyUser/notifyManyUsers with it — you can't typo an event name that
// silently never gets styled/handled anywhere.
export type NotificationType =
  | 'school_approved'
  | 'school_suspended'
  | 'school_reactivated'
  | 'term_locked'
  | 'term_published'
  | 'teacher_assigned'
  | 'announcement_published'
  | 'ticket_created'
  | 'ticket_replied'
  | 'ticket_escalated'
  | 'ticket_status_changed'

interface NotifyParams {
  schoolId: string
  recipientId: string
  type: NotificationType
  title: string
  body?: string
  linkPath?: string
  /**
   * Set true for anything that needs to reach someone who may not be
   * logged in to see the in-app bell — e.g. a school being approved
   * (the admin who registered is, by definition, logged out at that
   * point). This only marks the row as needing email; it does not send
   * one. See migration 012 for the outbox pattern a future email worker
   * consumes.
   */
  requiresEmail?: boolean
}

// Fire-and-forget insert, mirroring logAudit()'s pattern: a failed
// notification should never block the action that triggered it.
export async function notifyUser({
  schoolId, recipientId, type, title, body, linkPath, requiresEmail = false
}: NotifyParams): Promise<void> {
  try {
    await supabase.from('notifications').insert({
      school_id: schoolId,
      recipient_id: recipientId,
      type,
      title,
      body: body ?? null,
      link_path: linkPath ?? null,
      requires_email: requiresEmail
    })
  } catch {
    // Intentionally swallowed — see logAudit() for the same reasoning
  }
}

// Fan-out helper for "notify everyone with this role in this school"
// (e.g. every teacher when a term is locked or published). One row per
// recipient, inserted in a single batch rather than one insert per
// recipient in a loop.
export async function notifyManyUsers(
  recipientIds: string[],
  params: Omit<NotifyParams, 'recipientId'>
): Promise<void> {
  if (recipientIds.length === 0) return
  try {
    const rows = recipientIds.map(recipient_id => ({
      school_id: params.schoolId,
      recipient_id,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link_path: params.linkPath ?? null,
      requires_email: params.requiresEmail ?? false
    }))
    await supabase.from('notifications').insert(rows)
  } catch {
    // Intentionally swallowed
  }
}
