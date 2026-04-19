import { db } from '../db/client.js'
import { syncWhoopData, refreshWhoopTokenIfNeeded } from '../services/whoopSync.js'
import { nextOccurrence } from '../routes/dates.js'

const SYNC_INTERVAL_MS     = 60 * 60 * 1000       // 1 hour
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

// ── Send Expo push notification ───────────────────────────
async function sendPush(token, title, body, data = {}) {
  if (!token || !token.startsWith('ExponentPushToken')) return
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default' })
    })
  } catch (e) {
    console.error('[SyncJob] Push send error:', e.message)
  }
}

// ── Date reminders ────────────────────────────────────────
async function runDateReminders() {
  console.log('[DateReminders] Checking upcoming relationship dates...')
  try {
    const { rows: dates } = await db.query(
      `SELECT rd.*, c.female_user_id, c.male_user_id
       FROM relationship_dates rd
       JOIN couples c ON c.id = rd.couple_id`
    )

    const toNotify = []
    for (const d of dates) {
      const dateStr = d.date.toISOString().slice(0, 10)
      const { daysUntil } = nextOccurrence(dateStr, d.is_annual)
      if (daysUntil !== d.remind_days && daysUntil !== 1 && daysUntil !== 0) continue
      const when = daysUntil === 0 ? 'is today! 🎉'
                 : daysUntil === 1 ? 'is tomorrow'
                 : `is in ${daysUntil} days`
      toNotify.push({ d, when, daysUntil, userIds: [d.female_user_id, d.male_user_id].filter(Boolean) })
    }

    if (!toNotify.length) { console.log('[DateReminders] No reminders due.'); return }

    for (const { d, when, daysUntil, userIds } of toNotify) {
      for (const userId of userIds) {
        const { rows: tokens } = await db.query(
          `SELECT token FROM device_tokens WHERE user_id = $1`, [userId]
        )
        for (const { token } of tokens) {
          const notifBody = daysUntil === 0
            ? `Today is ${d.title}! Make it special. 💕`
            : `${d.title} ${when}. Time to plan something meaningful.`
          await sendPush(token, `📅 ${d.title}`, notifBody, { type: 'date_reminder', dateId: d.id })
        }
      }
    }
    console.log(`[DateReminders] Sent reminders for ${toNotify.length} date(s).`)
  } catch (e) {
    console.error('[DateReminders] Error:', e.message)
  }
}

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
  // WHOOP sync: 30s after startup, then every hour
  setTimeout(runWhoopSync, 30_000)
  setInterval(runWhoopSync, SYNC_INTERVAL_MS)
  console.log('[SyncJob] Hourly WHOOP sync job scheduled.')

  // Date reminders: 60s after startup, then every 24h
  setTimeout(runDateReminders, 60_000)
  setInterval(runDateReminders, REMINDER_INTERVAL_MS)
  console.log('[SyncJob] Daily date reminder job scheduled.')
}
