from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import anthropic
import psycopg2
import psycopg2.extras
import json
import os
from datetime import datetime, date

router = APIRouter()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def get_db():
    return psycopg2.connect(
        os.getenv("DATABASE_URL", "postgresql://attune:attune@localhost:5432/attune"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )


class GenerateRequest(BaseModel):
    userId: str
    coupleId: str


INSIGHT_SYSTEM = """You are the Attune relationship intelligence engine. You analyse biometric data, cycle information, relationship events, and mood data to generate personalised, actionable insights for couples.

Generate insights that are:
- Warm, non-clinical, and empathetic in tone
- Specific to the data provided — never generic
- Actionable (what should the person do or be aware of today)
- Private and respectful (no raw numbers in partner-facing insights)

Respond ONLY with a valid JSON array of insight objects:
[
  {
    "insightType": "cycle_alert|stress_alert|conflict_timing|intimacy_pattern|general",
    "recipientSex": "female|male|both",
    "title": "Short insight title (max 8 words)",
    "body": "2-3 sentence insight body",
    "tag": "Short category tag",
    "confidence": 0.0 to 1.0,
    "dataSources": ["list", "of", "sources", "used"]
  }
]

Generate 2-4 insights maximum. Only generate insights you have data to support."""


@router.post("/generate-insights")
async def generate_insights(req: GenerateRequest):
    conn = get_db()
    cur = conn.cursor()

    try:
        # Gather all context data
        context = {}

        # Biometrics (last 48h) for both partners
        cur.execute("""
            SELECT metric, value, source, time
            FROM biometric_readings
            WHERE user_id = %s AND time > NOW() - INTERVAL '48 hours'
            ORDER BY metric, time DESC
        """, (req.userId,))
        context["biometrics"] = [dict(r) for r in cur.fetchall()]

        # 30-day averages
        cur.execute("""
            SELECT metric, AVG(value) as avg, STDDEV(value) as std
            FROM biometric_readings
            WHERE user_id = %s AND time > NOW() - INTERVAL '30 days'
            GROUP BY metric
        """, (req.userId,))
        context["bio_averages"] = [dict(r) for r in cur.fetchall()]

        # Cycle context
        cur.execute("""
            SELECT * FROM cycle_days WHERE user_id = %s AND date = CURRENT_DATE
        """, (req.userId,))
        context["cycle_today"] = dict(cur.fetchone() or {})

        # Recent mood
        cur.execute("""
            SELECT score, date FROM mood_checkins
            WHERE user_id = %s ORDER BY date DESC LIMIT 7
        """, (req.userId,))
        context["recent_moods"] = [dict(r) for r in cur.fetchall()]

        # Recent relationship events (last 30 days)
        cur.execute("""
            SELECT event_type, sentiment, intensity, topic, resolved,
                   cycle_phase, cycle_day, occurred_at
            FROM relationship_events
            WHERE couple_id = %s AND occurred_at > NOW() - INTERVAL '30 days'
            ORDER BY occurred_at DESC LIMIT 20
        """, (req.coupleId,))
        context["recent_events"] = [dict(r) for r in cur.fetchall()]

        # Get user sex
        cur.execute("SELECT sex FROM users WHERE id = %s", (req.userId,))
        user = cur.fetchone()
        context["user_sex"] = user["sex"] if user else "unknown"

        # Get partner context
        cur.execute("""
            SELECT u.id, u.sex FROM couples c
            JOIN users u ON (
              CASE WHEN c.female_user_id = %s THEN u.id = c.male_user_id
                   ELSE u.id = c.female_user_id END
            )
            WHERE c.id = %s
        """, (req.userId, req.coupleId))
        partner = cur.fetchone()

        if partner:
            cur.execute("""
                SELECT metric, value FROM biometric_readings
                WHERE user_id = %s AND time > NOW() - INTERVAL '48 hours'
                ORDER BY metric, time DESC
            """, (partner["id"],))
            context["partner_biometrics"] = [dict(r) for r in cur.fetchall()]

            if partner["sex"] == "female":
                cur.execute("""
                    SELECT day_number, phase FROM cycle_days
                    WHERE user_id = %s AND date = CURRENT_DATE
                """, (partner["id"],))
                context["partner_cycle"] = dict(cur.fetchone() or {})

        # Call Claude to generate insights
        prompt = f"""Generate personalised relationship insights for this user based on their data.

User sex: {context['user_sex']}
Today's date: {date.today().isoformat()}

Biometrics (last 48h): {json.dumps(context['biometrics'], default=str)}
30-day bio averages: {json.dumps(context['bio_averages'], default=str)}
Cycle today: {json.dumps(context['cycle_today'], default=str)}
Recent moods (7 days): {json.dumps(context['recent_moods'], default=str)}
Partner biometrics: {json.dumps(context.get('partner_biometrics', []), default=str)}
Partner cycle: {json.dumps(context.get('partner_cycle', {}), default=str)}
Recent relationship events: {json.dumps(context['recent_events'], default=str)}"""

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            system=INSIGHT_SYSTEM,
            messages=[{"role": "user", "content": prompt}]
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        insights = json.loads(raw)

        # Persist insights to database
        for ins in insights:
            # Determine recipient
            recipient_id = req.userId
            if ins.get("recipientSex") == "male" and context["user_sex"] == "female":
                recipient_id = partner["id"] if partner else req.userId
            elif ins.get("recipientSex") == "female" and context["user_sex"] == "male":
                recipient_id = partner["id"] if partner else req.userId

            cur.execute("""
                INSERT INTO insights
                  (couple_id, recipient_id, insight_type, title, body, tag,
                   confidence, data_sources, cycle_day, cycle_phase)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                req.coupleId,
                recipient_id,
                ins["insightType"],
                ins["title"],
                ins["body"],
                ins.get("tag"),
                ins.get("confidence", 0.5),
                ins.get("dataSources", []),
                context["cycle_today"].get("day_number"),
                context["cycle_today"].get("phase")
            ))

        conn.commit()
        return {"generated": len(insights)}

    except Exception as e:
        conn.rollback()
        print(f"Insight generation error: {e}")
        return {"generated": 0, "error": str(e)}
    finally:
        cur.close()
        conn.close()
