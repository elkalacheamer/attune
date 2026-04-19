import { db } from '../db/client.js'
import { z } from 'zod'

const WHOOP_AUTH_URL  = 'https://api.prod.whoop.com/oauth/oauth2/auth'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const WHOOP_API_BASE  = 'https://api.prod.whoop.com/developer/v1'
const REDIRECT_URI    = 'attune://whoop-callback'

const readingSchema = z.object({
  metric: z.enum(['hrv', 'rhr', 'sleep_hours', 'recovery_score', 'temperature', 'respiratory_rate', 'stress_score', 'steps']),
  value: z.number(),
  source: z.enum(['apple_health', 'whoop', 'oura', 'garmin', 'manual']),
  time: z.string().optional(),
  metadata: z.record(z.any()).optional()
})

async function whoopFetch(path, accessToken) {
  const res = await fetch(`${WHOOP_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`WHOOP API error ${res.status}`)
  return res.json()
}

async function syncWhoopData(userId, accessToken) {
  const start = new Date()
  start.setDate(start.getDate() - 7)
  const startStr = start.toISOString()
  const endStr   = new Date().toISOString()

  const readings = []

  try {
    const recoveryData = await whoopFetch(
      `/recovery?start=${startStr}&end=${endStr}`, accessToken
    )
    for (const r of recoveryData?.records || []) {
      if (r.score?.hrv_rmssd_milli) {
        readings.push({ time: r.created_at, metric: 'hrv',             value: r.score.hrv_rmssd_milli, source: 'whoop' })
      }
      if (r.score?.resting_heart_rate) {
        readings.push({ time: r.created_at, metric: 'rhr',             value: r.score.resting_heart_rate, source: 'whoop' })
      }
      if (r.score?.recovery_score) {
        readings.push({ time: r.created_at, metric: 'recovery_score',  value: r.score.recovery_score, source: 'whoop' })
      }
    }
  } catch (e) { console.error('WHOOP recovery sync error:', e.message) }

  try {
    const sleepData = await whoopFetch(
      `/sleep?start=${startStr}&end=${endStr}`, accessToken
    )
    for (const s of sleepData?.records || []) {
      if (s.score?.total_in_bed_time_milli) {
        readings.push({
          time:   s.end,
          metric: 'sleep_hours',
          value:  s.score.total_in_bed_time_milli / 3_600_000,
          source: 'whoop'
        })
      }
      if (s.score?.respiratory_rate) {
        readings.push({ time: s.end, metric: 'respiratory_rate', value: s.score.respiratory_rate, source: 'whoop' })
      }
    }
  } catch (e) { console.error('WHOOP sleep sync error:', e.message) }

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
  }

  return readings.length
}

export async function biometricRoutes(app) {

  // POST /api/biometrics — ingest one or many readings
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const readings = Array.isArray(request.body) ? request.body : [request.body]
    const validated = []

    for (const r of readings) {
      const result = readingSchema.safeParse(r)
      if (!result.success) {
        return reply.code(400).send({ error: 'Invalid reading', details: result.error.flatten() })
      }
      validated.push(result.data)
    }

    const values = validated.map((_, i) => {
      const b = i * 5
      return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5})`
    }).join(', ')
    const params = validated.flatMap(r => [
      r.time || new Date().toISOString(), userId, r.metric, r.value, r.source
    ])

    await db.query(
      `INSERT INTO biometric_readings (time, user_id, metric, value, source)
       VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    )

    return reply.code(201).send({ inserted: validated.length })
  })

  // GET /api/biometrics/summary
  app.get('/summary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const result = await db.query(
      `SELECT DISTINCT ON (metric) metric, value, source, time
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '48 hours'
       ORDER BY metric, time DESC`,
      [userId]
    )

    const avgResult = await db.query(
      `SELECT metric, AVG(value) as avg_30d, STDDEV(value) as std_30d
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '30 days'
       GROUP BY metric`,
      [userId]
    )

    const avgs = Object.fromEntries(avgResult.rows.map(r => [r.metric, r]))
    const summary = result.rows.map(r => ({
      ...r,
      avg_30d:   avgs[r.metric]?.avg_30d ? parseFloat(avgs[r.metric].avg_30d).toFixed(1) : null,
      deviation: avgs[r.metric]?.avg_30d
        ? ((r.value - avgs[r.metric].avg_30d) / avgs[r.metric].avg_30d * 100).toFixed(1)
        : null
    }))

    return reply.send(summary)
  })

  // GET /api/biometrics/series/:metric
  app.get('/series/:metric', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { metric }  = request.params
    const days = parseInt(request.query.days || 30)

    const result = await db.query(
      `SELECT date_trunc('day', time) as day,
              AVG(value) as value,
              MIN(value) as min_val,
              MAX(value) as max_val
       FROM biometric_readings
       WHERE user_id = $1
         AND metric  = $2
         AND time    > NOW() - ($3 || ' days')::INTERVAL
       GROUP BY day
       ORDER BY day ASC`,
      [userId, metric, days]
    )

    return reply.send(result.rows)
  })

  // GET /api/biometrics/connections
  app.get('/connections', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const result = await db.query(
      `SELECT provider, connected_at, last_sync FROM wearable_connections WHERE user_id = $1`,
      [userId]
    )
    return reply.send(result.rows)
  })

  // POST /api/biometrics/connections (generic)
  app.post('/connections', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { provider, accessToken, refreshToken, tokenExpires } = request.body

    await db.query(
      `INSERT INTO wearable_connections (user_id, provider, access_token, refresh_token, token_expires)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, provider) DO UPDATE
       SET access_token = $3, refresh_token = $4, token_expires = $5, last_sync = NOW()`,
      [userId, provider, accessToken, refreshToken, tokenExpires]
    )

    return reply.code(201).send({ connected: true, provider })
  })

  // ── WHOOP OAuth ────────────────────────────────────────────

  // GET /api/biometrics/whoop/auth-url
  app.get('/whoop/auth-url', { onRequest: [app.authenticate] }, async (request, reply) => {
    const clientId = process.env.WHOOP_CLIENT_ID
    if (!clientId) return reply.code(503).send({ error: 'WHOOP integration not configured' })

    const state = Math.random().toString(36).substring(2)
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         'read:recovery read:sleep read:profile read:workout read:cycles read:body_measurement',
      state
    })

    return reply.send({ url: `${WHOOP_AUTH_URL}?${params}`, state })
  })

  // POST /api/biometrics/whoop/connect  { code }
  app.post('/whoop/connect', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { code }   = request.body

    if (!code) return reply.code(400).send({ error: 'Missing code' })

    const clientId     = process.env.WHOOP_CLIENT_ID
    const clientSecret = process.env.WHOOP_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return reply.code(503).send({ error: 'WHOOP integration not configured' })
    }

    // Exchange code for tokens
    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
        client_id:     clientId,
        client_secret: clientSecret
      })
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('WHOOP token exchange error:', err)
      return reply.code(400).send({ error: 'Failed to connect WHOOP account' })
    }

    const tokens = await tokenRes.json()
    const expires = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null

    await db.query(
      `INSERT INTO wearable_connections (user_id, provider, access_token, refresh_token, token_expires)
       VALUES ($1, 'whoop', $2, $3, $4)
       ON CONFLICT (user_id, provider) DO UPDATE
       SET access_token = $2, refresh_token = $3, token_expires = $4, connected_at = NOW(), last_sync = NOW()`,
      [userId, tokens.access_token, tokens.refresh_token, expires]
    )

    // Sync initial data
    const count = await syncWhoopData(userId, tokens.access_token)

    return reply.send({ connected: true, synced: count })
  })

  // POST /api/biometrics/whoop/sync
  app.post('/whoop/sync', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const conn = await db.query(
      `SELECT access_token, refresh_token, token_expires
       FROM wearable_connections WHERE user_id = $1 AND provider = 'whoop'`,
      [userId]
    )

    if (conn.rows.length === 0) {
      return reply.code(404).send({ error: 'WHOOP not connected' })
    }

    let { access_token, refresh_token, token_expires } = conn.rows[0]

    // Refresh token if expiring within 5 minutes
    if (token_expires && new Date(token_expires) < new Date(Date.now() + 5 * 60_000)) {
      const clientId     = process.env.WHOOP_CLIENT_ID
      const clientSecret = process.env.WHOOP_CLIENT_SECRET
      const refreshRes = await fetch(WHOOP_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token,
          client_id:     clientId,
          client_secret: clientSecret
        })
      })
      if (refreshRes.ok) {
        const newTokens = await refreshRes.json()
        access_token = newTokens.access_token
        const newExpires = new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
        await db.query(
          `UPDATE wearable_connections SET access_token=$1, token_expires=$2, last_sync=NOW()
           WHERE user_id=$3 AND provider='whoop'`,
          [access_token, newExpires, userId]
        )
      }
    }

    const count = await syncWhoopData(userId, access_token)
    return reply.send({ synced: count })
  })
}
