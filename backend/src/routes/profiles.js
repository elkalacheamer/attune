import { db } from '../db/client.js'

export async function profileRoutes(app) {

  // GET /api/profiles/me
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.sex, u.date_of_birth,
              c.id as couple_id, c.invite_code, c.status as couple_status,
              ps.share_cycle_phase, ps.share_mood_forecast,
              ps.share_stress_level, ps.share_hrv
       FROM users u
       LEFT JOIN couples c ON (c.female_user_id = u.id OR c.male_user_id = u.id)
       LEFT JOIN privacy_settings ps ON ps.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    )
    if (result.rows.length === 0) return reply.code(404).send({ error: 'User not found' })
    return reply.send(result.rows[0])
  })

  // PATCH /api/profiles/me
  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { name, date_of_birth } = request.body

    const updates = []
    const params = []
    let i = 1

    if (name)          { updates.push(`name = $${i++}`);          params.push(name) }
    if (date_of_birth) { updates.push(`date_of_birth = $${i++}`); params.push(date_of_birth) }

    if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' })

    updates.push(`updated_at = NOW()`)
    params.push(userId)

    await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`,
      params
    )
    return reply.send({ success: true })
  })

  // PATCH /api/profiles/privacy
  app.patch('/privacy', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const allowed = ['share_cycle_phase', 'share_mood_forecast', 'share_stress_level', 'share_hrv', 'share_temperature', 'share_sleep_details']

    const updates = []
    const params = []
    let i = 1

    for (const field of allowed) {
      if (request.body[field] !== undefined) {
        updates.push(`${field} = $${i++}`)
        params.push(request.body[field])
      }
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' })

    params.push(userId)
    await db.query(
      `UPDATE privacy_settings SET ${updates.join(', ')}, updated_at = NOW() WHERE user_id = $${i}`,
      params
    )
    return reply.send({ success: true })
  })

  // POST /api/profiles/mood
  app.post('/mood', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { score, notes } = request.body

    if (!score || score < 1 || score > 5) {
      return reply.code(400).send({ error: 'Score must be between 1 and 5' })
    }

    await db.query(
      `INSERT INTO mood_checkins (user_id, date, score, notes)
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET score = $2, notes = $3`,
      [userId, score, notes || null]
    )

    return reply.code(201).send({ success: true })
  })
}
