import { db } from '../db/client.js'
import { redis } from '../db/redis.js'

export async function insightRoutes(app) {

  // GET /api/insights/today — get today's insights for the user
  app.get('/today', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId } = request.user

    const cacheKey = `insights:${userId}:${new Date().toISOString().slice(0, 10)}`
    const cached = await redis.get(cacheKey)
    if (cached) return reply.send(JSON.parse(cached))

    const result = await db.query(
      `SELECT * FROM insights
       WHERE recipient_id = $1
         AND delivered_at::date = CURRENT_DATE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY confidence DESC, delivered_at DESC
       LIMIT 10`,
      [userId]
    )

    // If no insights yet, trigger generation
    if (result.rows.length === 0) {
      await triggerInsightGeneration(userId, coupleId, app)
    }

    const insights = result.rows
    await redis.setex(cacheKey, 3600, JSON.stringify(insights))

    return reply.send(insights)
  })

  // GET /api/insights/history — past 30 days
  app.get('/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { limit = 50, offset = 0 } = request.query

    const result = await db.query(
      `SELECT * FROM insights
       WHERE recipient_id = $1
       ORDER BY delivered_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    )

    return reply.send(result.rows)
  })

  // POST /api/insights/:id/feedback — helpful or not_helpful
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

    // Forward feedback to AI service for model learning
    try {
      await fetch(`${process.env.AI_SERVICE_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId: id, userId, feedback })
      })
    } catch (e) {
      app.log.warn('AI service feedback failed:', e.message)
    }

    return reply.send({ success: true })
  })

  // POST /api/insights/:id/read
  app.post('/:id/read', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params
    const { userId } = request.user

    await db.query(
      `UPDATE insights SET is_read = TRUE WHERE id = $2 AND recipient_id = $1`,
      [userId, id]
    )

    return reply.send({ success: true })
  })
}

async function triggerInsightGeneration(userId, coupleId, app) {
  try {
    await fetch(`${process.env.AI_SERVICE_URL}/generate-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, coupleId })
    })
  } catch (e) {
    app.log.warn('AI insight generation trigger failed:', e.message)
  }
}
