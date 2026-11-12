// Receives redacted error reports from public/error-reporter.js and writes them to the Vercel runtime logs.
// When ALERT_WEBHOOK_URL is set (a Discord, Slack or Google Chat incoming webhook), new errors are also posted there.
// Strict redaction (D-2): only allow-listed technical fields with fixed formats are kept. Free text of any kind
// (messages, stacks, paths, browser strings, names, phone numbers) is dropped here even if a client sends it.
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
const ALERT_REPEAT_MS = 60 * 60 * 1000;

const KINDS = ['error', 'unhandledrejection', 'handled'];
// Recognised error types only. Anything else, even a plain word such as a person's name, is stored as "Other".
const CODES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError',
    'DOMException', 'AbortError', 'TimeoutError', 'QuotaExceededError', 'InvalidStateError', 'NotFoundError', 'NotAllowedError',
    'NotReadableError', 'NotSupportedError', 'SecurityError', 'NetworkError', 'DataError', 'DataCloneError', 'ConstraintError',
    'TransactionInactiveError', 'ReadOnlyError', 'VersionError', 'UnknownError', 'EncodingError', 'OperationError'].concat(['NonError', 'Other']);
// The app's own scripts; any other name is reported as "other" so a file name cannot carry text.
const FILES = ['app.js', 'db.js', 'utils.js', 'i18n.js', 'icons.js', 'sw.js', 'register-sw.js', 'error-reporter.js'];
const BROWSERS = ['android-webview', 'chrome-android', 'chrome', 'edge', 'firefox', 'safari', 'other'];

// Best-effort limits; they reset whenever Vercel starts a new instance.
const hitsByIp = new Map();
const lastAlertByKey = new Map();

const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const int = n => Number.isInteger(n) && n >= 0 && n < 1e7 ? n : null;

function fileName(value) {
  if (typeof value !== 'string') return null;
  if (value === 'other' || value === 'external') return value;
  const name = value.split(/[?#]/)[0].split('/').pop();
  return FILES.includes(name) ? name : 'other';
}

// Builds the stored report from allow-listed fields only. Reports from older app versions
// (message/stack/source/userAgent) are accepted but reduced to the same fields.
function redact(body) {
  return {
    kind: pick(body.kind, KINDS, 'error'),
    code: pick(body.code, CODES, 'Other'),
    file: fileName(body.file) || fileName(body.source) || 'other',
    line: int(body.line),
    column: int(body.column),
    release: typeof body.release === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.release) ? body.release : 'unknown',
    browser: pick(body.browser, BROWSERS, 'other')
  };
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
  const key = [report.code, report.file, report.line, report.column, report.release].join('|');
  if (now - (lastAlertByKey.get(key) || 0) < ALERT_REPEAT_MS) return;
  lastAlertByKey.set(key, now);
  if (lastAlertByKey.size > 1000) lastAlertByKey.clear();
  const text = `CaterDesk v${report.release} ${report.code} (${report.kind}) in ${report.file}:${report.line ?? '?'}:${report.column ?? '?'} on ${report.browser}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text })
    });
  } catch (e) {
    console.warn('Alert webhook failed');   // no error name or text: either could carry the URL or other free text
  }
}

async function handler(req, res) {
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Report must be a JSON object.' });
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return res.status(413).json({ error: 'Report is too large.' });

  const report = redact(body);
  console.error('[client-error]', JSON.stringify(report));
  await alert(report, now);
  return res.status(204).end();
}

module.exports = handler;
module.exports.redact = redact;
