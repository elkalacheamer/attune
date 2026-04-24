import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'
import { nextOccurrence } from './dates.js'

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
  // Get partner's userId first
  const coupleRow = await db.query(
    `SELECT female_user_id, male_user_id FROM couples WHERE id = $1`, [coupleId]
  )
  const coupleData  = coupleRow.rows[0]
  const partnerUserId = coupleData
    ? (coupleData.female_user_id === userId ? coupleData.male_user_id : coupleData.female_user_id)
    : null

  const queries = [
    // 0 — user biometrics
    db.query(
      `SELECT DISTINCT ON (metric) metric, value, source,
              AVG(value) OVER (PARTITION BY metric) as avg_7d
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '7 days'
       ORDER BY metric,
         CASE source WHEN 'whoop' THEN 1 WHEN 'oura' THEN 2 WHEN 'garmin' THEN 3
           WHEN 'apple_health' THEN 4 WHEN 'manual' THEN 5 ELSE 6 END ASC, time DESC`,
      [userId]
    ),
    // 1 — couple relationship events
    db.query(
      `SELECT event_type, sentiment, intensity, topic, logged_by
       FROM relationship_events
       WHERE couple_id = $1 AND occurred_at > NOW() - INTERVAL '14 days'
       ORDER BY occurred_at DESC LIMIT 20`,
      [coupleId]
    ),
    // 2 — user info
    db.query(
      `SELECT u.name, u.sex, c.status as couple_status
       FROM users u LEFT JOIN couples c ON (c.female_user_id = u.id OR c.male_user_id = u.id)
       WHERE u.id = $1`, [userId]
    ),
    // 3 — user cycle
    db.query(
      `SELECT day_number, phase FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`, [userId]
    ),
    // 4 — relationship dates
    db.query(`SELECT * FROM relationship_dates WHERE couple_id = $1`, [coupleId]),
    // 5 — user mood
    db.query(
      `SELECT score FROM mood_checkins WHERE user_id = $1 AND date = CURRENT_DATE`, [userId]
    ),
    // 6 — partner biometrics (if paired)
    partnerUserId
      ? db.query(
          `SELECT DISTINCT ON (metric) metric, value, source
           FROM biometric_readings
           WHERE user_id = $1 AND time > NOW() - INTERVAL '7 days'
           ORDER BY metric, time DESC`, [partnerUserId]
        )
      : Promise.resolve({ rows: [] }),
    // 7 — partner info + cycle
    partnerUserId
      ? db.query(`SELECT name, sex FROM users WHERE id = $1`, [partnerUserId])
      : Promise.resolve({ rows: [] }),
    // 8 — partner cycle
    partnerUserId
      ? db.query(
          `SELECT day_number, phase FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
          [partnerUserId]
        )
      : Promise.resolve({ rows: [] }),
    // 9 — partner mood
    partnerUserId
      ? db.query(
          `SELECT score FROM mood_checkins WHERE user_id = $1 AND date = CURRENT_DATE`,
          [partnerUserId]
        )
      : Promise.resolve({ rows: [] }),
  ]

  const [bioResult, eventsResult, userResult, cycleResult, datesResult,
         moodResult, partnerBioResult, partnerUserResult, partnerCycleResult, partnerMoodResult]
    = await Promise.all(queries)

  const user = userResult.rows[0]
  if (!user) return

  // ── Current user context ─────────────────────────────────
  // Exclude calories & steps — not consistently tracked and not relationship-relevant
  const INSIGHT_EXCLUDE = new Set(['calories', 'steps'])
  const bioText = bioResult.rows.length > 0
    ? bioResult.rows
        .filter(b => !INSIGHT_EXCLUDE.has(b.metric))
        .map(b => {
          const val = parseFloat(b.value).toFixed(1)
          const dev = b.avg_7d ? ((b.value - b.avg_7d) / b.avg_7d * 100).toFixed(0) : null
          const devStr = dev ? ` (${dev > 0 ? '+' : ''}${dev}% vs 7d avg)` : ''
          return `${b.metric}: ${val}${devStr} [${b.source}]`
        }).join('\n') || 'No relevant biometric data'
    : 'No biometric data yet'

  const cycleDay  = cycleResult.rows[0]
  const cycleText = user.sex === 'female' && cycleDay
    ? `Cycle day ${cycleDay.day_number}, ${cycleDay.phase} phase` : null

  const userMood  = moodResult.rows[0]
  const moodText  = userMood ? `Mood today: ${userMood.score}/5` : null

  // ── Partner context ──────────────────────────────────────
  const partner         = partnerUserResult.rows[0]
  const partnerCycleDay = partnerCycleResult.rows[0]
  const partnerMood     = partnerMoodResult.rows[0]

  const partnerBioText = partner && partnerBioResult.rows.length > 0
    ? partnerBioResult.rows
        .filter(b => !INSIGHT_EXCLUDE.has(b.metric))
        .map(b => `${b.metric}: ${parseFloat(b.value).toFixed(1)} [${b.source}]`).join('\n') || 'No relevant biometric data'
    : partner ? 'No biometric data' : null

  const partnerCycleText = partner?.sex === 'female' && partnerCycleDay
    ? `Cycle day ${partnerCycleDay.day_number}, ${partnerCycleDay.phase} phase` : null

  const partnerMoodText = partnerMood ? `Mood today: ${partnerMood.score}/5` : null

  // ── Relationship events ──────────────────────────────────
  const eventsText = eventsResult.rows.length > 0
    ? eventsResult.rows.map(e => {
        const who = e.logged_by === userId ? user.name : (partner?.name || 'partner')
        return `${e.event_type} (${e.sentiment}, ${e.intensity}) — ${e.topic} [logged by ${who}]`
      }).join('\n')
    : 'No recent relationship events'

  // ── Upcoming dates ───────────────────────────────────────
  const upcomingDates = datesResult.rows
    .map(r => {
      const dateStr = r.date.toISOString().slice(0, 10)
      const { daysUntil } = nextOccurrence(dateStr, r.is_annual)
      return { ...r, daysUntil }
    })
    .filter(r => r.daysUntil >= 0 && r.daysUntil <= 30)
    .sort((a, b) => a.daysUntil - b.daysUntil)

  const datesText = upcomingDates.length > 0
    ? upcomingDates.map(d => {
        const when = d.daysUntil === 0 ? 'TODAY' : `in ${d.daysUntil} day${d.daysUntil === 1 ? '' : 's'}`
        return `${d.title} (${d.type}) — ${when}`
      }).join('\n')
    : null

  const prompt = `Generate 2-3 personalised relationship insights for this Attune user.

## Recipient
Name: ${user.name}, Sex: ${user.sex}, Couple status: ${user.couple_status || 'unpaired'}
${cycleText ? `Cycle: ${cycleText}` : ''}
${moodText ? `${moodText}` : ''}

## Their biometrics (7d)
${bioText}

${partner ? `## Partner (${partner.name}, ${partner.sex})
${partnerCycleText ? `Cycle: ${partnerCycleText}` : ''}
${partnerMoodText ? `${partnerMoodText}` : ''}
Biometrics:
${partnerBioText}
` : ''}
## Recent relationship events (14d — both partners)
${eventsText}
${datesText ? `\n## Upcoming relationship dates\n${datesText}` : ''}

Generate warm, personalised insights that use BOTH partners' data. Cross-reference health patterns between partners — e.g. if one is highly stressed and the other has low HRV, flag the compounding effect. If the female partner is in luteal phase, help the male partner understand what to expect.
If there are upcoming dates within 7 days, include a thoughtful reminder with specific preparation ideas.

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
