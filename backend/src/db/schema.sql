-- Attune database schema
-- Run with: node src/db/migrate.js

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  sex           TEXT NOT NULL CHECK (sex IN ('female', 'male')),
  date_of_birth DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Couples ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS couples (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  female_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  male_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  invite_code   TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  paired_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Privacy settings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS privacy_settings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  share_cycle_phase     BOOLEAN DEFAULT TRUE,
  share_mood_forecast   BOOLEAN DEFAULT TRUE,
  share_stress_level    BOOLEAN DEFAULT TRUE,
  share_hrv             BOOLEAN DEFAULT FALSE,
  share_temperature     BOOLEAN DEFAULT FALSE,
  share_sleep_details   BOOLEAN DEFAULT FALSE,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Device tokens (push notifications) ───────────────────
CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Wearable connections ──────────────────────────────────
CREATE TABLE IF NOT EXISTS wearable_connections (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('apple_health', 'whoop', 'oura', 'garmin', 'fitbit')),
  access_token   TEXT,
  refresh_token  TEXT,
  token_expires  TIMESTAMPTZ,
  connected_at   TIMESTAMPTZ DEFAULT NOW(),
  last_sync      TIMESTAMPTZ,
  UNIQUE(user_id, provider)
);

-- ── Biometric readings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS biometric_readings (
  time        TIMESTAMPTZ NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,   -- 'hrv', 'rhr', 'sleep_hours', 'recovery_score', 'temperature', 'respiratory_rate', 'stress_score'
  value       DOUBLE PRECISION NOT NULL,
  source      TEXT NOT NULL,   -- 'apple_health', 'whoop', 'oura', 'garmin', 'manual'
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS biometric_readings_user_time_idx ON biometric_readings (user_id, time DESC);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS idx_biometric_user_metric ON biometric_readings (user_id, metric, time DESC);

-- ── Cycle logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cycle_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  cycle_start_date DATE NOT NULL,
  cycle_length     INT,
  period_length    INT,
  luteal_mood      TEXT,   -- 'low', 'neutral', 'fine'
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cycle_days (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  day_number  INT NOT NULL,
  phase       TEXT NOT NULL CHECK (phase IN ('menstrual', 'follicular', 'ovulation', 'luteal')),
  symptoms    JSONB,
  UNIQUE(user_id, date)
);

-- ── Mood check-ins ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mood_checkins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  score      INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- ── Relationship events (agent journal) ───────────────────
CREATE TABLE IF NOT EXISTS relationship_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id     UUID REFERENCES couples(id) ON DELETE CASCADE,
  logged_by     UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('intimacy', 'conflict', 'connection', 'stress', 'milestone', 'other')),
  sentiment     TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  intensity     TEXT CHECK (intensity IN ('low', 'moderate', 'high')),
  topic         TEXT,           -- 'attention', 'chores', 'finances', 'family', 'work', 'intimacy', 'other'
  resolved      BOOLEAN,
  raw_text      TEXT,           -- original agent message
  cycle_day     INT,
  cycle_phase   TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Agent conversations ───────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  content     TEXT NOT NULL,
  metadata    JSONB,           -- extracted events, entities
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── AI insights ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insights (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id        UUID REFERENCES couples(id) ON DELETE CASCADE,
  recipient_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  insight_type     TEXT NOT NULL,  -- 'cycle_alert', 'stress_alert', 'conflict_timing', 'intimacy_pattern', 'general'
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  tag              TEXT,
  confidence       DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  data_sources     TEXT[],
  cycle_day        INT,
  cycle_phase      TEXT,
  is_read          BOOLEAN DEFAULT FALSE,
  feedback         TEXT CHECK (feedback IN ('helpful', 'not_helpful', NULL)),
  delivered_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ
);

-- ── Subscriptions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id           UUID UNIQUE REFERENCES couples(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT,
  stripe_sub_id       TEXT,
  plan                TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'premium')),
  status              TEXT NOT NULL DEFAULT 'active',
  current_period_end  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
