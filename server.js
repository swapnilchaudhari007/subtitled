// Subtitled - plain Node server, no framework.
// Serves the static app and two API routes. The Qloo key never leaves this process.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from './lib/agent.js';
import { searchEntities, hasKey, qlooGet } from './lib/qloo.js';
import { LANGUAGES, LEVELS } from './lib/languages.js';

const PORT = process.env.PORT || 3000;
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// very small per-IP limiter so one person can't burn the whole Qloo quota
const hits = new Map();
function limited(ip, max = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('too big');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, qloo: hasKey(), llm: Boolean(process.env.GEMINI_API_KEY) });
    }

    // quick check that every Qloo endpoint we depend on answers the way we expect
    if (url.pathname === '/api/selftest') {
      if (limited(ip + ':t', 10)) return json(res, 429, { error: 'Slow down a little' });
      const probe = async (path, params) => {
        try {
          const body = await qlooGet(path, params);
          return { ok: true, sample: JSON.stringify(body).slice(0, 700) };
        } catch (err) {
          return { ok: false, status: err.status, body: JSON.stringify(err.body || err.message).slice(0, 400) };
        }
      };
      const q = url.searchParams.get('q') || 'Breaking Bad';
      const out = {};
      out.searchTyped = await probe('/search', { query: q, types: 'urn:entity:movie,urn:entity:tv_show', take: 2 });
      out.searchPlain = await probe('/search', { query: q, take: 2 });
      out.tags = await probe('/v2/tags', { 'filter.query': 'j-pop', take: 3 });
      const id = (out.searchPlain.sample || out.searchTyped.sample || '').match(/"entity_id":"([^"]+)"/)?.[1];
      if (id) {
        out.entities = await probe('/entities', { entity_ids: id });
        out.movieJapan = await probe('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': id, 'filter.release_country': 'Japan', take: 2 });
        out.movieJP = await probe('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': id, 'filter.release_country': 'JP', take: 2 });
      }
      return json(res, 200, out);
    }

    if (url.pathname === '/api/options') {
      return json(res, 200, {
        languages: Object.entries(LANGUAGES).map(([code, l]) => ({ code, name: l.name, hello: l.hello })),
        levels: Object.entries(LEVELS).map(([code, l]) => ({ code, label: l.label })),
      });
    }

    // autocomplete for the favourites box
    if (url.pathname === '/api/suggest') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 200, { results: [] });
      if (limited(ip + ':s', 200)) return json(res, 429, { error: 'Slow down a little' });
      const results = await searchEntities(q, 'urn:entity:movie,urn:entity:tv_show,urn:entity:artist,urn:entity:book,urn:entity:podcast,urn:entity:video_game', 6);
      return json(res, 200, { results: results.map(r => ({ name: r.name, type: r.type.replace('urn:entity:', ''), year: r.year, image: r.image })) });
    }

    if (url.pathname === '/api/plan' && req.method === 'POST') {
      if (limited(ip)) return json(res, 429, { error: 'You\'ve made a lot of plans in the last few minutes. Try again shortly.' });
      const body = await readBody(req);

      // stream newline-delimited JSON so the UI can show each agent step live
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      const emit = obj => res.write(JSON.stringify(obj) + '\n');
      try {
        const plan = await runAgent({
          favourites: body.favourites,
          language: body.language,
          level: body.level,
          city: (body.city || '').slice(0, 60).trim() || null,
        }, emit);
        emit({ type: 'plan', plan });
      } catch (err) {
        console.error('[plan]', err.message, err.body ? JSON.stringify(err.body).slice(0, 300) : '');
        emit({ type: 'error', message: err.message });
      }
      return res.end();
    }

    // static files
    let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || !extname(path)) path = '/index.html';
    const file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'nope' });
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=300' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') return json(res, 404, { error: 'Not found' });
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Something broke on our side' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Subtitled running on http://localhost:${PORT}`);
  if (!hasKey()) console.warn('Heads up: QLOO_API_KEY is not set, plans will fail until it is.');
});
