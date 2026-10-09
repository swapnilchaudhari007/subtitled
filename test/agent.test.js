// Runs the whole agent against a fake Qloo so we can test the retry logic
// without spending real quota. `npm test`

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
const calls = [];

const ent = (id, name, type, tags = [], extra = {}) => ({
  entity_id: id, name, type, popularity: 0.8,
  properties: { release_year: 2010, short_description: `${name} description` },
  tags: tags.map(t => ({ id: `urn:tag:keyword:${t}`, name: t, type: 'urn:tag:keyword' })),
  ...extra,
});

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = Object.fromEntries(url.searchParams);
    calls.push({ path: url.pathname, p });
    const send = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

    if (url.pathname === '/search') {
      const q = p.query.toLowerCase();
      if (q.includes('nothing')) return send({ results: [] });
      return send({ results: [ent(`id-${q}`, p.query, 'urn:entity:tv_show', ['dark humor', 'crime'])] });
    }
    if (url.pathname === '/entities') {
      return send({ results: p.entity_ids.split(',').map(id => ent(id, id.replace('id-', ''), 'urn:entity:tv_show', ['dark humor', 'crime', 'slow burn'])) });
    }
    if (url.pathname === '/v2/tags') {
      const q = p['filter.query'];
      return send({ results: { tags: [{ id: `urn:tag:genre:music:${q}`, name: q, type: 'urn:tag:genre:music' }] } });
    }
    if (url.pathname === '/v2/insights') {
      const type = p['filter.type'];
      // pretend country *names* don't work, only ISO codes - the agent should figure that out
      if ((type.endsWith('movie') || type.endsWith('tv_show')) && !/^[A-Z]{2}(,|$)/.test(p['filter.release_country'] || '')) {
        return send({ results: { entities: [] } });
      }
      // pretend popularity-filtered artist calls are empty, to exercise the loosening step
      if (type.endsWith('artist') && p['filter.popularity.min']) return send({ results: { entities: [] } });
      return send({ results: { entities: [
        ent(`${type}-1`, `Pick one ${type}`, type, ['dark humor'], { query: { affinity: 0.91 } }),
        ent(`${type}-2`, `Pick two ${type}`, type, ['crime']),
      ] } });
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => server.listen(0, r));
  process.env.QLOO_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.QLOO_API_KEY = 'test';
  delete process.env.GEMINI_API_KEY;
});

after(() => server.close());

test('builds a plan, learns the country format, and loosens filters when empty', async () => {
  const { runAgent } = await import('../lib/agent.js');
  const events = [];
  const plan = await runAgent({ favourites: ['Breaking Bad', 'Fargo', 'nothing at all'], language: 'ja', level: 'beginner', city: 'Mumbai' }, e => events.push(e));

  assert.equal(plan.language, 'Japanese');
  assert.equal(plan.favourites.length, 2, 'unknown favourite is dropped');
  assert.ok(plan.notes.some(n => n.includes('nothing at all')), 'and the agent says so');
  assert.ok(plan.weeks.length >= 4);
  assert.ok(plan.fingerprint.some(t => t.name === 'dark humor' && t.count === 2));

  const movieCalls = calls.filter(c => c.path === '/v2/insights' && c.p['filter.type'] === 'urn:entity:movie');
  assert.ok(movieCalls.some(c => c.p['filter.release_country'] === 'JP'), 'fell back to ISO code');

  const firstItem = plan.weeks[0].items[0];
  assert.equal(firstItem.match, 91);
  assert.deepEqual(firstItem.shared, ['dark humor']);

  assert.ok(events.filter(e => e.type === 'step' && e.status === 'done').length >= 6);
});

test('rejects fewer than two favourites', async () => {
  const { runAgent } = await import('../lib/agent.js');
  await assert.rejects(runAgent({ favourites: ['Dune'], language: 'ja', level: 'beginner' }, () => {}), /at least two/);
});
