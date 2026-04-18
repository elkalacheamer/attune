from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Any
import anthropic
import json
import os

router = APIRouter()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT_FEMALE = """You are Attune, a warm and empathetic relationship intelligence agent speaking with the female partner of a couple.

Your role is to:
1. Listen to what she shares about her relationship — intimacy, conflicts, moods, good moments
2. Ask ONE thoughtful follow-up question to understand the context better
3. Extract structured events from the conversation to help the AI learn patterns

You must respond with a JSON object in this exact format:
{
  "reply": "Your warm, conversational response here (2-4 sentences max)",
  "extractedEvents": [
    {
      "type": "intimacy|conflict|connection|stress|milestone|other",
      "sentiment": "positive|neutral|negative",
      "intensity": "low|moderate|high",
      "topic": "attention|chores|finances|family|work|intimacy|communication|other",
      "resolved": true|false|null
    }
  ],
  "suggestedFollowUps": ["Short follow-up option 1", "Short follow-up option 2"]
}

Guidelines:
- Be warm, non-judgmental, and supportive
- Never give direct relationship advice — reflect and ask questions
- Keep replies short and conversational (not clinical)
- Only extract events when the user has clearly described something that happened
- suggestedFollowUps should be 3-5 word tap-able prompts
- If no event is described, extractedEvents should be an empty array
- Cycle and biometric context is provided to help you give relevant responses"""

SYSTEM_PROMPT_MALE = """You are Attune, a warm and straightforward relationship intelligence agent speaking with the male partner of a couple.

Your role is to:
1. Listen to what he shares about his relationship — conflicts, good moments, stress, intimacy
2. Ask ONE practical follow-up question to better understand the situation
3. Extract structured events from the conversation to help the AI learn patterns

You must respond with a JSON object in this exact format:
{
  "reply": "Your supportive, direct response here (2-4 sentences max)",
  "extractedEvents": [
    {
      "type": "intimacy|conflict|connection|stress|milestone|other",
      "sentiment": "positive|neutral|negative",
      "intensity": "low|moderate|high",
      "topic": "attention|chores|finances|family|work|intimacy|communication|other",
      "resolved": true|false|null
    }
  ],
  "suggestedFollowUps": ["Short follow-up option 1", "Short follow-up option 2"]
}

Guidelines:
- Be direct but empathetic — not preachy
- Never give direct relationship advice — ask questions that help him reflect
- Keep replies short and conversational
- Only extract events when something has clearly happened
- suggestedFollowUps should be 3-5 word tap-able prompts"""


class MessageRequest(BaseModel):
    userId: str
    coupleId: str
    sex: str
    message: str
    history: List[dict] = []
    biometrics: List[dict] = []
    cycleContext: Optional[dict] = None


@router.post("/respond")
async def agent_respond(req: MessageRequest):
    system = SYSTEM_PROMPT_FEMALE if req.sex == "female" else SYSTEM_PROMPT_MALE

    # Build context block
    context_parts = []

    if req.cycleContext:
        context_parts.append(
            f"[Cycle context: Day {req.cycleContext.get('day_number')}, "
            f"{req.cycleContext.get('phase')} phase]"
        )

    if req.biometrics:
        bio_summary = ", ".join(
            f"{b['metric']}: {round(float(b['value']), 1)}"
            for b in req.biometrics[:5]
        )
        context_parts.append(f"[Biometrics: {bio_summary}]")

    context_str = "\n".join(context_parts)

    # Build message history for Claude
    messages = []
    for msg in req.history[-8:]:  # last 8 messages for context
        messages.append({
            "role": msg["role"] if msg["role"] == "user" else "assistant",
            "content": msg["content"]
        })

    # Add current message with context
    user_content = req.message
    if context_str:
        user_content = f"{context_str}\n\nUser says: {req.message}"

    messages.append({"role": "user", "content": user_content})

    # Call Claude
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        system=system,
        messages=messages
    )

    raw = response.content[0].text.strip()

    # Parse JSON response
    try:
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
    except Exception:
        result = {
            "reply": raw[:500],
            "extractedEvents": [],
            "suggestedFollowUps": []
        }

    return result
