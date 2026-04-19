import { db } from '../db/client.js'

export async function coupleRoutes(app) {

  // GET /api/couples/me
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { coupleId } = request.user

    const result = await db.query(
      `SELECT c.*,
              fu.name as female_name, fu.email as female_email,
              mu.name as male_name,   mu.email as male_email
       FROM couples c
       LEFT JOIN users fu ON fu.id = c.female_user_id
       LEFT JOIN users mu ON mu.id = c.male_user_id
       WHERE c.id = $1`,
      [coupleId]
    )

    if (result.rows.length === 0) return reply.send({ couple: null })
    return reply.send(result.rows[0])
  })

  // GET /api/couples/partner-summary — partner's shared health/mood data
  app.get('/partner-summary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId, coupleId, sex } = request.user

    // Find partner's user ID
    const coupleResult = await db.query(
      `SELECT female_user_id, male_user_id, status FROM couples WHERE id = $1`,
      [coupleId]
    )

    if (coupleResult.rows.length === 0 || coupleResult.rows[0].status !== 'active') {
      return reply.send({ partner: null, status: 'unpaired' })
    }

    const couple = coupleResult.rows[0]
    const partnerId = sex === 'female' ? couple.male_user_id : couple.female_user_id

    if (!partnerId) return reply.send({ partner: null, status: 'waiting' })

    // Get partner's privacy settings and basic info
    const [partnerResult, privacyResult, cycleResult, moodResult, bioResult] = await Promise.all([
      db.query(`SELECT id, name, sex FROM users WHERE id = $1`, [partnerId]),
      db.query(`SELECT * FROM privacy_settings WHERE user_id = $1`, [partnerId]),
      db.query(
        `SELECT day_number, phase FROM cycle_days WHERE user_id = $1 AND date = CURRENT_DATE`,
        [partnerId]
      ),
      db.query(
        `SELECT score FROM mood_checkins WHERE user_id = $1 AND date = CURRENT_DATE`,
        [partnerId]
      ),
      db.query(
        `SELECT DISTINCT ON (metric) metric, value
         FROM biometric_readings
         WHERE user_id = $1 AND time > NOW() - INTERVAL '48 hours'
         ORDER BY metric, time DESC`,
        [partnerId]
      )
    ])

    const partner = partnerResult.rows[0]
    const privacy = privacyResult.rows[0] || {}
    const cycleDay = cycleResult.rows[0]
    const mood = moodResult.rows[0]
    const biometrics = bioResult.rows

    return reply.send({
      partner: {
        id:     partner.id,
        name:   partner.name,
        sex:    partner.sex,
        // Conditionally share based on privacy settings
        cyclePhase:  (privacy.share_cycle_phase && cycleDay)  ? cycleDay.phase      : null,
        cycleDay:    (privacy.share_cycle_phase && cycleDay)  ? cycleDay.day_number : null,
        mood:        privacy.share_mood_forecast              ? mood?.score         : null,
        hrv:         (privacy.share_hrv && biometrics.find(b => b.metric === 'hrv'))
                       ? parseFloat(biometrics.find(b => b.metric === 'hrv').value).toFixed(0)
                       : null,
        stressLevel: (privacy.share_stress_level && biometrics.find(b => b.metric === 'stress_score'))
                       ? parseFloat(biometrics.find(b => b.metric === 'stress_score').value).toFixed(0)
                       : null,
      },
      status: 'active'
    })
  })
}
