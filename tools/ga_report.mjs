// Fetch Advent Village visit numbers from the GA4 Data API. Node standard library only, no npm install.
//   GA_KEY_FILE=~/.config/advent-village/ga-key.json GA_PROPERTY_ID=123456789 node tools/ga_report.mjs [--days 28]
// The key is a service-account JSON kept OUTSIDE the repo; never commit it.
import fs from 'node:fs';
import { createSign } from 'node:crypto';

const SETUP = `Setup (one time):
  1. analytics.google.com: create the GA4 property and web stream; Admin > Property details shows the numeric PROPERTY ID.
  2. console.cloud.google.com: enable "Google Analytics Data API" for a project.
  3. IAM > Service accounts: create one, add a JSON key, save it outside the repo, e.g. ~/.config/advent-village/ga-key.json
  4. GA Admin > Property access management: add the service account's email as Viewer.
Then: GA_KEY_FILE=<path to key> GA_PROPERTY_ID=<id> node tools/ga_report.mjs [--days 28]`;

const keyFile = process.env.GA_KEY_FILE?.replace(/^~(?=\/)/, process.env.HOME), property = process.env.GA_PROPERTY_ID;
if (!keyFile || !property || !fs.existsSync(keyFile)) { console.error(`GA_KEY_FILE and GA_PROPERTY_ID must be set and the key file must exist.\n\n${SETUP}`); process.exit(1); }
const i = process.argv.indexOf('--days'), days = i > 0 ? Number(process.argv[i + 1]) || 28 : 28;

// service account -> signed JWT -> access token (read-only scope)
const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: key.token_uri, iat: now, exp: now + 3600 })}`;
const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
const tok = await fetch(key.token_uri, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) }).then((r) => r.json());
if (!tok.access_token) { console.error('Token request failed:', tok.error_description || tok.error || tok); process.exit(1); }

const report = async (dimension, extra = {}) => {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }], dimensions: [{ name: dimension }], metrics: ['activeUsers', 'sessions', 'screenPageViews'].map((name) => ({ name })), ...extra }),
  }).then((r) => r.json());
  if (r.error) { console.error(`runReport failed: ${r.error.message}\n\n${SETUP}`); process.exit(1); }
  return (r.rows || []).map((row) => [row.dimensionValues[0].value, ...row.metricValues.map((m) => Number(m.value))]);
};
const table = (title, rows) => {
  console.log(`\n${title}\n${'users'.padStart(22)}${'sessions'.padStart(10)}${'views'.padStart(8)}`);
  for (const [k, u, s, v] of rows) console.log(`${k.padEnd(14)}${String(u).padStart(8)}${String(s).padStart(10)}${String(v).padStart(8)}`);
  if (!rows.length) console.log('(no data yet)');
};

table(`By day, last ${days} days`, await report('date', { orderBys: [{ dimension: { dimensionName: 'date' } }] }));
table('Top countries', await report('country', { orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 10 }));
