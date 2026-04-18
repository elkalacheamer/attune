# Publishing Attune to TestFlight — Step-by-Step Guide

## Overview
This guide takes you from zero to having the Attune app installed on your iPhone via TestFlight. You'll need two accounts and about 30–60 minutes.

---

## Step 1 — Create a Free Expo Account

1. Go to **https://expo.dev** and click **Sign Up**
2. Create a free account (no credit card needed)
3. Verify your email

---

## Step 2 — Enroll in the Apple Developer Program

1. Go to **https://developer.apple.com/programs/enroll/**
2. Sign in with your Apple ID (create one if needed)
3. Select **Individual** enrollment
4. Pay the **$99/year** fee
5. Wait for approval — usually instant, sometimes up to 24 hours

---

## Step 3 — Install Tools on Your Mac

Open Terminal and run these commands one at a time:

```bash
# Install Node.js if you haven't already
# Download from https://nodejs.org (LTS version)

# Install EAS CLI (Expo's build tool)
npm install -g eas-cli

# Verify it installed
eas --version
```

---

## Step 4 — Log In to EAS

In Terminal:

```bash
eas login
```

Enter your Expo account email and password when prompted.

---

## Step 5 — Link the App to Your EAS Account

```bash
cd /path/to/attune/apps/mobile

eas build:configure
```

This will:
- Ask you to log in to your Expo account (if not already)
- Create the project on expo.dev
- Automatically fill in the `projectId` in your `app.json`

---

## Step 6 — Build the iOS Preview

```bash
eas build --platform ios --profile preview
```

What happens:
- EAS will ask if you want to log in to your Apple Developer account — say **Yes**
- It will automatically create the necessary certificates and provisioning profiles
- The build runs on Expo's cloud servers (takes ~15–20 minutes)
- You'll get a link to download the `.ipa` file when done

> **Note**: When prompted about an Apple team, select your individual developer account.

---

## Step 7 — Upload to TestFlight

Once the build finishes, run:

```bash
eas submit --platform ios --latest
```

This uploads the build to **App Store Connect**. You'll be prompted for:
- Your Apple ID email
- An app-specific password (create one at appleid.apple.com → Security → App-Specific Passwords)

---

## Step 8 — Set Up TestFlight in App Store Connect

1. Go to **https://appstoreconnect.apple.com**
2. Click **My Apps** → you should see **Attune** listed
3. Click on Attune → **TestFlight** tab
4. Wait for the build to finish processing (5–10 min, shown as "Testing")
5. Click the build → **Add Testers** → add your email
6. You'll receive a TestFlight invite email

---

## Step 9 — Install on Your iPhone

1. Install the **TestFlight** app from the App Store on your iPhone
2. Open the invite email on your iPhone
3. Tap the link → opens TestFlight → tap **Install**
4. Attune is now on your phone! 🎉

---

## Updating the App Later

Whenever you make changes and want to push a new test build:

```bash
cd apps/mobile
eas build --platform ios --profile preview
eas submit --platform ios --latest
```

TestFlight testers will be notified automatically.

---

## Troubleshooting

**"No bundle identifier found"** — Make sure `app.json` has `ios.bundleIdentifier: "com.attune.app"`

**Build fails on certificates** — Run `eas credentials` to manage/reset your iOS certificates

**"Missing provisioning profile"** — Let EAS manage credentials automatically (answer Yes when asked)

**App crashes on launch** — Make sure your backend `.env` URLs in `eas.json` point to a live server, not localhost

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `eas login` | Log in to your Expo account |
| `eas build:configure` | Link app to EAS and get projectId |
| `eas build --platform ios --profile preview` | Build a TestFlight-ready .ipa |
| `eas submit --platform ios --latest` | Upload last build to App Store Connect |
| `eas build --platform ios --profile production` | Build for App Store release |
