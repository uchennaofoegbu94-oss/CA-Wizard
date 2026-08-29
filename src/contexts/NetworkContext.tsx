import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getPendingOfflineScores, markScoreSynced, markScoreError, deleteOfflineScore,
  getPendingOfflineExamScores, markExamScoreSynced, markExamScoreError,
  getPendingScoreCount
} from '@/lib/idb'
import toast from 'react-hot-toast'

interface NetworkContextValue {
  isOnline: boolean
  pendingSyncCount: number
  isSyncing: boolean
  checkPending: () => Promise<void>
  syncNow: () => Promise<void>
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: navigator.onLine,
  pendingSyncCount: 0,
  isSyncing: false,
  checkPending: async () => {},
  syncNow: async () => {}
})

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const syncInFlight = useRef(false)

  const checkPending = useCallback(async () => {
    const count = await getPendingScoreCount()
    setPendingSyncCount(count)
  }, [])

  // Replays every queued offline CA score and exam score against
  // Supabase. Runs on reconnect and on app mount. RLS still applies
  // server-side — a score queued while a term was open but synced
  // after the admin locked it will be rejected here and flagged as
  // an error rather than silently lost.
  const syncNow = useCallback(async () => {
    if (syncInFlight.current || !navigator.onLine) return
    syncInFlight.current = true
    setIsSyncing(true)

    try {
      const pendingCA = await getPendingOfflineScores()
      let failCount = 0

      for (const item of pendingCA) {
        try {
          const { error } = await supabase.from('student_scores').upsert({
            school_id: item.school_id,
            student_id: item.student_id,
            class_id: item.class_id,
            subject_id: item.subject_id,
            term_id: item.term_id,
            assessment_category_id: item.assessment_category_id,
            score: item.score,
            entered_by: item.entered_by,
            is_synced: true
          }, { onConflict: 'student_id,subject_id,term_id,assessment_category_id' })

          if (error) throw error
          await markScoreSynced(item.id)
          await deleteOfflineScore(item.id)
        } catch (e) {
          failCount++
          await markScoreError(item.id, e instanceof Error ? e.message : 'Unknown error')
        }
      }

      const pendingExam = await getPendingOfflineExamScores()
      for (const item of pendingExam) {
        try {
          const { error } = await supabase.from('exam_scores').upsert({
            school_id: item.school_id,
            student_id: item.student_id,
            class_id: item.class_id,
            subject_id: item.subject_id,
            term_id: item.term_id,
            score: item.score,
            max_score: item.max_score,
            entered_by: item.entered_by,
            is_synced: true
          }, { onConflict: 'student_id,subject_id,term_id' })

          if (error) throw error
          await markExamScoreSynced(item.id)
        } catch (e) {
          failCount++
          await markExamScoreError(item.id, e instanceof Error ? e.message : 'Unknown error')
        }
      }

      const totalSynced = pendingCA.length + pendingExam.length - failCount
      if (totalSynced > 0) {
        toast.success(`${totalSynced} score${totalSynced !== 1 ? 's' : ''} synced`)
      }
      if (failCount > 0) {
        toast.error(`${failCount} score${failCount !== 1 ? 's' : ''} failed to sync — check for a locked term`)
      }
    } finally {
      await checkPending()
      setIsSyncing(false)
      syncInFlight.current = false
    }
  }, [checkPending])

  useEffect(() => {
    const online = () => {
      setIsOnline(true)
      syncNow()
    }
    const offline = () => setIsOnline(false)

    window.addEventListener('online', online)
    window.addEventListener('offline', offline)

    checkPending()
    if (navigator.onLine) syncNow()

    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <NetworkContext.Provider value={{ isOnline, pendingSyncCount, isSyncing, checkPending, syncNow }}>
      {children}
    </NetworkContext.Provider>
  )
}

export const useNetwork = () => useContext(NetworkContext)
