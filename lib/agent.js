// The Subtitled agent.
//
// It's a small plan -> act -> check -> retry loop. Each "tool" is a Qloo call.
// The agent decides which calls to make based on the learner's level, checks
// whether the answer is actually usable (non-empty, in the right language,
// not just the stuff they already love), and loosens its own filters when
// Qloo comes back empty. Every decision is streamed to the UI as a step so
// the learner can see why they got what they got.

import { searchEntities, getEntities, searchTags, insights, QlooError } from './qloo.js';
import { LANGUAGES, LEVELS } from './languages.js';
import { writeCoachNotes } from './coach.js';

const SEARCH_TYPES = [
  'urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:artist',
  'urn:entity:book', 'urn:entity:podcast', 'urn:entity:video_game',
].join(',');

// Tags that say nothing about taste. Everyone's favourite film is "drama".
const BORING_TAGS = new Set([
  'drama', 'comedy', 'fiction', 'pop', 'rock', 'music', 'film', 'movie', 'book',
  'english', 'american', 'united states', 'usa', 'hollywood', 'novel', 'tv', 'series',
]);

// countries format that worked last time, per language - saves a round trip
const countryMemo = new Map();

export async function runAgent(input, emit) {
  const lang = LANGUAGES[input.language];
  const level = LEVELS[input.level] || LEVELS.beginner;
  if (!lang) throw new Error('Unknown language');

  const favourites = (input.favourites || []).map(s => String(s).trim()).filter(Boolean).slice(0, 6);
  if (favourites.length < 2) throw new Error('Give me at least two things you love');

  const step = makeStepper(emit);
  const notes = []; // things the agent wants to be honest about at the end

  // 1. Figure out what "Breaking Bad" actually is in Qloo's world
  let s = step('resolve', `Looking up your ${favourites.length} favourites in Qloo`);
  const resolved = [];
  for (const name of favourites) {
    try {
      const hits = await searchEntities(name, SEARCH_TYPES, 3);
      if (hits.length) {
        resolved.push({ asked: name, match: hits[0], alternatives: hits.slice(1) });
      } else {
        notes.push(`Couldn't find "${name}" in Qloo, so it's not part of your taste profile.`);
      }
    } catch (err) {
      notes.push(`Lookup for "${name}" failed (${err.message}).`);
    }
  }
  s.done(resolved.map(r => `${r.asked} → ${r.match.name} (${prettyType(r.match.type)})`).join(' · ') || 'nothing matched');
  if (!resolved.length) throw new Error("Qloo didn't recognise any of those. Try full titles, like \"Breaking Bad\" or \"Arctic Monkeys\".");

  const seedIds = resolved.map(r => r.match.id);
  const seedNames = new Set(resolved.map(r => r.match.name.toLowerCase()));

  // 2. Build a taste fingerprint from the tags those favourites share
  s = step('fingerprint', 'Working out what your favourites have in common');
  let seedEntities = [];
  try { seedEntities = await getEntities(seedIds); } catch { /* fall back to search payloads */ }
  if (!seedEntities.some(e => e.tags.length)) seedEntities = resolved.map(r => r.match);
  const fingerprint = buildFingerprint(seedEntities);
  s.done(fingerprint.length ? fingerprint.slice(0, 8).map(t => t.name).join(', ') : 'tags were thin, leaning on the titles themselves');

  // 3. Find the tag IDs that mean "this is in Japanese" (or whatever) for each medium
  s = step('lang-tags', `Finding Qloo tags that mark ${lang.name}-language music, books and podcasts`);
  const langTags = {
    artist: await findTags(lang.music, ['music', 'artist', 'genre']),
    book: await findTags(lang.books, ['book', 'literature', 'genre']),
    podcast: await findTags(lang.podcasts, ['podcast', 'genre']),
    place: await findTags(lang.cuisine, ['restaurant', 'cuisine', 'place']),
  };
  s.done(Object.entries(langTags).map(([k, v]) => `${prettyType(k)}: ${v.map(t => t.name).slice(0, 3).join(', ') || '—'}`).join(' · '));

  // 4. Ask Qloo for each medium, in the order this level should meet them
  const wanted = [...new Set([...level.order, 'artist', 'movie', 'tv_show', 'book', 'podcast'])];
  if (input.city) wanted.push('place');

  const shelves = {};
  for (const kind of new Set(wanted)) {
    if (kind === 'place' && !input.city) continue;
    s = step(`rec-${kind}`, recLabel(kind, lang, input.city));
    try {
      const { items, how } = await recommend(kind, { lang, level, seedIds, langTags, city: input.city, input });
      const clean = items
        .filter(it => !seedNames.has(String(it.name).toLowerCase()))
        .map(it => explain(it, fingerprint, langTags[kind]))
        .slice(0, level.take);
      shelves[kind] = clean;
      s.done(clean.length ? `${clean.length} picks (${how})` : `nothing usable (${how})`);
      if (!clean.length) notes.push(`Qloo had nothing solid for ${prettyType(kind).toLowerCase()} here, so that part of the plan is lighter.`);
    } catch (err) {
      s.fail(err instanceof QlooError ? `Qloo said ${err.status}` : err.message);
      shelves[kind] = [];
    }
  }

  // 5. Turn the shelves into a 4-week ladder
  s = step('plan', 'Laying it out as a 4-week ladder');
  const weeks = buildLadder(shelves, level, lang, input);
  s.done(weeks.map(w => w.title).join(' → '));

  // 6. Optional: let an LLM write the coaching notes, grounded only in what Qloo returned
  s = step('coach', 'Writing your coaching notes');
  const coach = await writeCoachNotes({ lang, level, favourites: resolved.map(r => r.match.name), fingerprint, weeks });
  s.done(coach.source === 'llm' ? 'written by the LLM from Qloo results only' : 'written from templates (no LLM key set)');

  return {
    language: lang.name,
    hello: lang.hello,
    level: level.label,
    favourites: resolved.map(r => ({ asked: r.asked, ...pick(r.match) })),
    fingerprint: fingerprint.slice(0, 10),
    weeks,
    coach: coach.text,
    usual: lang.usual,
    notes,
  };
}

// ---------------------------------------------------------------------------

async function recommend(kind, ctx) {
  const { lang, level, seedIds, langTags, city } = ctx;
  const type = `urn:entity:${kind}`;
  const base = {
    'filter.type': type,
    'signal.interests.entities': seedIds.join(','),
    take: 10,
  };
  const pop = level.popMin > 0 ? { 'filter.popularity.min': level.popMin } : {};

  // Each kind has a list of attempts, strictest first. First non-empty wins.
  const attempts = [];

  if (kind === 'movie' || kind === 'tv_show') {
    const memo = countryMemo.get(lang.name);
    const variants = memo ? [memo, ...lang.countries.filter(c => c !== memo)] : lang.countries;
    for (const countries of variants) {
      attempts.push({ how: `released in ${countries.join('/')}`, countries, params: { ...base, ...pop, 'filter.release_country': countries.join(',') } });
    }
    for (const countries of variants) {
      attempts.push({ how: `released in ${countries.join('/')}, any popularity`, countries, params: { ...base, 'filter.release_country': countries.join(',') } });
    }
  } else if (kind === 'place') {
    const tagIds = langTags.place.map(t => t.id).join(',');
    if (tagIds) {
      attempts.push({ how: `${lang.name} food in ${city}, matched to your taste`, params: { ...base, 'filter.location.query': city, 'filter.tags': tagIds } });
    }
    attempts.push({ how: `${lang.name} food in ${city}`, params: { 'filter.type': type, 'filter.location.query': city, 'filter.tags': tagIds || undefined, take: 10 } });
  } else {
    const tagIds = langTags[kind].map(t => t.id).join(',');
    if (tagIds) {
      attempts.push({ how: `tagged ${langTags[kind].map(t => t.name).slice(0, 2).join('/')}, matched to your taste`, params: { ...base, ...pop, 'filter.tags': tagIds } });
      attempts.push({ how: `tagged ${langTags[kind].map(t => t.name).slice(0, 2).join('/')}, any popularity`, params: { ...base, 'filter.tags': tagIds } });
      // last resort: use the language tags as a signal rather than a hard filter
      attempts.push({ how: 'language as a soft signal', soft: true, params: { ...base, 'signal.interests.tags': tagIds } });
    }
  }

  for (const a of attempts) {
    let items = [];
    try {
      items = await insights(a.params);
    } catch (err) {
      // a 400 here usually means a filter value Qloo doesn't accept; try the next shape
      if (err instanceof QlooError && err.status === 400) continue;
      throw err;
    }
    if (a.soft) {
      // soft mode can drift back to English stuff - keep only items that carry a language tag
      const ids = new Set(langTags[kind].map(t => t.id));
      items = items.filter(it => it.tags.some(t => ids.has(t.id)));
    }
    if (items.length) {
      if (a.countries) countryMemo.set(lang.name, a.countries);
      return { items, how: a.how };
    }
  }
  return { items: [], how: 'every filter combination came back empty' };
}

async function findTags(queries, hints) {
  const found = new Map();
  for (const q of queries) {
    let tags = [];
    try { tags = await searchTags(q, 10); } catch { continue; }
    for (const t of tags) {
      const hay = `${t.id} ${t.type}`.toLowerCase();
      const nameHit = t.name && t.name.toLowerCase().includes(q.split(' ')[0]);
      if (nameHit && hints.some(h => hay.includes(h))) found.set(t.id, t);
    }
    if (found.size >= 4) break;
  }
  // If the category hint was too strict, fall back to any tag whose name matches
  if (!found.size) {
    for (const q of queries.slice(0, 2)) {
      try {
        for (const t of await searchTags(q, 5)) if (t.name?.toLowerCase().includes(q.split(' ')[0])) found.set(t.id, t);
      } catch { /* ignore */ }
    }
  }
  return [...found.values()].slice(0, 4);
}

function buildFingerprint(entities) {
  const counts = new Map();
  for (const e of entities) {
    const seen = new Set();
    for (const t of e.tags || []) {
      const key = (t.name || '').toLowerCase();
      if (!key || BORING_TAGS.has(key) || seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key) || { id: t.id, name: t.name, count: 0, from: [] };
      prev.count++;
      prev.from.push(e.name);
      counts.set(key, prev);
    }
  }
  // tags shared by 2+ favourites first, then the rest
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 15);
}

function explain(item, fingerprint, langTags = []) {
  const itemTags = new Set(item.tags.map(t => (t.name || '').toLowerCase()));
  const shared = fingerprint.filter(f => itemTags.has(f.name.toLowerCase())).map(f => f.name).slice(0, 3);
  const langIds = new Set(langTags.map(t => t.id));
  return {
    ...pick(item),
    shared,
    langVerified: item.tags.some(t => langIds.has(t.id)),
    match: item.affinity != null ? Math.round(item.affinity * 100) : null,
  };
}

function buildLadder(shelves, level, lang, input) {
  const take = (kind, n) => (shelves[kind] || []).splice(0, n);
  const L = input.level;

  const weeks = [];
  if (L === 'beginner') {
    weeks.push(week(1, 'Get the sound in your ears', 'Put these artists on while you commute or cook. Don\'t study the lyrics yet - just let the rhythm of the language become familiar.', take('artist', 3)));
    weeks.push(week(2, 'Watch something you\'d pick anyway', `Watch with ${lang.name} audio and English subtitles. These films are close to your taste, so you'll stay for the story even when the words lose you.`, take('movie', 3)));
    weeks.push(week(3, 'One episode a day', 'Short episodes, same characters every day. Repetition is the whole trick. Pause and repeat one line per episode out loud.', take('tv_show', 3)));
    weeks.push(week(4, 'Take it outside', input.city ? `Go eat at one of these and order in ${lang.name}. Even "${lang.hello}" and a thank-you counts.` : 'Go back to your favourite pick from weeks 1-3 and try it without subtitles for 10 minutes.', input.city ? take('place', 3) : [...take('movie', 1), ...take('artist', 1)]));
  } else if (L === 'intermediate') {
    weeks.push(week(1, 'Binge, but in the target language', `Switch subtitles to ${lang.name} for these. You'll understand less, and that's fine - keep a note of 5 words per episode.`, take('tv_show', 3)));
    weeks.push(week(2, 'Learn the songs properly', 'Pick one song per artist, look up the lyrics, and sing along until you don\'t need the page.', take('artist', 3)));
    const pods = take('podcast', 3);
    weeks.push(pods.length
      ? week(3, 'Listen to people talk', 'Podcasts are where you hear real speed and real slang. 15 minutes a day, 1.0x speed, no transcript.', pods)
      : week(3, 'Listen to people talk', 'No podcasts came back, so use films instead: rewatch one scene three times until you catch every word.', take('movie', 3)));
    weeks.push(week(4, 'Film night, no safety net', 'No subtitles at all. Watch the first 20 minutes, then decide if you need them.', [...take('movie', 2), ...take('place', 2)]));
  } else {
    weeks.push(week(1, 'Read something that sounds like you', 'Books in your taste zone. Start with the one you\'re most curious about and read 10 pages a day in the original.', take('book', 3)));
    weeks.push(week(2, 'Native-speed audio', 'Podcasts made for native speakers, not learners. Summarise each episode out loud in two sentences.', take('podcast', 3)));
    weeks.push(week(3, 'Deep-cut cinema', 'Less-known films that sit close to what you already love. Watch, then read a review in the target language.', take('movie', 3)));
    weeks.push(week(4, 'A series to live in', 'Pick one and finish it. By the end you\'ll have the characters\' voices in your head.', [...take('tv_show', 3), ...take('place', 2)]));
  }

  // Anything that didn't fit goes into a "bonus" shelf rather than being thrown away
  const extras = Object.values(shelves).flat().slice(0, 6);
  if (extras.length) weeks.push(week(5, 'If you want more', 'Spares the agent found. Same taste logic, didn\'t fit the schedule.', extras));

  return weeks.filter(w => w.items.length);
}

function week(n, title, how, items) {
  return { n, title, how, items: items || [] };
}

function pick(e) {
  return {
    id: e.id, name: e.name, type: prettyType(e.type || e.kind), year: e.year,
    description: (e.description || '').slice(0, 220), image: e.image, address: e.address,
    shared: e.shared, langVerified: e.langVerified, match: e.match,
  };
}

function prettyType(t = '') {
  const k = String(t).replace('urn:entity:', '');
  return ({ movie: 'Film', tv_show: 'Series', artist: 'Music', book: 'Book', podcast: 'Podcast', place: 'Place', video_game: 'Game', person: 'Person' })[k] || k;
}

function recLabel(kind, lang, city) {
  return ({
    movie: `Asking Qloo for ${lang.name}-language films that fans of your picks also love`,
    tv_show: `Asking Qloo for ${lang.name} series in your taste zone`,
    artist: `Asking Qloo for ${lang.name}-singing artists you'd actually play`,
    book: `Asking Qloo for ${lang.name} books close to your taste`,
    podcast: `Asking Qloo for ${lang.name} podcasts`,
    place: `Finding ${lang.name} food in ${city} that suits your taste`,
  })[kind];
}

function makeStepper(emit) {
  return (id, title) => {
    const started = Date.now();
    emit({ type: 'step', id, title, status: 'running' });
    return {
      done: detail => emit({ type: 'step', id, title, status: 'done', detail, ms: Date.now() - started }),
      fail: detail => emit({ type: 'step', id, title, status: 'failed', detail, ms: Date.now() - started }),
    };
  };
}
