import { db } from '../db/client.js'

export async function notificationRoutes(app) {

  // POST /api/notifications/register-token
  app.post('/register-token', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { token, platform = 'ios' } = request.body

    if (!token) return reply.code(400).send({ error: 'Token is required' })

    await db.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, token, platform]
    )

    return reply.send({ success: true })
  })

  // GET /api/notifications/
  app.get('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.send({ notifications: [] })
  })
}
