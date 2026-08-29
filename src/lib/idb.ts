import { openDB, type IDBPDatabase } from 'idb'
import type { OfflineScore, SyncQueueItem } from '@/types'

const DB_NAME = 'ca-wizard-offline'
const DB_VERSION = 1

let db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (db) return db
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('offline_scores')) {
        const scoreStore = database.createObjectStore('offline_scores', { keyPath: 'id' })
        scoreStore.createIndex('by_term_class', ['term_id', 'class_id'])
        scoreStore.createIndex('by_sync_status', 'sync_status')
      }
      if (!database.objectStoreNames.contains('offline_exam_scores')) {
        const examStore = database.createObjectStore('offline_exam_scores', { keyPath: 'id' })
        examStore.createIndex('by_term_class', ['term_id', 'class_id'])
        examStore.createIndex('by_sync_status', 'sync_status')
      }
      if (!database.objectStoreNames.contains('cache')) {
        database.createObjectStore('cache', { keyPath: 'key' })
      }
    }
  })
  return db
}

// ─── Offline CA Scores ──────────────────────────────────────

export async function saveOfflineScore(score: OfflineScore): Promise<void> {
  const database = await getDB()
  await database.put('offline_scores', score)
}

export async function getOfflineScores(termId: string, classId: string): Promise<OfflineScore[]> {
  const database = await getDB()
  return database.getAllFromIndex('offline_scores', 'by_term_class', [termId, classId])
}

export async function getPendingOfflineScores(): Promise<OfflineScore[]> {
  const database = await getDB()
  return database.getAllFromIndex('offline_scores', 'by_sync_status', 'pending')
}

export async function markScoreSynced(id: string): Promise<void> {
  const database = await getDB()
  const score = await database.get('offline_scores', id)
  if (score) {
    score.sync_status = 'synced'
    await database.put('offline_scores', score)
  }
}

export async function markScoreError(id: string, message: string): Promise<void> {
  const database = await getDB()
  const score = await database.get('offline_scores', id)
  if (score) {
    score.sync_status = 'error'
    score.error_message = message
    await database.put('offline_scores', score)
  }
}

export async function deleteOfflineScore(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('offline_scores', id)
}

export async function getPendingScoreCount(): Promise<number> {
  const pending = await getPendingOfflineScores()
  const pendingExam = await getPendingOfflineExamScores()
  return pending.length + pendingExam.length
}

// ─── Offline Exam Scores ────────────────────────────────────

export async function saveOfflineExamScore(score: SyncQueueItem): Promise<void> {
  const database = await getDB()
  await database.put('offline_exam_scores', score)
}

export async function getPendingOfflineExamScores(): Promise<SyncQueueItem[]> {
  const database = await getDB()
  return database.getAllFromIndex('offline_exam_scores', 'by_sync_status', 'pending')
}

export async function markExamScoreSynced(id: string): Promise<void> {
  const database = await getDB()
  const score = await database.get('offline_exam_scores', id)
  if (score) {
    score.sync_status = 'synced'
    await database.put('offline_exam_scores', score)
  }
}

export async function markExamScoreError(id: string, message: string): Promise<void> {
  const database = await getDB()
  const score = await database.get('offline_exam_scores', id)
  if (score) {
    score.sync_status = 'error'
    score.error_message = message
    await database.put('offline_exam_scores', score)
  }
}

// ─── Generic Cache ───────────────────────────────────────────

export async function setCacheItem<T>(key: string, value: T, ttlMs = 300_000): Promise<void> {
  const database = await getDB()
  await database.put('cache', { key, value, expires_at: Date.now() + ttlMs })
}

export async function getCacheItem<T>(key: string): Promise<T | null> {
  const database = await getDB()
  const item = await database.get('cache', key)
  if (!item) return null
  if (item.expires_at < Date.now()) {
    await database.delete('cache', key)
    return null
  }
  return item.value as T
}
