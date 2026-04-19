import { db } from '../db/client.js'
import { z } from 'zod'

const dateSchema = z.object({
  type:        z.enum(['anniversary', 'birthday', 'first_date', 'engagement', 'custom']),
  title:       z.string().min(1).max(120),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  is_annual:   z.boolean().optional().default(true),
  remind_days: z.number().int().min(1).max(30).optional().default(3),
  notes:       z.string().max(500).optional()
})

// ── Helper: compute next occurrence & days until ──────────
export function nextOccurrence(dateStr, isAnnual) {
  const d     = new Date(dateStr + 'T12:00:00Z') // noon UTC avoids DST edge cases
  const today = new Date()
  today.setUTCHours(12, 0, 0, 0)

  if (!isAnnual) {
    const diff = Math.ceil((d - today) / 86_400_000)
    return { next: d, daysUntil: diff }
  }

  // Annual: find this year's occurrence
  const thisYear = today.getUTCFullYear()
  let next = new Date(Date.UTC(thisYear, d.getUTCMonth(), d.getUTCDate(), 12))
  if (next < today) next = new Date(Date.UTC(thisYear + 1, d.getUTCMonth(), d.getUTCDate(), 12))

  const daysUntil = Math.ceil((next - today) / 86_400_000)
  return { next, daysUntil }
}

export async function dateRoutes(app) {

  // GET /api/dates — all dates for this couple, sorted by next occurrence
  app.get('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user

    const result = await db.query(
      `SELECT * FROM relationship_dates WHERE couple_id = $1 ORDER BY created_at DESC`,
      [coupleId]
    )

    const rows = result.rows.map(r => {
      const { next, daysUntil } = nextOccurrence(r.date.toISOString().slice(0, 10), r.is_annual)
      return { ...r, next_occurrence: next.toISOString().slice(0, 10), days_until: daysUntil }
    }).sort((a, b) => a.days_until - b.days_until)

    return reply.send(rows)
  })

  // GET /api/dates/upcoming?days=14 — upcoming dates within N days
  app.get('/upcoming', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const days = parseInt(request.query.days || 14)

    const result = await db.query(
      `SELECT * FROM relationship_dates WHERE couple_id = $1`,
      [coupleId]
    )

    const upcoming = result.rows
      .map(r => {
        const { next, daysUntil } = nextOccurrence(r.date.toISOString().slice(0, 10), r.is_annual)
        return { ...r, next_occurrence: next.toISOString().slice(0, 10), days_until: daysUntil }
      })
      .filter(r => r.days_until >= 0 && r.days_until <= days)
      .sort((a, b) => a.days_until - b.days_until)

    return reply.send(upcoming)
  })

  // POST /api/dates — create
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId } = request.user
    const parsed = dateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() })
    }

    const { type, title, date, is_annual, remind_days, notes } = parsed.data

    const result = await db.query(
      `INSERT INTO relationship_dates (couple_id, created_by, type, title, date, is_annual, remind_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [coupleId, userId, type, title, date, is_annual, remind_days, notes || null]
    )

    const r = result.rows[0]
    const { next, daysUntil } = nextOccurrence(date, is_annual)
    return reply.code(201).send({
      ...r,
      next_occurrence: next.toISOString().slice(0, 10),
      days_until: daysUntil
    })
  })

  // PUT /api/dates/:id — update
  app.put('/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId } = request.user
    const { id } = request.params
    const parsed = dateSchema.partial().safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() })
    }

    const d = parsed.data
    const result = await db.query(
      `UPDATE relationship_dates
       SET type = COALESCE($1, type),
           title = COALESCE($2, title),
           date = COALESCE($3::date, date),
           is_annual = COALESCE($4, is_annual),
           remind_days = COALESCE($5, remind_days),
           notes = COALESCE($6, notes),
           updated_at = NOW()
       WHERE id = $7 AND couple_id = $8
       RETURNING *`,
      [d.type || null, d.title || null, d.date || null, d.is_annual ?? null,
       d.remind_days || null, d.notes || null, id, coupleId]
    )

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Date not found' })

    const r = result.rows[0]
    const { next, daysUntil } = nextOccurrence(r.date.toISOString().slice(0, 10), r.is_annual)
    return reply.send({ ...r, next_occurrence: next.toISOString().slice(0, 10), days_until: daysUntil })
  })

  // DELETE /api/dates/:id
  app.delete('/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user
    const { id } = request.params

    const result = await db.query(
      `DELETE FROM relationship_dates WHERE id = $1 AND couple_id = $2 RETURNING id`,
      [id, coupleId]
    )

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Date not found' })
    return reply.send({ deleted: true })
  })
}
