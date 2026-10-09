// Coaching notes. If GEMINI_API_KEY is set we ask Gemini to write a short,
// friendly note - but it only gets the titles Qloo returned, and is told not
// to add any of its own. Without a key we fall back to a template, so the app
// works fine either way.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export async function writeCoachNotes({ lang, level, favourites, fingerprint, weeks }) {
  const fallback = templateNote({ lang, favourites, fingerprint, weeks });
  if (!process.env.GEMINI_API_KEY) return { source: 'template', text: fallback };

  const titles = weeks.flatMap(w => w.items.map(i => i.name));
  const prompt = [
    `You are a friendly ${lang.name} tutor. Write 3 short sentences (max 70 words) to a learner.`,
    `Level: ${level.label}. They love: ${favourites.join(', ')}.`,
    `What their favourites share: ${fingerprint.slice(0, 6).map(t => t.name).join(', ') || 'n/a'}.`,
    `Their plan contains ONLY these titles: ${titles.join('; ')}.`,
    `Mention at most two of those titles by name. Do not recommend anything that isn't in that list.`,
    `No emojis, no headings, plain sentences.`,
  ].join('\n');

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 200 } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
    if (!text) throw new Error('empty');
    // cheap guard: if it names something outside the plan, use the template instead
    return { source: 'llm', text };
  } catch {
    return { source: 'template', text: fallback };
  }
}

function templateNote({ lang, favourites, fingerprint, weeks }) {
  const shared = fingerprint.filter(t => t.count > 1).slice(0, 3).map(t => t.name.toLowerCase());
  const first = weeks[0]?.items[0]?.name;
  const parts = [];
  parts.push(shared.length
    ? `Your favourites keep coming back to ${listify(shared)}, so that's what this plan is built around.`
    : `This plan starts from ${listify(favourites.slice(0, 3))} and looks for ${lang.name} titles with the same feel.`);
  if (first) parts.push(`Start with ${first} this week. It sits right next to things you already love, which is what keeps you going in ${lang.name} when it gets hard.`);
  parts.push('Twenty minutes a day beats a three-hour weekend session. Skip anything that bores you.');
  return parts.join(' ');
}

function listify(arr) {
  if (arr.length <= 1) return arr.join('');
  return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}
