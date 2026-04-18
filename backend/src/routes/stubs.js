import { db } from '../db/client.js'

export async function coupleRoutes(app) {
  // GET /api/couples/me — get current couple info + partner summary
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId, userId } = request.user

    const result = await db.query(
      `SELECT c.*,
              f.name as female_name, f.id as female_id,
              m.name as male_name, m.id as male_id
       FROM couples c
       LEFT JOIN users f ON f.id = c.female_user_id
       LEFT JOIN users m ON m.id = c.male_user_id
       WHERE c.id = $1`,
      [coupleId]
    )

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Couple not found' })

    return reply.send(result.rows[0])
  })

  // GET /api/couples/partner-summary — what the partner allows you to see
  app.get('/partner-summary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId, sex } = request.user

    const coupleResult = await db.query(
      `SELECT * FROM couples WHERE id = $1`, [coupleId]
    )
    const couple = coupleResult.rows[0]
    if (!couple) return reply.code(404).send({ error: 'Couple not found' })

    const partnerId = sex === 'female' ? couple.male_user_id : couple.female_user_id
    if (!partnerId) return reply.send({ paired: false })

    const privResult = await db.query(
      `SELECT * FROM privacy_settings WHERE user_id = $1`, [partnerId]
    )
    const privacy = privResult.rows[0]

    const summary = { paired: true, partnerId }

    if (privacy?.share_cycle_phase) {
      const cycle = await db.query(
        `SELECT day_number, phase FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
        [partnerId]
      )
      summary.cycleDay = cycle.rows[0]?.day_number
      summary.cyclePhase = cycle.rows[0]?.phase
    }

    if (privacy?.share_stress_level) {
      const bio = await db.query(
        `SELECT value FROM biometric_readings
         WHERE user_id = $1 AND metric = 'stress_score'
         ORDER BY time DESC LIMIT 1`,
        [partnerId]
      )
      summary.stressScore = bio.rows[0]?.value
    }

    if (privacy?.share_mood_forecast) {
      const mood = await db.query(
        `SELECT score FROM mood_checkins WHERE user_id = $1 AND date = CURRENT_DATE`,
        [partnerId]
      )
      summary.moodScore = mood.rows[0]?.score
    }

    return reply.send(summary)
  })
}

export async function profileRoutes(app) {
  // GET /api/profiles/me
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const result = await db.query(
      `SELECT u.*, ps.* FROM users u
       LEFT JOIN privacy_settings ps ON ps.user_id = u.id
       WHERE u.id = $1`, [userId]
    )
    return reply.send(result.rows[0])
  })

  // PATCH /api/profiles/me
  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { name, dateOfBirth } = request.body
    await db.query(
      `UPDATE users SET name = COALESCE($1, name), date_of_birth = COALESCE($2, date_of_birth),
       updated_at = NOW() WHERE id = $3`,
      [name, dateOfBirth, userId]
    )
    return reply.send({ success: true })
  })

  // PATCH /api/profiles/privacy
  app.patch('/privacy', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const fields = ['share_cycle_phase','share_mood_forecast','share_stress_level',
                    'share_hrv','share_temperature','share_sleep_details']
    const updates = fields.filter(f => request.body[f] !== undefined)
    if (updates.length === 0) return reply.send({ success: true })

    const sets = updates.map((f, i) => `${f} = $${i + 2}`).join(', ')
    const vals = updates.map(f => request.body[f])
    await db.query(
      `UPDATE privacy_settings SET ${sets}, updated_at = NOW() WHERE user_id = $1`,
      [userId, ...vals]
    )
    return reply.send({ success: true })
  })

  // POST /api/profiles/mood — daily mood check-in
  app.post('/mood', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { score, notes } = request.body
    await db.query(
      `INSERT INTO mood_checkins (user_id, date, score, notes)
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET score = $2, notes = $3`,
      [userId, score, notes]
    )
    return reply.code(201).send({ success: true })
  })
}

export async function subscriptionRoutes(app) {
  app.get('/status', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const result = await db.query(
      `SELECT * FROM subscriptions WHERE couple_id = $1`, [coupleId]
    )
    return reply.send(result.rows[0] || { plan: 'free', status: 'active' })
  })
}

export async function notificationRoutes(app) {
  // POST /api/notifications/register — register device push token
  app.post('/register', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { token, platform } = request.body
    await db.query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, token, platform]
    )
    return reply.code(201).send({ success: true })
  })
}
