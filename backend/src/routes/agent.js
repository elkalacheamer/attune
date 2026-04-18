import { db } from '../db/client.js'

export async function agentRoutes(app) {

  // POST /api/agent/message — send a message to the agent
  app.post('/message', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId, sex } = request.user
    const { message } = request.body

    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required' })
    }

    // Save user message
    await db.query(
      `INSERT INTO agent_messages (user_id, role, content) VALUES ($1, 'user', $2)`,
      [userId, message]
    )

    // Get recent conversation history (last 10 messages)
    const historyResult = await db.query(
      `SELECT role, content, created_at FROM agent_messages
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    )
    const history = historyResult.rows.reverse()

    // Get current biometric context
    const bioResult = await db.query(
      `SELECT DISTINCT ON (metric) metric, value, time
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '48 hours'
       ORDER BY metric, time DESC`,
      [userId]
    )

    // Get cycle context (female users)
    let cycleContext = null
    if (sex === 'female') {
      const cycleResult = await db.query(
        `SELECT * FROM cycle_days
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      )
      cycleContext = cycleResult.rows[0] || null
    }

    // Forward to AI service
    let aiResponse
    try {
      const aiRes = await fetch(`${process.env.AI_SERVICE_URL}/agent/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          coupleId,
          sex,
          message,
          history,
          biometrics: bioResult.rows,
          cycleContext
        })
      })
      aiResponse = await aiRes.json()
    } catch (e) {
      app.log.error('AI service error:', e.message)
      aiResponse = {
        reply: "I'm having trouble connecting right now. Please try again in a moment.",
        extractedEvents: []
      }
    }

    // Save agent reply
    await db.query(
      `INSERT INTO agent_messages (user_id, role, content, metadata)
       VALUES ($1, 'agent', $2, $3)`,
      [userId, aiResponse.reply, JSON.stringify({ extractedEvents: aiResponse.extractedEvents })]
    )

    // Persist any extracted relationship events
    if (aiResponse.extractedEvents?.length > 0) {
      for (const event of aiResponse.extractedEvents) {
        await db.query(
          `INSERT INTO relationship_events
             (couple_id, logged_by, event_type, sentiment, intensity, topic, resolved, raw_text, cycle_day, cycle_phase)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            coupleId, userId,
            event.type, event.sentiment, event.intensity,
            event.topic, event.resolved,
            message,
            cycleContext?.day_number, cycleContext?.phase
          ]
        )
      }
    }

    return reply.send({
      reply: aiResponse.reply,
      loggedEvents: aiResponse.extractedEvents || [],
      suggestedFollowUps: aiResponse.suggestedFollowUps || []
    })
  })

  // GET /api/agent/history — conversation history
  app.get('/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { limit = 50 } = request.query

    const result = await db.query(
      `SELECT id, role, content, metadata, created_at
       FROM agent_messages
       WHERE user_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [userId, parseInt(limit)]
    )

    return reply.send(result.rows)
  })

  // GET /api/agent/events — relationship events timeline for couple
  app.get('/events', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const { limit = 30, offset = 0 } = request.query

    const result = await db.query(
      `SELECT re.*, u.name as logged_by_name
       FROM relationship_events re
       JOIN users u ON u.id = re.logged_by
       WHERE re.couple_id = $1
       ORDER BY re.occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [coupleId, parseInt(limit), parseInt(offset)]
    )

    return reply.send(result.rows)
  })
}
