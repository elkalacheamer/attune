import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'

import { authRoutes } from './routes/auth.js'
import { coupleRoutes } from './routes/couples.js'
import { profileRoutes } from './routes/profiles.js'
import { insightRoutes } from './routes/insights.js'
import { agentRoutes } from './routes/agent.js'
import { biometricRoutes } from './routes/biometrics.js'
import { cycleRoutes } from './routes/cycles.js'
import { subscriptionRoutes } from './routes/subscriptions.js'
import { notificationRoutes } from './routes/notifications.js'
import { db } from './db/client.js'

dotenv.config()

// ── Catch all unhandled errors so they appear in logs ─────
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err)
  process.exit(1)
})

const isDev = process.env.NODE_ENV !== 'production'

const app = Fastify({ logger: true })

// ── Plugins ───────────────────────────────────────────────
await app.register(cors, { origin: true, credentials: true })

await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'attune-dev-secret-change-in-prod'
})

await app.register(websocket)

// Use in-memory rate limiting (no Redis dependency on startup)
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
})

// ── Auth decorator ────────────────────────────────────────
app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorised' })
  }
})

// ── Routes ────────────────────────────────────────────────
await app.register(authRoutes,         { prefix: '/api/auth' })
await app.register(coupleRoutes,       { prefix: '/api/couples' })
await app.register(profileRoutes,      { prefix: '/api/profiles' })
await app.register(insightRoutes,      { prefix: '/api/insights' })
await app.register(agentRoutes,        { prefix: '/api/agent' })
await app.register(biometricRoutes,    { prefix: '/api/biometrics' })
await app.register(cycleRoutes,        { prefix: '/api/cycles' })
await app.register(subscriptionRoutes, { prefix: '/api/subscriptions' })
await app.register(notificationRoutes, { prefix: '/api/notifications' })

// ── Health check ──────────────────────────────────────────
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// ── Start ─────────────────────────────────────────────────
const start = async () => {
  try {
    const client = await db.connect()
    client.release()
    app.log.info('Database connected')
    await app.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' })
  } catch (err) {
    console.error('STARTUP ERROR:', err)
    process.exit(1)
  }
}

start()
