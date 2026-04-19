import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildSystemPrompt({ name, sex, biometrics, cycleContext }) {
  const bioText = biometrics?.length > 0
    ? biometrics.map(b => `${b.metric}: ${parseFloat(b.value).toFixed(1)}`).join(', ')
    : 'No biometric data available yet'

  return `You are Attune, a warm and empathetic AI relationship coach. You help couples understand each other better by connecting physical health patterns with emotional wellbeing.

User context:
- Name: ${name}
- Sex: ${sex}
- Recent biometrics (48h): ${bioText}
${cycleContext ? `- Cycle: Day ${cycleContext.day_number} (${cycleContext.phase} phase)` : ''}

Your role:
1. Listen empathetically and respond with warmth and genuine insight
2. When relevant, gently connect health patterns to emotional experiences
3. Help the user reflect on relationship dynamics without judgment
4. Keep responses concise (2-4 sentences) unless more depth is genuinely helpful

You MUST respond with a valid JSON object in exactly this format (no other text):
{
  "reply": "your warm, natural response here",
  "extractedEvents": [],
  "suggestedFollowUps": ["short follow-up question", "another option"]
}

For extractedEvents — only include events clearly described by the user. Each event:
{
  "type": "intimacy" | "conflict" | "connection" | "stress" | "milestone" | "other",
  "sentiment": "positive" | "neutral" | "negative",
  "intensity": "low" | "moderate" | "high",
  "topic": "attention" | "chores" | "finances" | "family" | "work" | "intimacy" | "other",
  "resolved": true | false
}`
}

export async function agentRoutes(app) {

  // POST /api/agent/message
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

    // Get conversation history
    const historyResult = await db.query(
      `SELECT role, content FROM agent_messages
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [userId]
    )
    const history = historyResult.rows.reverse()

    // Get biometric context
    const bioResult = await db.query(
      `SELECT DISTINCT ON (metric) metric, value
       FROM biometric_readings
       WHERE user_id = $1 AND time > NOW() - INTERVAL '48 hours'
       ORDER BY metric, time DESC`,
      [userId]
    )

    // Get user name
    const userResult = await db.query(`SELECT name FROM users WHERE id = $1`, [userId])
    const userName = userResult.rows[0]?.name || 'User'

    // Get cycle context
    let cycleContext = null
    if (sex === 'female') {
      const cycleResult = await db.query(
        `SELECT * FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      )
      cycleContext = cycleResult.rows[0] || null
    }

    // Build messages for Claude
    const messages = history
      .filter(h => h.content)
      .map(h => ({
        role: h.role === 'agent' ? 'assistant' : 'user',
        content: h.role === 'agent'
          ? (() => { try { const p = JSON.parse(h.content); return p.reply || h.content } catch { return h.content } })()
          : h.content
      }))

    // Ensure current message is included
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== message) {
      messages.push({ role: 'user', content: message })
    }

    let aiResponse
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt({ name: userName, sex, biometrics: bioResult.rows, cycleContext }),
        messages
      })

      const raw = response.content[0]?.text || ''
      try {
        const match = raw.match(/\{[\s\S]*\}/)
        aiResponse = match ? JSON.parse(match[0]) : { reply: raw, extractedEvents: [], suggestedFollowUps: [] }
      } catch {
        aiResponse = { reply: raw, extractedEvents: [], suggestedFollowUps: [] }
      }
    } catch (e) {
      app.log.error('Claude API error:', e.message)
      aiResponse = {
        reply: "I'm having a moment of difficulty connecting. Could you try again shortly?",
        extractedEvents: [],
        suggestedFollowUps: []
      }
    }

    // Save agent reply
    await db.query(
      `INSERT INTO agent_messages (user_id, role, content, metadata) VALUES ($1, 'agent', $2, $3)`,
      [userId, aiResponse.reply, JSON.stringify({ extractedEvents: aiResponse.extractedEvents })]
    )

    // Persist extracted relationship events
    for (const event of (aiResponse.extractedEvents || [])) {
      try {
        await db.query(
          `INSERT INTO relationship_events
             (couple_id, logged_by, event_type, sentiment, intensity, topic, resolved, raw_text, cycle_day, cycle_phase)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            coupleId, userId,
            event.type || 'other', event.sentiment || 'neutral', event.intensity || 'low',
            event.topic || 'other', event.resolved ?? false, message,
            cycleContext?.day_number || null, cycleContext?.phase || null
          ]
        )
      } catch (e) { app.log.warn('Event insert error:', e.message) }
    }

    return reply.send({
      reply:             aiResponse.reply,
      loggedEvents:      aiResponse.extractedEvents || [],
      suggestedFollowUps: aiResponse.suggestedFollowUps || []
    })
  })

  // GET /api/agent/history
  app.get('/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const result = await db.query(
      `SELECT id, role, content, metadata, created_at
       FROM agent_messages WHERE user_id = $1
       ORDER BY created_at ASC LIMIT $2`,
      [userId, parseInt(request.query.limit || 50)]
    )
    return reply.send(result.rows)
  })

  // GET /api/agent/events
  app.get('/events', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const result = await db.query(
      `SELECT re.*, u.name as logged_by_name
       FROM relationship_events re
       JOIN users u ON u.id = re.logged_by
       WHERE re.couple_id = $1
       ORDER BY re.occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [coupleId, parseInt(request.query.limit || 30), parseInt(request.query.offset || 0)]
    )
    return reply.send(result.rows)
  })
}
