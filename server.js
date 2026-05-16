'use strict';
require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const cron     = require('node-cron');
const fs       = require('fs-extra');
const path     = require('path');

// ── Config (set these as environment variables on Railway) ──────
const EMAIL_USER    = process.env.GMAIL_USER         || 'cwetsch2015@gmail.com';
const EMAIL_PASS    = process.env.GMAIL_APP_PASSWORD  || 'zwduceknusptckqf';
const DIGEST_TO     = process.env.DIGEST_TO_EMAIL     || 'cwetsch2015@gmail.com';
const FRONTEND_URL  = process.env.FRONTEND_URL        || 'http://localhost:5500';
const SESSION_SECRET= process.env.SESSION_SECRET      || 'social-monitor-secret-xyz-2024';
const DIGEST_HOUR   = process.env.DIGEST_HOUR         || '7';
const DIGEST_MINUTE = process.env.DIGEST_MINUTE       || '0';

// ── Staff accounts (add your team here) ─────────────────────────
const STAFF_CONFIG = [
  { username: 'admin',  password: process.env.ADMIN_PASSWORD  || 'admin123',  role: 'admin' },
  { username: 'staff1', password: process.env.STAFF1_PASSWORD || 'staff123',  role: 'staff' },
  { username: 'staff2', password: process.env.STAFF2_PASSWORD || 'staff123',  role: 'staff' },
];

// Hash passwords once on startup
const staffMap = {};
STAFF_CONFIG.forEach(s => {
  staffMap[s.username] = { hash: bcrypt.hashSync(s.password, 10), role: s.role };
});

// ── Data store ──────────────────────────────────────────────────
// Railway has ephemeral storage — data persists between restarts but not deploys
// For production, swap this for a free Supabase/PlanetScale database
const DATA_FILE = path.join(__dirname, '../data/issues.json');
let issues = [];

async function loadIssues() {
  try {
    await fs.ensureDir(path.dirname(DATA_FILE));
    if (await fs.pathExists(DATA_FILE)) {
      issues = await fs.readJson(DATA_FILE);
    }
  } catch(e) { issues = []; }
}

async function saveIssues() {
  await fs.ensureDir(path.dirname(DATA_FILE));
  await fs.writeJson(DATA_FILE, issues, { spaces: 2 });
}

// ── Scanner (mock — replace with real platform API calls) ────────
// When you connect real APIs, import your platform modules here
function generateMockIssues() {
  const platforms = ['facebook','instagram','linkedin','reddit','google','tripadvisor'];
  const types     = ['negative','unanswered'];
  const messages  = {
    negative: [
      'User left a 1-star review: "Terrible experience, no response from support."',
      'Comment: "Worst service I\'ve ever had. Will never return."',
      'Review: "Complete scam. Avoid at all costs."',
      'Post: "Still waiting 3 weeks for my order. Absolutely unacceptable."',
      'Comment: "Nobody ever responds here. Terrible customer service."',
    ],
    unanswered: [
      'DM unanswered 18 hours: "Do you offer group discounts?"',
      'Message unanswered 12 hours: "Is this still available?"',
      'Comment unanswered 24 hours: "Are you open on Sundays?"',
      'Inquiry unanswered 9 hours: "Can I get a refund on my order?"',
      'DM unanswered 6 hours: "What are your hours this weekend?"',
    ]
  };

  const count = Math.floor(Math.random() * 4) + 1;
  return Array.from({length: count}, (_, i) => {
    const type     = types[Math.floor(Math.random() * types.length)];
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    return {
      id:         Date.now() + i,
      platform,
      type,
      severity:   type === 'negative' ? 'high' : 'medium',
      message:    messages[type][Math.floor(Math.random() * messages[type].length)],
      time:       new Date(Date.now() - Math.random() * 72000000).toISOString(),
      resolved:   false,
      resolvedBy: null,
      resolvedAt: null,
      assignedTo: null,
      notes:      '',
    };
  });
}

async function runScan() {
  console.log(`[${new Date().toLocaleTimeString()}] Scanning...`);
  const fresh    = generateMockIssues();
  const existing = new Set(issues.map(i => i.message + i.platform));
  const added    = fresh.filter(i => !existing.has(i.message + i.platform));
  issues = [...added, ...issues].slice(0, 300);
  await saveIssues();
  console.log(`  +${added.length} new. Total: ${issues.length}`);
  return added;
}

// ── Email digest ─────────────────────────────────────────────────
async function sendDigest() {
  const nodemailer = require('nodemailer');
  const open = issues.filter(i => !i.resolved);
  const high = open.filter(i => i.severity === 'high');
  const date = new Date().toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric' });

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });

  const PLAT_COLORS = {
    facebook:'#1877F2', instagram:'#E1306C', linkedin:'#0077B5',
    reddit:'#FF4500', google:'#4285F4', tripadvisor:'#34C759'
  };

  const rows = open.slice(0, 20).map(i => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px;font-size:13px;color:#333">${i.message}</td>
      <td style="padding:10px;font-size:12px;color:${PLAT_COLORS[i.platform]||'#666'};font-weight:600;text-transform:capitalize">${i.platform}</td>
      <td style="padding:10px"><span style="background:${i.severity==='high'?'#FDEDEC':'#FEF3E2'};color:${i.severity==='high'?'#C0392B':'#A85C00'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${i.severity.toUpperCase()}</span></td>
    </tr>`).join('');

  await transport.sendMail({
    from: `"Social Monitor" <${EMAIL_USER}>`,
    to:   DIGEST_TO,
    subject: `${high.length > 0 ? '🔴' : '🟡'} Social Monitor — ${open.length} open issue${open.length!==1?'s':''} · ${date}`,
    html: `
      <div style="font-family:sans-serif;max-width:620px;margin:0 auto">
        <div style="background:#1A1A2E;padding:24px 32px;border-radius:10px 10px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">📡 Morning Digest</h1>
          <p style="color:#9999BB;margin:6px 0 0;font-size:14px">${date}</p>
        </div>
        <div style="background:#fff;padding:24px 32px;border:1px solid #eee">
          <p style="font-size:15px;color:#333;margin:0 0 16px">
            <strong>${open.length}</strong> open issues · <strong style="color:#C0392B">${high.length}</strong> high priority
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
            <thead><tr style="background:#f8f8f8">
              <th style="padding:10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Issue</th>
              <th style="padding:10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Platform</th>
              <th style="padding:10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Priority</th>
            </tr></thead>
            <tbody>${rows||'<tr><td colspan="3" style="padding:24px;text-align:center;color:#27AE60;font-size:14px">✅ No open issues — great work!</td></tr>'}</tbody>
          </table>
          ${open.length > 20 ? `<p style="font-size:12px;color:#999;margin-top:12px">Showing 20 of ${open.length} issues. Log in to see all.</p>` : ''}
        </div>
        <div style="padding:16px 32px;text-align:center">
          <p style="font-size:12px;color:#aaa;margin:0">Social Monitor · ${new Date().toLocaleTimeString()}</p>
        </div>
      </div>`
  });
  console.log('Digest sent to', DIGEST_TO);
}

// ── Express setup ────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: [FRONTEND_URL, /\.netlify\.app$/, 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'none',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Admins only' });
}

// ── Routes ───────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = staffMap[username];
  if (!user || !bcrypt.compareSync(password, user.hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.user = { username, role: user.role };
  res.json({ ok: true, username, role: user.role });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

app.get('/api/issues', requireAuth, (req, res) => {
  const { platform, type, status, severity } = req.query;
  let f = [...issues];
  if (platform && platform !== 'all') f = f.filter(i => i.platform === platform);
  if (type     && type !== 'all')     f = f.filter(i => i.type === type);
  if (severity && severity !== 'all') f = f.filter(i => i.severity === severity);
  if (status === 'open')     f = f.filter(i => !i.resolved);
  if (status === 'resolved') f = f.filter(i => i.resolved);
  res.json(f);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const open     = issues.filter(i => !i.resolved);
  const resolved = issues.filter(i => i.resolved);
  const high     = open.filter(i => i.severity === 'high');
  const platforms = {};
  open.forEach(i => { platforms[i.platform] = (platforms[i.platform]||0)+1; });
  res.json({ total: issues.length, open: open.length, resolved: resolved.length, high: high.length, platforms });
});

app.post('/api/issues/:id/resolve', requireAuth, async (req, res) => {
  const issue = issues.find(i => i.id === parseInt(req.params.id));
  if (!issue) return res.status(404).json({ error: 'Not found' });
  issue.resolved   = true;
  issue.resolvedBy = req.session.user.username;
  issue.resolvedAt = new Date().toISOString();
  issue.notes      = req.body.notes || '';
  issue.assignedTo = req.body.assignedTo || issue.assignedTo;
  await saveIssues();
  res.json(issue);
});

app.post('/api/issues/:id/reopen', requireAuth, requireAdmin, async (req, res) => {
  const issue = issues.find(i => i.id === parseInt(req.params.id));
  if (!issue) return res.status(404).json({ error: 'Not found' });
  issue.resolved = false; issue.resolvedBy = null; issue.resolvedAt = null;
  await saveIssues();
  res.json(issue);
});

app.post('/api/scan',   requireAuth, requireAdmin, async (req, res) => {
  const added = await runScan();
  res.json({ added: added.length, total: issues.length });
});

app.post('/api/digest', requireAuth, requireAdmin, async (req, res) => {
  try { await sendDigest(); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/staff', requireAuth, requireAdmin, (req, res) => {
  res.json(STAFF_CONFIG.map(s => ({ username: s.username, role: s.role })));
});

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

loadIssues().then(async () => {
  if (issues.length === 0) await runScan();

  app.listen(PORT, () => {
    console.log(`\n📡 Social Monitor Backend running on port ${PORT}`);
    console.log(`   Frontend URL: ${FRONTEND_URL}`);
  });

  // Daily digest + scan
  cron.schedule(`${DIGEST_MINUTE} ${DIGEST_HOUR} * * *`, () => {
    runScan().then(sendDigest).catch(console.error);
  });

  // Auto-scan every 2 hours
  cron.schedule('0 */2 * * *', () => runScan().catch(console.error));
});
