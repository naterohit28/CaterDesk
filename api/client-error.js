// Receives error reports from public/error-reporter.js and writes them to the Vercel runtime logs.
// When ALERT_WEBHOOK_URL is set (a Discord, Slack or Google Chat incoming webhook), new errors are also posted there.
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
const ALERT_REPEAT_MS = 60 * 60 * 1000;

// Best-effort limits; they reset whenever Vercel starts a new instance.
const hitsByIp = new Map();
const lastAlertByMessage = new Map();

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function rateLimited(ip, now) {
  const recent = (hitsByIp.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hitsByIp.set(ip, recent);
  if (hitsByIp.size > 5000) hitsByIp.clear();
  return recent.length > RATE_MAX;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function alert(report, now) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const last = lastAlertByMessage.get(report.message) || 0;
  if (now - last < ALERT_REPEAT_MS) return;
  lastAlertByMessage.set(report.message, now);
  const text = `CaterDesk v${report.release || '?'} error on ${report.path || '/'}: ${report.message}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text })
    });
  } catch (e) {
    console.warn('Alert webhook failed:', e.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Reports are accepted from this site only.' });

  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip, now)) return res.status(429).json({ error: 'Too many reports. Try again in a minute.' });

  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return res.status(413).json({ error: 'Report is too large.' });
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Report must be JSON.' }); }
  }
  if (!body || typeof body !== 'object' || !body.message) return res.status(400).json({ error: 'Report needs a message.' });
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return res.status(413).json({ error: 'Report is too large.' });

  const report = {
    kind: clip(body.kind, 40),
    message: clip(body.message, 500),
    stack: clip(body.stack, 2000),
    source: clip(body.source, 200),
    line: Number.isInteger(body.line) ? body.line : null,
    column: Number.isInteger(body.column) ? body.column : null,
    path: clip(body.path, 200),
    release: clip(body.release, 20),
    userAgent: clip(body.userAgent, 300),
    at: clip(body.at, 40)
  };

  console.error('[client-error]', JSON.stringify(report));
  await alert(report, now);
  return res.status(204).end();
};
