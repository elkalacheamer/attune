from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
import os

router = APIRouter()


def get_db():
    return psycopg2.connect(
        os.getenv("DATABASE_URL", "postgresql://attune:attune@localhost:5432/attune"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )


class FeedbackRequest(BaseModel):
    insightId: str
    userId: str
    feedback: str  # 'helpful' | 'not_helpful'


@router.post("/feedback")
async def record_feedback(req: FeedbackRequest):
    """
    Store feedback and flag couple for retraining if enough
    negative signals accumulate.
    """
    conn = get_db()
    cur = conn.cursor()

    try:
        # Update insight record
        cur.execute(
            "UPDATE insights SET feedback = %s WHERE id = %s AND recipient_id = %s",
            (req.feedback, req.insightId, req.userId)
        )

        # Count recent negative feedback for this user
        cur.execute("""
            SELECT COUNT(*) as cnt FROM insights
            WHERE recipient_id = %s
              AND feedback = 'not_helpful'
              AND delivered_at > NOW() - INTERVAL '7 days'
        """, (req.userId,))
        row = cur.fetchone()
        negative_count = row["cnt"] if row else 0

        # If 3+ negative ratings in a week, log for priority retraining
        if negative_count >= 3:
            cur.execute("""
                INSERT INTO agent_messages (user_id, role, content, metadata)
                VALUES (%s, 'system', 'Retraining flagged', %s)
                ON CONFLICT DO NOTHING
            """, (req.userId, '{"retrain": true}'))

        conn.commit()
        return {"recorded": True, "negativeCount": negative_count}

    except Exception as e:
        conn.rollback()
        return {"recorded": False, "error": str(e)}
    finally:
        cur.close()
        conn.close()
