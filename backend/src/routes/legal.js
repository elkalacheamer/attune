const LAST_UPDATED = 'April 2026'
const CONTACT_EMAIL = 'privacy@attune.app'

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy · Attune</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #FAFAF8;
      color: #1a1a1a;
      line-height: 1.7;
      padding: 0 20px;
    }
    .page {
      max-width: 680px;
      margin: 0 auto;
      padding: 60px 0 80px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 40px;
    }
    .brand-mark {
      width: 28px;
      height: 28px;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 300;
      letter-spacing: 5px;
      color: #1E1A4B;
    }
    h1 {
      font-size: 28px;
      font-weight: 400;
      color: #1E1A4B;
      letter-spacing: -0.3px;
      margin-bottom: 8px;
    }
    .meta {
      font-size: 13px;
      color: #888780;
      margin-bottom: 40px;
    }
    h2 {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a1a;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-top: 36px;
      margin-bottom: 10px;
    }
    p { font-size: 14px; color: #3d3d3a; margin-bottom: 12px; }
    ul { padding-left: 20px; margin-bottom: 12px; }
    li { font-size: 14px; color: #3d3d3a; margin-bottom: 6px; }
    a { color: #7F77DD; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .divider { height: 1px; background: #e8e6de; margin: 36px 0; }
    .footer { font-size: 12px; color: #888780; margin-top: 48px; }
  </style>
</head>
<body>
  <div class="page">

    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="25" cy="36" r="17" stroke="#1E1A4B" stroke-width="2.5" opacity="0.4"/>
        <circle cx="47" cy="36" r="17" stroke="#1E1A4B" stroke-width="2.5" opacity="0.4"/>
        <circle cx="36" cy="36" r="4" fill="#1E1A4B" opacity="0.85"/>
      </svg>
      <span class="brand-name">attune</span>
    </div>

    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: ${LAST_UPDATED}</p>

    <p>Attune ("we", "us", or "our") is a relationship intelligence app designed to help couples understand each other better through biometric data, mood tracking, and AI-powered insights. We take your privacy seriously — particularly given the sensitive nature of health and relationship data.</p>

    <div class="divider"></div>

    <h2>1. Information We Collect</h2>
    <p>We collect information you provide directly and data from connected health devices:</p>
    <ul>
      <li><strong>Account information:</strong> Name, email address, and password (stored as a secure hash).</li>
      <li><strong>Profile data:</strong> Biological sex, which is used to tailor cycle tracking and biometric interpretation.</li>
      <li><strong>Health and biometric data:</strong> Heart rate variability (HRV), resting heart rate, sleep duration, recovery scores, body temperature, step count, and respiratory rate — sourced from Apple Health or WHOOP with your explicit permission.</li>
      <li><strong>Cycle data:</strong> Menstrual cycle phase, day number, and associated predictions — only for female profiles and only when you enable cycle tracking.</li>
      <li><strong>Mood check-ins:</strong> Daily mood scores you log within the app.</li>
      <li><strong>Relationship events:</strong> Notes you share with the agent (e.g. moments of intimacy, conflict, or connection) which are stored and used to generate insights.</li>
      <li><strong>Agent conversations:</strong> Messages exchanged with the Attune AI agent.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To provide personalised relationship insights and AI-generated recommendations.</li>
      <li>To detect patterns in your biometric and mood data over time.</li>
      <li>To surface contextually relevant information to your partner (subject to your privacy settings — see Section 5).</li>
      <li>To improve the accuracy of cycle phase predictions.</li>
      <li>To operate, maintain, and improve the Attune service.</li>
    </ul>
    <p>We do not sell your data to third parties. We do not use your data for advertising purposes.</p>

    <h2>3. Third-Party Integrations</h2>
    <p>Attune integrates with the following third-party health platforms:</p>
    <ul>
      <li><strong>Apple HealthKit:</strong> Data is read from Apple Health with your explicit permission. Attune does not write data back to HealthKit except where you specifically request it. Apple's HealthKit data is never used for advertising or sold to data brokers.</li>
      <li><strong>WHOOP:</strong> When you connect your WHOOP account, Attune receives recovery, sleep, and HRV data via the WHOOP OAuth API. You may disconnect WHOOP at any time from your profile.</li>
    </ul>
    <p>These integrations are optional. The app functions without any connected health devices.</p>

    <h2>4. Data Storage and Security</h2>
    <p>All data is stored in a secure, encrypted PostgreSQL database hosted in the European Union (Railway infrastructure). We use industry-standard TLS encryption for all data in transit. Authentication tokens are stored in your device's secure keychain (iOS Keychain) and never in plain-text storage.</p>
    <p>We retain your data for as long as your account is active. You may request deletion of your account and all associated data at any time by contacting us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

    <h2>5. Partner Data Sharing</h2>
    <p>Attune is a couples app. When you are paired with a partner, limited information may be shared with them to generate joint insights. You control exactly what your partner can see via the Privacy settings in your profile. By default:</p>
    <ul>
      <li>Your partner sees your cycle <strong>phase name</strong> (e.g. "Luteal") and day number — never your detailed symptoms or cycle log.</li>
      <li>Your partner sees a general stress indicator — never your raw HRV or recovery scores.</li>
      <li>Your partner sees your logged mood trend — never individual mood scores.</li>
    </ul>
    <p>You can disable all partner sharing at any time in Settings → Privacy.</p>

    <h2>6. AI Processing</h2>
    <p>Attune uses the Anthropic Claude API to generate insights and power the agent conversation. When generating insights, anonymised, aggregated summaries of your biometric and relationship data are sent to Anthropic's API. Individual messages sent to the Attune agent may also be processed by this API. Anthropic's privacy policy applies to this processing and is available at <a href="https://www.anthropic.com/privacy" target="_blank">anthropic.com/privacy</a>.</p>

    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access all data we hold about you.</li>
      <li>Correct inaccurate data.</li>
      <li>Request deletion of your account and all associated data.</li>
      <li>Export your data in a portable format.</li>
      <li>Withdraw consent for health data access at any time via your device settings.</li>
    </ul>
    <p>To exercise any of these rights, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

    <h2>8. Children's Privacy</h2>
    <p>Attune is not intended for users under the age of 18. We do not knowingly collect personal information from anyone under 18. If you believe a minor has created an account, please contact us and we will remove their data promptly.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or by email. Continued use of Attune after changes are posted constitutes your acceptance of the updated policy.</p>

    <h2>10. Contact</h2>
    <p>If you have any questions about this Privacy Policy or how we handle your data, please contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

    <div class="divider"></div>
    <p class="footer">© ${new Date().getFullYear()} Attune. All rights reserved.</p>
  </div>
</body>
</html>`

const TERMS_HTML = PRIVACY_HTML
  .replace('<title>Privacy Policy · Attune</title>', '<title>Terms of Service · Attune</title>')
  .replace('<h1>Privacy Policy</h1>', '<h1>Terms of Service</h1>')

export async function legalRoutes(app) {
  app.get('/privacy', async (request, reply) => {
    reply.type('text/html').send(PRIVACY_HTML)
  })

  app.get('/terms', async (request, reply) => {
    reply.type('text/html').send(PRIVACY_HTML) // reuse privacy as placeholder until terms are written
  })
}
