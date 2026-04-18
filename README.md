# Attune — Relationship Intelligence App

A full-stack mobile application that helps couples understand each other better through biometric data, cycle tracking, AI insights, and a conversational relationship agent.

## Project structure

```
attune/
├── apps/
│   └── mobile/          # React Native (Expo) — iOS & Android app
├── backend/             # Node.js + Fastify — REST API + WebSocket
├── ai-service/          # Python + FastAPI — AI insights engine + agent
├── infra/
│   └── docker/          # Docker Compose for local dev
└── docs/                # Architecture docs
```

## Prerequisites

Install these before running anything:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| npm | 10+ | Comes with Node |
| Python | 3.11+ | https://python.org |
| Docker Desktop | latest | https://docker.com/products/docker-desktop |
| Expo CLI | latest | `npm install -g expo-cli` |
| Git | latest | https://git-scm.com |

## Quick start (5 steps)

### 1. Clone and install
```bash
git clone <your-repo-url>
cd attune
```

### 2. Start infrastructure (Postgres + Redis)
```bash
cd infra/docker
docker compose up -d
```

### 3. Start the backend API
```bash
cd backend
cp .env.example .env          # fill in your values
npm install
npm run db:migrate            # create tables
npm run dev                   # starts on http://localhost:3000
```

### 4. Start the AI service
```bash
cd ai-service
cp .env.example .env          # add your Anthropic API key
pip install -r requirements.txt
uvicorn main:app --reload     # starts on http://localhost:8000
```

### 5. Start the mobile app
```bash
cd apps/mobile
npm install
npx expo start                # scan QR with Expo Go app on your phone
```

## Environment variables

### backend/.env
```
DATABASE_URL=postgresql://attune:attune@localhost:5432/attune
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-production
AI_SERVICE_URL=http://localhost:8000
STRIPE_SECRET_KEY=sk_test_...
APNS_KEY_ID=...
FCM_SERVER_KEY=...
```

### ai-service/.env
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://attune:attune@localhost:5432/attune
REDIS_URL=redis://localhost:6379
```

### apps/mobile/.env
```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_WS_URL=ws://localhost:3000
```

## Getting your Anthropic API key
1. Go to https://console.anthropic.com
2. Create an account and navigate to API Keys
3. Create a new key and paste it into `ai-service/.env`

## Tech stack summary

- **Mobile**: React Native, Expo, Zustand, React Query, React Navigation
- **Backend**: Node.js, Fastify, PostgreSQL, Redis, Prisma ORM
- **AI service**: Python, FastAPI, Anthropic Claude API, scikit-learn, LangChain
- **Infrastructure**: Docker, Docker Compose (local), AWS/Render (production)
- **Payments**: Stripe
- **Notifications**: Apple APNs, Google FCM
