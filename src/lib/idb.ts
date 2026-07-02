import { openDB, type IDBPDatabase } from 'idb'
import type { OfflineScore, SyncQueueItem } from '@/types'

const DB_NAME = 'ca-wizard-offline'
const DB_VERSION = 1

let db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (db) return db
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // Offline score entries
      if (!database.objectStoreNames.contains('offline_scores')) {
        const scoreStore = database.createObjectStore('offline_scores', { keyPath: 'id' })
        scoreStore.createIndex('by_term', ['term_id', 'class_id'])
        scoreStore.createIndex('by_sync_status', 'sync_status')
        scoreStore.createIndex('by_student_subject', ['student_id', 'subject_id', 'term_id', 'assessment_category_id'])
      }

      // Generic sync queue
      if (!database.objectStoreNames.contains('sync_queue')) {
        const queueStore = database.createObjectStore('sync_queue', { keyPath: 'id' })
        queueStore.createIndex('by_status', 'sync_status')
        queueStore.createIndex('by_table', 'table')
      }

      // Cached school data
      if (!database.objectStoreNames.contains('cache')) {
        database.createObjectStore('cache', { keyPath: 'key' })
      }
    }
  })
  return db
}

// ─── Offline Scores ───────────────────────────────────────

export async function saveOfflineScore(score: OfflineScore): Promise<void> {
  const database = await getDB()
  await database.put('offline_scores', score)
}

export async function getOfflineScores(termId: string, classId: string): Promise<OfflineScore[]> {
  const database = await getDB()
  return database.getAllFromIndex('offline_scores', 'by_term', [termId, classId])
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

// ─── Generic Cache ────────────────────────────────────────

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

export async function clearCache(): Promise<void> {
  const database = await getDB()
  await database.clear('cache')
}

// ─── Sync Queue ───────────────────────────────────────────

export async function enqueueSync(item: SyncQueueItem): Promise<void> {
  const database = await getDB()
  await database.put('sync_queue', item)
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const database = await getDB()
  return database.getAllFromIndex('sync_queue', 'by_status', 'pending')
}

export async function removeSyncItem(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('sync_queue', id)
}

export async function getPendingScoreCount(): Promise<number> {
  const pending = await getPendingOfflineScores()
  return pending.length
}
