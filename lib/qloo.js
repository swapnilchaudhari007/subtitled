// Small Qloo client. Everything goes through here so we get one place
// for the key, a cache, and sane error messages.

const BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const TTL_MS = 1000 * 60 * 60 * 6; // 6h is plenty for a demo, taste data doesn't move that fast

const cache = new Map();

export class QlooError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function hasKey() {
  return Boolean(process.env.QLOO_API_KEY);
}

function toQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return qs.toString();
}

export async function qlooGet(path, params = {}) {
  if (!hasKey()) throw new QlooError('QLOO_API_KEY is not set on the server', 500);

  const url = `${BASE}${path}?${toQuery(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  let lastErr;
  // two tries max - if Qloo is rate limiting us, hammering it won't help
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'X-Api-Key': process.env.QLOO_API_KEY, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }

      if (!res.ok) {
        // 400s are usually "no valid signal" or an unknown param - not worth retrying
        if (res.status < 500 && res.status !== 429) {
          throw new QlooError(`Qloo ${res.status} on ${path}`, res.status, body);
        }
        lastErr = new QlooError(`Qloo ${res.status} on ${path}`, res.status, body);
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      cache.set(url, { at: Date.now(), data: body });
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      return body;
    } catch (err) {
      if (err instanceof QlooError && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---- thin helpers around the endpoints we actually use ----

export async function searchEntities(query, types, take = 5) {
  const data = await qlooGet('/search', { query, types, take });
  return (data.results || []).map(normalizeEntity);
}

export async function getEntities(ids) {
  if (!ids.length) return [];
  const data = await qlooGet('/entities', { entity_ids: ids });
  const list = data.results || data.entities || [];
  return list.map(normalizeEntity);
}

export async function searchTags(query, take = 15) {
  const data = await qlooGet('/v2/tags', { 'filter.query': query, take });
  const tags = data?.results?.tags || data?.results || [];
  return (Array.isArray(tags) ? tags : []).map(t => ({
    id: t.id || t.tag_id,
    name: t.name,
    type: t.type || t.subtype || '',
  })).filter(t => t.id);
}

export async function insights(params) {
  const data = await qlooGet('/v2/insights', params);
  const list = data?.results?.entities || [];
  return list.map(normalizeEntity);
}

export function normalizeEntity(e) {
  const p = e.properties || {};
  const img = p.image?.url || p.images?.[0]?.url || null;
  return {
    id: e.entity_id || e.id,
    name: e.name,
    type: e.type || (e.types && e.types[0]) || '',
    subtype: e.subtype || '',
    year: p.release_year || p.publication_year || null,
    description: p.short_description || p.description || '',
    image: img,
    popularity: typeof e.popularity === 'number' ? e.popularity : null,
    affinity: e.query?.affinity ?? null,
    tags: (e.tags || []).map(t => ({ id: t.id || t.tag_id, name: t.name, type: t.type || '' })),
    address: p.address || null,
    externalUrl: p.websites?.[0] || p.website || null,
  };
}
