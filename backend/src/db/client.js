import pg from 'pg'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

dotenv.config()

const { Pool } = pg

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://attune:attune@localhost:5432/attune',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

db.on('error', (err) => {
  console.error('Unexpected DB error', err)
})

// ── Run migrations ────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))

export async function runMigrations() {
  const client = await db.connect()
  try {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
    console.log('✅ Migrations complete')
  } finally {
    client.release()
  }
}

// Called directly: node src/db/migrate.js
if (process.argv[1].includes('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1) })
}
