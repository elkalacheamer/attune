import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/client.js'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  sex: z.enum(['female', 'male']),
  date_of_birth: z.string().optional()
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
})

export async function authRoutes(app) {

  // POST /api/auth/register
  app.post('/register', async (request, reply) => {
    console.log('REGISTER BODY:', JSON.stringify(request.body))
    const result = registerSchema.safeParse(request.body)
    if (!result.success) {
      console.log('REGISTER VALIDATION ERRORS:', JSON.stringify(result.error.flatten()))
      return reply.code(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const { email, password, name, sex, date_of_birth } = result.data

    try {
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email])
      if (existing.rows.length > 0) {
        return reply.code(409).send({ error: 'Email already registered' })
      }

      const passwordHash = await bcrypt.hash(password, 12)
      const userId = uuidv4()
      const inviteCode = Math.random().toString(36).substring(2, 7).toUpperCase()

      console.log('REGISTER: inserting user', userId)
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, sex, date_of_birth)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, email, passwordHash, name, sex, date_of_birth || null]
      )

      console.log('REGISTER: inserting privacy_settings')
      await db.query(
        `INSERT INTO privacy_settings (user_id) VALUES ($1)`,
        [userId]
      )

      console.log('REGISTER: inserting couple')
      const coupleId = uuidv4()
      const coupleColumn = sex === 'female' ? 'female_user_id' : 'male_user_id'
      await db.query(
        `INSERT INTO couples (id, ${coupleColumn}, invite_code) VALUES ($1, $2, $3)`,
        [coupleId, userId, inviteCode]
      )

      console.log('REGISTER: success', userId)
      const token = app.jwt.sign({ userId, email, sex, coupleId }, { expiresIn: '30d' })

      return reply.code(201).send({
        token,
        user: { id: userId, email, name, sex },
        couple: { id: coupleId, inviteCode }
      })
    } catch (err) {
      console.error('REGISTER DB ERROR:', err.message, err.code)
      return reply.code(500).send({ error: 'Registration failed', detail: err.message })
    }
  })

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid input' })
    }

    const { email, password } = result.data

    const userResult = await db.query(
      `SELECT u.*, c.id as couple_id, c.invite_code
       FROM users u
       LEFT JOIN couples c ON (c.female_user_id = u.id OR c.male_user_id = u.id)
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    )

    if (userResult.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const user = userResult.rows[0]
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const token = app.jwt.sign(
      { userId: user.id, email: user.email, sex: user.sex, coupleId: user.couple_id },
      { expiresIn: '30d' }
    )

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, sex: user.sex },
      couple: { id: user.couple_id, inviteCode: user.invite_code }
    })
  })

  // POST /api/auth/pair — link partner by invite code
  app.post('/pair', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { inviteCode } = request.body
    const { userId, sex } = request.user

    const coupleResult = await db.query(
      'SELECT * FROM couples WHERE invite_code = $1',
      [inviteCode.toUpperCase()]
    )

    if (coupleResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Invite code not found' })
    }

    const couple = coupleResult.rows[0]

    // Check partner slot is available
    const partnerColumn = sex === 'female' ? 'female_user_id' : 'male_user_id'
    if (couple[partnerColumn]) {
      return reply.code(409).send({ error: 'This couple is already paired' })
    }

    await db.query(
      `UPDATE couples SET ${partnerColumn} = $1, status = 'active', paired_at = NOW()
       WHERE id = $2`,
      [userId, couple.id]
    )

    // Issue a new JWT so the client immediately uses the correct coupleId
    const newToken = app.jwt.sign(
      { userId, email: request.user.email, sex: request.user.sex, coupleId: couple.id },
      { expiresIn: '30d' }
    )

    return reply.send({ message: 'Paired successfully', coupleId: couple.id, token: newToken })
  })

  // GET /api/auth/me
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user

    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.sex, u.date_of_birth,
              c.id as couple_id, c.invite_code, c.status as couple_status,
              ps.*
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM couples
         WHERE female_user_id = u.id OR male_user_id = u.id
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END
         LIMIT 1
       ) c ON true
       LEFT JOIN privacy_settings ps ON ps.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'User not found' })
    }

    return reply.send(result.rows[0])
  })
}
