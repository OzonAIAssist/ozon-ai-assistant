'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const CLIENT_ID = process.env.OZON_CLIENT_ID || '';
const API_KEY = process.env.OZON_API_KEY || '';
const ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN || '';
const ORIGIN = (process.env.ALLOWED_ORIGIN || 'https://ozonaiassist.github.io').trim().replace(/\/+$/, '');
const API_BASE = 'https://api-seller.ozon.ru';
const MAX_ITEMS = 20000;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}
function reply(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...cors(origin)
  });
  res.end(JSON.stringify(body));
}
function authorized(req) {
  const auth = req.headers.authorization || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!supplied || !ACCESS_TOKEN) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function ozon(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(API_BASE + path, {
      method: 'POST',
      headers: {
        'Client-Id': CLIENT_ID,
        'Api-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Ozon API returned HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
async function products() {
  let lastId = '';
  const all = [];
  const seen = new Set();
  while (all.length < MAX_ITEMS) {
    const data = await ozon('/v3/product/list', {
      filter: { visibility: 'ALL' }, last_id: lastId, limit: 1000
    });
    const result = data.result || {};
    const items = Array.isArray(result.items) ? result.items : [];
    for (const item of items) {
      const id = String(item.product_id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({ product_id: id, offer_id: String(item.offer_id ?? '') });
    }
    const next = String(result.last_id || '');
    if (!next || next === lastId || !items.length) break;
    lastId = next;
  }
  if (all.length >= MAX_ITEMS) throw new Error('Слишком много товаров: достигнут лимит безопасности.');
  const names = new Map();
  for (let i = 0; i < all.length; i += 1000) {
    const batch = all.slice(i, i + 1000);
    const data = await ozon('/v3/product/info/list', {
      product_id: batch.map(x => Number(x.product_id))
    });
    for (const item of data.items || []) {
      names.set(String(item.id ?? item.product_id), {
        name: String(item.name || ''),
        offer_id: String(item.offer_id || '')
      });
    }
  }
  return all.map(item => ({
    ...item,
    name: names.get(item.product_id)?.name || '',
    offer_id: names.get(item.product_id)?.offer_id || item.offer_id
  }));
}

if (!CLIENT_ID || !API_KEY || !ACCESS_TOKEN) {
  console.error('Missing required environment variables: OZON_CLIENT_ID, OZON_API_KEY, APP_ACCESS_TOKEN');
  process.exit(1);
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const allowed = !origin || origin === ORIGIN;
  // Only log request method, path and origin. Never log passwords or API keys.
  console.log('[request]', req.method, req.url, 'origin:', origin || '(none)',
    'allowed:', allowed);
  if (!allowed) return reply(res, 403, { error: 'Origin not allowed' }, ORIGIN);

  // Explicit CORS preflight handling for Safari and other browsers.
  if (req.method === 'OPTIONS') {
    if (req.url !== '/api/products' && req.url !== '/health') {
      return reply(res, 404, { error: 'Not found' }, ORIGIN);
    }
    res.writeHead(204, { ...cors(ORIGIN), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.url === '/health' && req.method === 'GET') {
    return reply(res, 200, { status: 'ok' }, ORIGIN);
  }
  if (req.url !== '/api/products' || req.method !== 'GET') {
    return reply(res, 404, { error: 'Not found' }, ORIGIN);
  }
  if (!authorized(req)) return reply(res, 401, { error: 'Unauthorized' }, ORIGIN);
  try {
    const items = await products();
    return reply(res, 200, { count: items.length, items }, ORIGIN);
  } catch (error) {
    console.error('Product import failed:', error.message);
    return reply(res, 502, {
      error: 'Не удалось загрузить товары из Ozon. Проверьте права ключа и журнал сервера.'
    }, ORIGIN);
  }
});
server.listen(PORT, '0.0.0.0', () =>
  console.log('Ozon read-only API server listening on port ' + PORT));
