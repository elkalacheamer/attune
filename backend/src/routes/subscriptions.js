import { db } from '../db/client.js'

export async function subscriptionRoutes(app) {

  // GET /api/subscriptions/status
  app.get('/status', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user

    const result = await db.query(
      `SELECT plan, status, current_period_end
       FROM subscriptions WHERE couple_id = $1`,
      [coupleId]
    )

    if (result.rows.length === 0) {
      // Auto-create free subscription for new couples
      await db.query(
        `INSERT INTO subscriptions (couple_id, plan, status)
         VALUES ($1, 'free', 'active')
         ON CONFLICT (couple_id) DO NOTHING`,
        [coupleId]
      )
      return reply.send({ plan: 'free', status: 'active', current_period_end: null })
    }

    return reply.send(result.rows[0])
  })

  // GET /api/subscriptions (alias)
  app.get('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const result = await db.query(
      `SELECT plan, status, current_period_end FROM subscriptions WHERE couple_id = $1`,
      [coupleId]
    )
    return reply.send(result.rows[0] || { plan: 'free', status: 'active' })
  })
}
