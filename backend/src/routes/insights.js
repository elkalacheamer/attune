import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Redis is optional — graceful no-op if unavailable
async function cacheGet(key) {
  try {
    const { redis } = await import('../db/redis.js')
    return await redis.get(key)
  } catch { return null }
}
async function cacheSet(key, ttl, value) {
  try {
    const { redis } = await import('../db/redis.js')
    await redis.setex(key, ttl, value)
  } catch {}
}

async function generateInsights(userId, coupleId) {
  const [bioResult, eventsResult, userResult, cycleResult] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (metric) metric, value, source,
              AVG(value) OVER (PARTITION BY metric) as avg_7d
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '7 days'
       ORDER BY metric,
         CASE source
           WHEN 'whoop'        THEN 1
           WHEN 'oura'         THEN 2
           WHEN 'garmin'       THEN 3
           WHEN 'apple_health' THEN 4
           WHEN 'manual'       THEN 5
           ELSE 6
         END ASC,
         time DESC`,
      [userId]
    ),
    db.query(
      `SELECT event_type, sentiment, intensity, topic
       FROM relationship_events
       WHERE couple_id = $1 AND occurred_at > NOW() - INTERVAL '14 days'
       ORDER BY occurred_at DESC LIMIT 20`,
      [coupleId]
    ),
    db.query(
      `SELECT u.name, u.sex, c.status as couple_status
       FROM users u
       LEFT JOIN couples c ON (c.female_user_id = u.id OR c.male_user_id = u.id)
       WHERE u.id = $1`,
      [userId]
    ),
    db.query(
      `SELECT day_number, phase FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    )
  ])

  const user = userResult.rows[0]
  if (!user) return

  const bioText = bioResult.rows.length > 0
    ? bioResult.rows.map(b => {
        const val = parseFloat(b.value).toFixed(1)
        const avg = b.avg_7d ? parseFloat(b.avg_7d).toFixed(1) : null
        const dev = avg ? ((b.value - b.avg_7d) / b.avg_7d * 100).toFixed(0) : null
        const devStr = dev ? ` (${dev > 0 ? '+' : ''}${dev}% vs 7d avg)` : ''
        return `${b.metric}: ${val}${devStr} [${b.source}]`
      }).join('\n')
    : 'No biometric data yet'

  const eventsText = eventsResult.rows.length > 0
    ? eventsResult.rows.map(e => `${e.event_type} (${e.sentiment}, ${e.intensity}) — ${e.topic}`).join('\n')
    : 'No recent relationship events'

  const cycleDay = cycleResult.rows[0]
  const cycleText = user.sex === 'female' && cycleDay
    ? `Cycle day ${cycleDay.day_number}, ${cycleDay.phase} phase`
    : null

  const prompt = `Generate 2-3 personalised relationship insights for this Attune user.

Profile: ${user.name}, ${user.sex}, couple status: ${user.couple_status || 'unpaired'}
${cycleText ? cycleText : ''}

Biometrics (7d): ${bioText}

Recent relationship events (14d):
${eventsText}

Generate warm, actionable insights connecting health patterns to relationship dynamics.

Respond ONLY with a JSON array:
[
  {
    "insight_type": "cycle_alert" | "stress_alert" | "conflict_timing" | "intimacy_pattern" | "general",
    "title": "max 8 word title",
    "body": "2-3 sentence insight",
    "tag": "brief card label",
    "confidence": 0.0 to 1.0
  }
]`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })

    const raw = response.content[0]?.text || ''
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return

    const insights = JSON.parse(match[0])
    for (const insight of insights) {
      await db.query(
        `INSERT INTO insights
           (couple_id, recipient_id, insight_type, title, body, tag, confidence, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '24 hours')`,
        [coupleId, userId, insight.insight_type || 'general',
         insight.title, insight.body, insight.tag || null, insight.confidence || 0.7]
      )
    }
  } catch (e) {
    console.error('Insight generation error:', e.message)
  }
}

export async function insightRoutes(app) {

  // GET /api/insights/today
  app.get('/today', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId } = request.user
    const today = new Date().toISOString().slice(0, 10)
    const cacheKey = `insights:${userId}:${today}`

    const cached = await cacheGet(cacheKey)
    if (cached) return reply.send(JSON.parse(cached))

    const result = await db.query(
      `SELECT * FROM insights
       WHERE recipient_id = $1
         AND delivered_at::date = CURRENT_DATE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY confidence DESC, delivered_at DESC LIMIT 10`,
      [userId]
    )

    if (result.rows.length === 0) {
      // Generate in background — don't block the response
      generateInsights(userId, coupleId).catch(e => app.log.warn('Insight gen error:', e.message))
      return reply.send([])
    }

    await cacheSet(cacheKey, 3600, JSON.stringify(result.rows))
    return reply.send(result.rows)
  })

  // GET /api/insights/history
  app.get('/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const result = await db.query(
      `SELECT * FROM insights WHERE recipient_id = $1
       ORDER BY delivered_at DESC LIMIT $2 OFFSET $3`,
      [userId, parseInt(request.query.limit || 50), parseInt(request.query.offset || 0)]
    )
    return reply.send(result.rows)
  })

  // POST /api/insights/:id/feedback
  app.post('/:id/feedback', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params
    const { feedback } = request.body
    const { userId } = request.user

    if (!['helpful', 'not_helpful'].includes(feedback)) {
      return reply.code(400).send({ error: 'feedback must be helpful or not_helpful' })
    }

    await db.query(
      `UPDATE insights SET feedback = $1 WHERE id = $2 AND recipient_id = $3`,
      [feedback, id, userId]
    )
    // Bust cache so UI reflects updated feedback
    const today = new Date().toISOString().slice(0, 10)
    await cacheSet(`insights:${userId}:${today}`, 1, '[]')

    return reply.send({ success: true })
  })

  // POST /api/insights/:id/read
  app.post('/:id/read', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params
    const { userId } = request.user
    await db.query(
      `UPDATE insights SET is_read = TRUE WHERE id = $1 AND recipient_id = $2`,
      [id, userId]
    )
    return reply.send({ success: true })
  })
}
