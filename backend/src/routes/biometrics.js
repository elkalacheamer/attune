import { db } from '../db/client.js'
import { z } from 'zod'

const readingSchema = z.object({
  metric: z.enum(['hrv', 'rhr', 'sleep_hours', 'recovery_score', 'temperature', 'respiratory_rate', 'stress_score']),
  value: z.number(),
  source: z.enum(['apple_health', 'whoop', 'oura', 'garmin', 'manual']),
  time: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional()
})

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

    // Batch insert
    const values = validated.map((r, i) => {
      const base = i * 5
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    }).join(', ')

    const params = validated.flatMap(r => [
      r.time || new Date().toISOString(),
      userId,
      r.metric,
      r.value,
      r.source
    ])

    await db.query(
      `INSERT INTO biometric_readings (time, user_id, metric, value, source)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      params
    )

    return reply.code(201).send({ inserted: validated.length })
  })

  // GET /api/biometrics/summary — latest readings per metric
  app.get('/summary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const result = await db.query(
      `SELECT DISTINCT ON (metric)
         metric, value, source, time
       FROM biometric_readings
       WHERE user_id = $1
         AND time > NOW() - INTERVAL '48 hours'
       ORDER BY metric, time DESC`,
      [userId]
    )

    // Also compute 30-day averages for context
    const avgResult = await db.query(
      `SELECT metric,
              AVG(value) as avg_30d,
              STDDEV(value) as std_30d
       FROM biometric_readings
       WHERE user_id = $1
         AND time > NOW() - INTERVAL '30 days'
       GROUP BY metric`,
      [userId]
    )

    const avgs = Object.fromEntries(avgResult.rows.map(r => [r.metric, r]))

    const summary = result.rows.map(r => ({
      ...r,
      avg_30d: avgs[r.metric]?.avg_30d ? parseFloat(avgs[r.metric].avg_30d).toFixed(1) : null,
      deviation: avgs[r.metric]?.avg_30d
        ? ((r.value - avgs[r.metric].avg_30d) / avgs[r.metric].avg_30d * 100).toFixed(1)
        : null
    }))

    return reply.send(summary)
  })

  // GET /api/biometrics/series/:metric — time series for charts
  app.get('/series/:metric', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { metric } = request.params
    const { days = 30 } = request.query

    const result = await db.query(
      `SELECT time_bucket('1 day', time) as day,
              AVG(value) as value,
              MIN(value) as min_val,
              MAX(value) as max_val
       FROM biometric_readings
       WHERE user_id = $1
         AND metric = $2
         AND time > NOW() - INTERVAL '${parseInt(days)} days'
       GROUP BY day
       ORDER BY day ASC`,
      [userId, metric]
    )

    return reply.send(result.rows)
  })

  // GET /api/biometrics/connections — which wearables are linked
  app.get('/connections', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const result = await db.query(
      `SELECT provider, connected_at, last_sync
       FROM wearable_connections
       WHERE user_id = $1`,
      [userId]
    )

    return reply.send(result.rows)
  })

  // POST /api/biometrics/connections — register a wearable connection
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
}
