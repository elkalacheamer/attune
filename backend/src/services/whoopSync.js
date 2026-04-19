import { db } from '../db/client.js'

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const WHOOP_API_BASE  = 'https://api.prod.whoop.com/developer/v1'

// Physiological sanity ranges (mirrors biometrics.js)
const RANGES = {
  hrv:              { min: 5,   max: 300 },
  rhr:              { min: 30,  max: 120 },
  sleep_hours:      { min: 0.5, max: 16  },
  recovery_score:   { min: 0,   max: 100 },
  stress_score:     { min: 0,   max: 100 },
  respiratory_rate: { min: 6,   max: 40  },
  temperature:      { min: 34,  max: 41  },
}

function inRange(metric, value) {
  const r = RANGES[metric]
  return !r || (value >= r.min && value <= r.max)
}

function push(readings, entry) {
  if (inRange(entry.metric, entry.value)) readings.push(entry)
  else console.warn(`[WHOOP] Out-of-range dropped: ${entry.metric}=${entry.value}`)
}

async function whoopFetch(path, accessToken) {
  const res = await fetch(`${WHOOP_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`WHOOP API error ${res.status} on ${path}`)
  return res.json()
}

// ── Refresh token if expiring within 10 minutes ───────────
export async function refreshWhoopTokenIfNeeded(userId, { access_token, refresh_token, token_expires }) {
  if (token_expires && new Date(token_expires) > new Date(Date.now() + 10 * 60_000)) {
    return access_token // still valid
  }

  const clientId     = process.env.WHOOP_CLIENT_ID
  const clientSecret = process.env.WHOOP_CLIENT_SECRET
  if (!clientId || !clientSecret) return access_token

  try {
    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token,
        client_id:     clientId,
        client_secret: clientSecret,
      })
    })

    if (!res.ok) {
      console.error('[WHOOP] Token refresh failed:', await res.text())
      return access_token
    }

    const tokens     = await res.json()
    const newExpires = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await db.query(
      `UPDATE wearable_connections
       SET access_token = $1, token_expires = $2
       WHERE user_id = $3 AND provider = 'whoop'`,
      [tokens.access_token, newExpires, userId]
    )

    return tokens.access_token
  } catch (e) {
    console.error('[WHOOP] Token refresh error:', e.message)
    return access_token
  }
}

// ── Sync all WHOOP data for a user ────────────────────────
export async function syncWhoopData(userId, accessToken) {
  const start = new Date()
  start.setDate(start.getDate() - 7)
  const startStr = start.toISOString()
  const endStr   = new Date().toISOString()

  const readings = []

  // Recovery — HRV, resting HR, recovery score
  try {
    const data = await whoopFetch(`/recovery?start=${startStr}&end=${endStr}`, accessToken)
    for (const r of data?.records || []) {
      if (r.score?.hrv_rmssd_milli)    push(readings, { time: r.created_at, metric: 'hrv',            value: r.score.hrv_rmssd_milli,    source: 'whoop' })
      if (r.score?.resting_heart_rate) push(readings, { time: r.created_at, metric: 'rhr',            value: r.score.resting_heart_rate, source: 'whoop' })
      if (r.score?.recovery_score)     push(readings, { time: r.created_at, metric: 'recovery_score', value: r.score.recovery_score,     source: 'whoop' })
    }
  } catch (e) { console.error('[WHOOP] Recovery sync error:', e.message) }

  // Sleep — hours + respiratory rate
  try {
    const data = await whoopFetch(`/sleep?start=${startStr}&end=${endStr}`, accessToken)
    for (const s of data?.records || []) {
      if (s.score?.total_in_bed_time_milli)
        push(readings, { time: s.end, metric: 'sleep_hours',     value: s.score.total_in_bed_time_milli / 3_600_000, source: 'whoop' })
      if (s.score?.respiratory_rate)
        push(readings, { time: s.end, metric: 'respiratory_rate', value: s.score.respiratory_rate, source: 'whoop' })
    }
  } catch (e) { console.error('[WHOOP] Sleep sync error:', e.message) }

  // Cycles — day strain → stress score proxy
  try {
    const data = await whoopFetch(`/cycle?start=${startStr}&end=${endStr}`, accessToken)
    for (const c of data?.records || []) {
      if (c.score?.strain != null) {
        push(readings, {
          time:   c.end || c.created_at,
          metric: 'stress_score',
          value:  Math.round((c.score.strain / 21) * 100),
          source: 'whoop',
        })
      }
    }
  } catch (e) { console.error('[WHOOP] Cycles sync error:', e.message) }

  // Persist to DB — skip duplicates
  if (readings.length > 0) {
    const values = readings.map((_, i) => {
      const b = i * 5
      return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5})`
    }).join(', ')
    const params = readings.flatMap(r => [r.time, userId, r.metric, r.value, r.source])
    await db.query(
      `INSERT INTO biometric_readings (time, user_id, metric, value, source)
       VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    )

    // Update last_sync timestamp
    await db.query(
      `UPDATE wearable_connections SET last_sync = NOW()
       WHERE user_id = $1 AND provider = 'whoop'`,
      [userId]
    )
  }

  return readings.length
}
