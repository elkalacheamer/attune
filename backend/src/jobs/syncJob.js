import { db } from '../db/client.js'
import { syncWhoopData, refreshWhoopTokenIfNeeded } from '../services/whoopSync.js'

const SYNC_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

async function runWhoopSync() {
  console.log('[SyncJob] Starting hourly WHOOP sync...')

  try {
    // Find all users with WHOOP connected that haven't synced in the last 55 mins
    const { rows } = await db.query(
      `SELECT user_id, access_token, refresh_token, token_expires
       FROM wearable_connections
       WHERE provider = 'whoop'
         AND (last_sync IS NULL OR last_sync < NOW() - INTERVAL '55 minutes')`
    )

    if (rows.length === 0) {
      console.log('[SyncJob] No WHOOP users due for sync.')
      return
    }

    console.log(`[SyncJob] Syncing ${rows.length} WHOOP user(s)...`)
    let totalReadings = 0

    for (const conn of rows) {
      try {
        const token = await refreshWhoopTokenIfNeeded(conn.user_id, conn)
        const count = await syncWhoopData(conn.user_id, token)
        totalReadings += count
        console.log(`[SyncJob] User ${conn.user_id}: ${count} readings synced.`)
      } catch (e) {
        console.error(`[SyncJob] Failed for user ${conn.user_id}:`, e.message)
      }
    }

    console.log(`[SyncJob] Done. Total readings synced: ${totalReadings}`)
  } catch (e) {
    console.error('[SyncJob] Unexpected error:', e.message)
  }
}

export function startSyncJob() {
  // Run once shortly after startup, then every hour
  setTimeout(runWhoopSync, 30_000)
  setInterval(runWhoopSync, SYNC_INTERVAL_MS)
  console.log('[SyncJob] Hourly WHOOP sync job scheduled.')
}
