export function getPortalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Earn Street • Production API & Services Gateway</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030A18;
      --card-bg: rgba(13, 27, 56, 0.7);
      --card-border: rgba(30, 64, 128, 0.4);
      --primary: #1459E8;
      --primary-glow: rgba(20, 89, 232, 0.4);
      --gold: #FFD45A;
      --gold-glow: rgba(255, 212, 90, 0.3);
      --success: #10B981;
      --text: #F1F5F9;
      --text-muted: #94A3B8;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: radial-gradient(circle at 50% -20%, #143575 0%, var(--bg) 60%);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      line-height: 1.6;
      padding-bottom: 60px;
    }
    .header {
      border-bottom: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(3, 10, 24, 0.85);
    }
    .header-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo-group {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: inherit;
    }
    .logo-badge {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #FFD45A 0%, #D49B1E 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px var(--gold-glow);
    }
    .logo-badge svg {
      width: 24px;
      height: 24px;
      fill: #0A1931;
    }
    .brand-title {
      font-weight: 800;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .brand-title span {
      color: var(--gold);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 9999px;
      color: #34D399;
      font-size: 0.825rem;
      font-weight: 600;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #10B981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10B981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 24px;
    }
    .hero {
      text-align: center;
      padding: 40px 0 60px;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: rgba(20, 89, 232, 0.15);
      border: 1px solid rgba(20, 89, 232, 0.4);
      border-radius: 20px;
      color: #60A5FA;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .hero-title {
      font-size: 3rem;
      font-weight: 900;
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin-bottom: 16px;
    }
    .hero-title .gradient-text {
      background: linear-gradient(135deg, #FFFFFF 0%, #FFD45A 60%, #F59E0B 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero-subtitle {
      max-width: 700px;
      margin: 0 auto 32px;
      color: var(--text-muted);
      font-size: 1.15rem;
    }
    .btn-group {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;
      margin-bottom: 40px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 28px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, #1459E8 0%, #0F42B0 100%);
      color: #FFFFFF;
      box-shadow: 0 4px 20px var(--primary-glow);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(20, 89, 232, 0.6);
    }
    .btn-gold {
      background: linear-gradient(135deg, #FFD45A 0%, #D49B1E 100%);
      color: #041026;
      box-shadow: 0 4px 20px var(--gold-glow);
    }
    .btn-gold:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(255, 212, 90, 0.5);
    }
    .btn-secondary {
      background: rgba(13, 27, 56, 0.8);
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: rgba(20, 40, 80, 0.9);
      border-color: rgba(20, 89, 232, 0.6);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      margin-bottom: 50px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(12px);
      transition: border-color 0.2s ease;
    }
    .stat-card:hover {
      border-color: rgba(255, 212, 90, 0.5);
    }
    .stat-label {
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 1.6rem;
      font-weight: 800;
      color: #FFFFFF;
    }
    .stat-value.gold {
      color: var(--gold);
    }
    .stat-sub {
      color: #64748B;
      font-size: 0.8rem;
      margin-top: 4px;
    }
    .section-title {
      font-size: 1.6rem;
      font-weight: 800;
      margin-bottom: 24px;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .endpoints-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .endpoint-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .endpoint-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .method {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.2);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .method.post {
      background: rgba(59, 130, 246, 0.2);
      color: #60A5FA;
      border-color: rgba(59, 130, 246, 0.4);
    }
    .endpoint-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      font-weight: 600;
      color: #FFFFFF;
      margin-bottom: 6px;
    }
    .endpoint-desc {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-bottom: 16px;
    }
    .test-btn {
      width: 100%;
      padding: 8px 14px;
      border-radius: 8px;
      background: rgba(20, 89, 232, 0.15);
      border: 1px solid rgba(20, 89, 232, 0.3);
      color: #93C5FD;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .test-btn:hover {
      background: rgba(20, 89, 232, 0.35);
      color: #FFFFFF;
    }
    .console-box {
      background: #020712;
      border: 1px solid rgba(30, 64, 128, 0.5);
      border-radius: 16px;
      padding: 24px;
      margin-top: 20px;
    }
    .console-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .console-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      font-weight: 600;
      color: #94A3B8;
    }
    pre {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #38BDF8;
      overflow-x: auto;
      max-height: 250px;
      white-space: pre-wrap;
    }
    .footer {
      text-align: center;
      color: #64748B;
      font-size: 0.85rem;
      margin-top: 60px;
    }
    .footer a {
      color: var(--gold);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <a href="/" class="logo-group">
        <div class="logo-badge">
          <svg viewBox="0 0 24 24"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>
        </div>
        <div class="brand-title">EARN STREET <span>API</span></div>
      </a>
      <div class="status-pill">
        <span class="pulse-dot"></span>
        <span>Tokyo DB Pooler • Online</span>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="hero">
      <div class="hero-badge">⚡ Global Serverless Core • Vercel & Supabase</div>
      <h1 class="hero-title">
        The High-Throughput <br>
        <span class="gradient-text">Financial Rewards Gateway</span>
      </h1>
      <p class="hero-subtitle">
        Secure Express backend orchestrating 10 sequential tiers, 100 verified tasks, 
        instant PKR payouts, and deterministic royal spins backed by PostgreSQL.
      </p>

      <div class="btn-group">
        <a href="https://www.streetearnpro.site" target="_blank" class="btn btn-gold">
          🚀 Open Member App
        </a>
        <a href="https://www.backenddostear.space/adminpanal/dashboard" target="_blank" class="btn btn-primary">
          👑 Open Admin Control Portal
        </a>
        <a href="/api/health" class="btn btn-secondary">
          ⚡ Check /api/health
        </a>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Database Engine</div>
        <div class="stat-value gold">Supabase PG</div>
        <div class="stat-sub">Tokyo ap-northeast-1 • Port 6543</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Progression Tiers</div>
        <div class="stat-value">10 Levels</div>
        <div class="stat-sub">100 Sequential Tasks Seeded</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Execution Environment</div>
        <div class="stat-value">Node.js 24</div>
        <div class="stat-sub">Prisma ORM • ES Modules</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Wheel Probabilities</div>
        <div class="stat-value gold">8 Spin Prizes</div>
        <div class="stat-sub">Deterministic Server RNG</div>
      </div>
    </div>

    <h2 class="section-title">
      <span>📡</span> Core API Services
    </h2>

    <div class="endpoints-grid">
      <div class="endpoint-card">
        <div>
          <div class="endpoint-header">
            <span class="method">GET</span>
            <span style="font-size:0.75rem; color:#10B981;">Public</span>
          </div>
          <div class="endpoint-path">/api/settings/public</div>
          <div class="endpoint-desc">Retrieves global platform configurations, support contacts, minimum deposits & withdrawals.</div>
        </div>
        <button class="test-btn" onclick="runTest('/api/settings/public')">Execute Request →</button>
      </div>

      <div class="endpoint-card">
        <div>
          <div class="endpoint-header">
            <span class="method">GET</span>
            <span style="font-size:0.75rem; color:#10B981;">Public</span>
          </div>
          <div class="endpoint-path">/api/health</div>
          <div class="endpoint-desc">Live heartbeat probe verifying edge runtime execution and service availability.</div>
        </div>
        <button class="test-btn" onclick="runTest('/api/health')">Execute Request →</button>
      </div>

      <div class="endpoint-card">
        <div>
          <div class="endpoint-header">
            <span class="method post">POST</span>
            <span style="font-size:0.75rem; color:#60A5FA;">Auth</span>
          </div>
          <div class="endpoint-path">/api/auth/login</div>
          <div class="endpoint-desc">Authenticates phone & password credentials, issuing signed HMAC SHA-256 JWT sessions.</div>
        </div>
        <button class="test-btn" onclick="runTest('/api/health', 'POST /api/auth/login requires phone & password')">Inspect Specification →</button>
      </div>

      <div class="endpoint-card">
        <div>
          <div class="endpoint-header">
            <span class="method">GET</span>
            <span style="font-size:0.75rem; color:#F59E0B;">Protected</span>
          </div>
          <div class="endpoint-path">/api/tasks/levels</div>
          <div class="endpoint-desc">Provides personalized 10-level progress, locked/unlocked statuses, and submission history.</div>
        </div>
        <button class="test-btn" onclick="runTest('/api/health', 'GET /api/tasks/levels requires user Bearer token')">Inspect Specification →</button>
      </div>
    </div>

    <div class="console-box">
      <div class="console-header">
        <span class="console-title">Live API Response Console</span>
        <span id="responseStatus" style="font-size:0.8rem; font-weight:600; color:#10B981;">Ready</span>
      </div>
      <pre id="responseOutput">// Click "Execute Request" above to test live data response</pre>
    </div>

    <footer class="footer">
      <p>Earn Street Platform API • Connected to Supabase Project <code>iwzonipiymbsspnyoszt</code></p>
      <p style="margin-top: 6px;">Main App: <a href="https://www.streetearnpro.site">https://www.streetearnpro.site</a></p>
    </footer>
  </main>

  <script>
    async function runTest(endpoint, notice) {
      const output = document.getElementById('responseOutput');
      const status = document.getElementById('responseStatus');
      if (notice) {
        output.innerText = "// " + notice;
        status.innerText = "Info";
        status.style.color = "#60A5FA";
        return;
      }
      status.innerText = "Fetching...";
      status.style.color = "#FFD45A";
      output.innerText = "Loading data from " + endpoint + "...";
      try {
        const res = await fetch(endpoint);
        const data = await res.json();
        status.innerText = res.status + " " + res.statusText;
        status.style.color = "#10B981";
        output.innerText = JSON.stringify(data, null, 2);
      } catch (err) {
        status.innerText = "Error";
        status.style.color = "#EF4444";
        output.innerText = err.toString();
      }
    }
    // Auto load public settings on first visit
    runTest('/api/settings/public');
  </script>
</body>
</html>`;
}
