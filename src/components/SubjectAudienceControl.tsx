import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { audienceMode, AUDIENCE_LABEL, type GroupTypeWithGroups } from '@/lib/studentGroups'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import toast from 'react-hot-toast'
import type { SubjectAudienceMode } from '@/types'

interface Props {
  subjectId: string
  subjectName: string
  levelId: string
  levelName: string
  offering: { is_optional: boolean; groups?: { group_id: string }[] }
  types: GroupTypeWithGroups[]
  onApplied: () => void
}

// Who takes this subject at this class level:
//   Everyone (compulsory)  |  Only certain groups (e.g. Science)  |  Students choose individually
// Exactly one mode at a time — the database enforces it (set_subject_audience), this just
// makes the three choices obvious. Restricting to groups first asks the database how many
// students who ALREADY have scores would stop taking the subject, and confirms before applying
// (their scores are never deleted, only hidden).
export function SubjectAudienceControl({ subjectId, subjectName, levelId, levelName, offering, types, onApplied }: Props) {
  const { schoolId, profile } = useAuth()
  const qc = useQueryClient()
  const saved = audienceMode(offering)
  const savedGroupIds = (offering.groups ?? []).map(g => g.group_id)
  const [mode, setMode] = useState<SubjectAudienceMode>(saved)
  const [picked, setPicked] = useState<string[]>(savedGroupIds)

  // The mode the DATABASE is in as far as we know. `saved` only updates after a refetch, so changes made
  // faster than that (choice -> everyone in quick succession) are compared against this instead.
  const applied = useRef<SubjectAudienceMode>(saved)

  // follow the database after a refetch
  useEffect(() => { applied.current = saved; setMode(saved); setPicked(savedGroupIds) }, [saved, savedGroupIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const usableTypes = types.filter(t => t.groups.length > 0)
  const pickedType = usableTypes.find(t => t.groups.some(g => picked.includes(g.id)))
  const nameOf = (gid: string) => usableTypes.flatMap(t => t.groups).find(g => g.id === gid)?.name ?? '…'

  const apply = useMutation({
    mutationFn: async ({ m, groupIds }: { m: SubjectAudienceMode; groupIds: string[] }) => {
      if (m === 'groups') {
        const { data: hidden, error: pe } = await supabase.rpc('count_students_hidden_by_audience', {
          p_subject_id: subjectId, p_class_level_id: levelId, p_group_ids: groupIds
        })
        if (pe) throw pe
        if ((hidden as number) > 0 && !window.confirm(
          `${hidden} student${hidden === 1 ? '' : 's'} who already ${hidden === 1 ? 'has' : 'have'} scores in ${subjectName} won't take it any more. ` +
          `Their scores are kept (just hidden) and come back if you change this. Continue?`)) {
          throw new Error('__cancelled')
        }
      }
      const { data, error } = await supabase.rpc('set_subject_audience', {
        p_subject_id: subjectId, p_class_level_id: levelId, p_mode: m, p_group_ids: m === 'groups' ? groupIds : []
      })
      if (error) throw error
      return { m, groupIds, n: (data as number) ?? 0 }
    },
    onSuccess: ({ m, groupIds, n }) => {
      applied.current = m
      onApplied()
      // every roster-driven screen must refetch: who takes the subject just changed
      ;['class-subject-roster', 'restricted-subject-ids', 'group-types-in-use', 'student-group-usage', 'student-optional-subjects']
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }))
      if (m === 'everyone') toast.success(`${subjectName} is now compulsory for everyone at ${levelName}`)
      else if (m === 'choice') toast.success(n > 0 ? `Students choose ${subjectName}. ${n} who already had scores were kept enrolled.` : `Students choose ${subjectName}. Tick who takes it under the class's Subject Choices.`)
      else toast.success(`${subjectName} is now only for ${groupIds.map(nameOf).join(' / ')}${n > 0 ? ` — ${n} student${n !== 1 ? 's' : ''} with existing scores no longer take it` : ''}. Assign students to groups on each class.`)
      logAudit({
        schoolId: schoolId!, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'subject_offering', entityId: subjectId,
        newValue: { class_level_id: levelId, mode: m, groups: groupIds }
      })
    },
    onError: (e: Error) => {
      // The admin cancelled the "N students will stop taking this" warning: leave the chooser exactly as
      // they had it so they can adjust the groups. Only a real failure rolls the control back.
      if (e.message === '__cancelled') return
      setMode(saved); setPicked(savedGroupIds)
      toast.error(e.message.replace(/^(set_subject_audience|count_students_hidden_by_audience):\s*/, ''))
    }
  })

  const onModeChange = (m: SubjectAudienceMode) => {
    if (m === 'groups') {
      if (usableTypes.length === 0) { toast.error('Create student groups first (Student Groups in the menu)'); return }
      setMode('groups')                    // reveal the chooser; nothing is saved until "Apply"
      return
    }
    setMode(m)
    if (m !== applied.current) apply.mutate({ m, groupIds: [] })
  }

  const toggleGroup = (gid: string) => setPicked(p => p.includes(gid) ? p.filter(x => x !== gid) : [...p, gid])
  const dirty = mode === 'groups' && (saved !== 'groups' || picked.slice().sort().join() !== savedGroupIds.slice().sort().join())

  return (
    <div className="text-xs space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          disabled={apply.isPending}
          onChange={e => onModeChange(e.target.value as SubjectAudienceMode)}
          className="h-7 rounded border border-input bg-background px-1.5 text-xs"
          aria-label={`Who takes ${subjectName} at ${levelName}`}
        >
          {(Object.keys(AUDIENCE_LABEL) as SubjectAudienceMode[]).map(k => <option key={k} value={k}>{AUDIENCE_LABEL[k]}</option>)}
        </select>
        {saved === 'groups' && !dirty && savedGroupIds.map(g => <Badge key={g} variant="info" className="text-[10px]">{nameOf(g)}</Badge>)}
      </div>

      {mode === 'groups' && (
        <div className="rounded-md border bg-muted/30 p-2 space-y-2">
          {usableTypes.map(t => {
            const blocked = !!pickedType && pickedType.id !== t.id   // one audience = one type
            return (
              <div key={t.id} className={blocked ? 'opacity-40' : ''}>
                <div className="font-medium mb-1">{t.name}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {t.groups.map(g => (
                    <label key={g.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="rounded" disabled={blocked || apply.isPending}
                        checked={picked.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={!dirty || picked.length === 0 || apply.isPending}
              onClick={() => apply.mutate({ m: 'groups', groupIds: picked })}>Apply</Button>
            {saved !== 'groups' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setMode(saved); setPicked(savedGroupIds) }}>Cancel</Button>}
            <span className="text-muted-foreground">Pick groups of one type (e.g. only streams)</span>
          </div>
        </div>
      )}
    </div>
  )
}
