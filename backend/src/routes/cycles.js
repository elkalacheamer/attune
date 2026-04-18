import { db } from '../db/client.js'

export async function cycleRoutes(app) {

  // POST /api/cycles/log — log a new cycle start
  app.post('/log', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { cycleStartDate, cycleLength = 28, periodLength = 5, lutealMood, notes } = request.body

    const { rows } = await db.query(
      `INSERT INTO cycle_logs (user_id, cycle_start_date, cycle_length, period_length, luteal_mood, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, cycleStartDate, cycleLength, periodLength, lutealMood, notes]
    )

    // Auto-compute and insert cycle day entries
    await computeCycleDays(userId, cycleStartDate, cycleLength, periodLength)

    return reply.code(201).send(rows[0])
  })

  // GET /api/cycles/today — current cycle day and phase
  app.get('/today', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, sex } = request.user

    if (sex !== 'female') {
      return reply.send({ applicable: false })
    }

    const result = await db.query(
      `SELECT * FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    )

    if (result.rows.length === 0) {
      return reply.send({ applicable: true, noData: true })
    }

    // Get predicted next period
    const logResult = await db.query(
      `SELECT * FROM cycle_logs WHERE user_id = $1 ORDER BY cycle_start_date DESC LIMIT 1`,
      [userId]
    )

    const log = logResult.rows[0]
    const nextPeriod = log
      ? new Date(new Date(log.cycle_start_date).getTime() + log.cycle_length * 24 * 60 * 60 * 1000)
      : null

    return reply.send({
      applicable: true,
      today: result.rows[0],
      nextPeriodDate: nextPeriod,
      avgCycleLength: log?.cycle_length
    })
  })

  // GET /api/cycles/calendar — cycle days for a date range
  app.get('/calendar', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { from, to } = request.query

    const result = await db.query(
      `SELECT * FROM cycle_days
       WHERE user_id = $1
         AND date BETWEEN $2 AND $3
       ORDER BY date ASC`,
      [userId, from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), to || new Date().toISOString().slice(0, 10)]
    )

    return reply.send(result.rows)
  })

  // GET /api/cycles/history — all logged cycles
  app.get('/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const result = await db.query(
      `SELECT * FROM cycle_logs WHERE user_id = $1 ORDER BY cycle_start_date DESC`,
      [userId]
    )

    return reply.send(result.rows)
  })

  // POST /api/cycles/baseline — set initial cycle baseline from onboarding
  app.post('/baseline', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user
    const { lastPeriodDate, cycleLength, periodLength, lutealMood } = request.body

    // Log the cycle
    await db.query(
      `INSERT INTO cycle_logs (user_id, cycle_start_date, cycle_length, period_length, luteal_mood)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [userId, lastPeriodDate, cycleLength || 28, periodLength || 5, lutealMood]
    )

    await computeCycleDays(userId, lastPeriodDate, cycleLength || 28, periodLength || 5)

    return reply.code(201).send({ success: true })
  })
}

async function computeCycleDays(userId, cycleStartDate, cycleLength, periodLength) {
  const start = new Date(cycleStartDate)
  const entries = []

  for (let day = 0; day < cycleLength; day++) {
    const date = new Date(start)
    date.setDate(start.getDate() + day)
    const dayNum = day + 1

    let phase
    if (dayNum <= periodLength) {
      phase = 'menstrual'
    } else if (dayNum <= Math.floor(cycleLength * 0.43)) {
      phase = 'follicular'
    } else if (dayNum <= Math.floor(cycleLength * 0.57)) {
      phase = 'ovulation'
    } else {
      phase = 'luteal'
    }

    entries.push([userId, date.toISOString().slice(0, 10), dayNum, phase])
  }

  // Batch upsert
  for (const [uid, d, dn, ph] of entries) {
    await db.query(
      `INSERT INTO cycle_days (user_id, date, day_number, phase)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date) DO UPDATE SET day_number = $3, phase = $4`,
      [uid, d, dn, ph]
    )
  }
}
