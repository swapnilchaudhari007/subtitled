# Subtitled

**Learn a language through things you'd actually watch, play and listen to.**

Every "learn Japanese with anime" list gives everyone the same five titles. I tried that. I got bored of Spirited Away the third time and dropped it. The stuff that stuck was whatever happened to be close to what I already liked.

Subtitled does that on purpose. You tell it two to six things you love — in any language, any medium — plus the language you're learning and your level. An agent then uses [Qloo](https://www.qloo.com)'s taste graph to find films, series, artists, books, podcasts and even restaurants *in that language* that sit close to your taste, and lays them out as a four-week plan.

**Live demo:** https://subtitled.onrender.com
*(free hosting, so the first load after a quiet spell can take ~30 seconds)*

## What it does

1. **Reads your taste.** Each favourite is looked up with Qloo's `/search`, then the agent pulls their tags from `/entities` and keeps the ones they share. "Dark humour, slow burn, antihero" says far more than "drama".
2. **Crosses the language line.** For films and series it calls `/v2/insights` with `filter.release_country`. For music, books and podcasts it first finds the right language tags with `/v2/tags` (j-pop, japanese literature, …) and uses them as `filter.tags`. Every call is seeded with your favourites through `signal.interests.entities`, so results are ranked by affinity to *you*.
3. **Checks its own work and retries.** If Qloo comes back empty, the agent loosens popularity, tries a different country format, or turns the language tag from a hard filter into a soft signal — and then throws away anything that drifted back into English. Each step streams to the page so you can see what it did.
4. **Builds a plan for your level.** Beginners start with music and familiar-genre films. Intermediate learners switch to target-language subtitles and podcasts. Advanced learners get books and native-speed audio. If you give a city, the last week sends you to a restaurant to order in the language.
5. **Explains every pick.** Each card shows the Qloo affinity score and which of your taste tags it shares.

Next to your plan it shows "what everyone else gets told" — the generic list — so the difference is obvious.

## Why Qloo matters here

Without Qloo this app is a listicle. An LLM alone will happily recommend the same famous titles to everyone, and it has no idea that someone who loves *Breaking Bad* and *Arctic Monkeys* might be better served by a Japanese crime series and a Japanese indie rock band than by a Ghibli film. The cross-domain taste graph is the whole product.

## Run it yourself

Needs Node 20+ and a Qloo hackathon API key. There are no npm dependencies.

```bash
git clone https://github.com/Swapnilchaudhari007/subtitled
cd subtitled
cp .env.example .env      # put your QLOO_API_KEY in here
npm run dev               # http://localhost:3000
npm test                  # runs the agent against a fake Qloo
```

`GEMINI_API_KEY` is optional. If you set it, the short coaching note is written by Gemini, which is given only the titles Qloo returned and told not to add any. Without it, a template writes the note and everything else works the same.

### Deploy on Render

The repo has a `render.yaml`. New → Blueprint → pick this repo → paste `QLOO_API_KEY` when asked. That's it.

## Project layout

```
server.js          plain node:http server, static files + 4 API routes
lib/agent.js       the agent: resolve → fingerprint → find tags → recommend (with retries) → plan
lib/qloo.js        Qloo client with caching and error handling
lib/languages.js   per-language settings (countries, tag search words, cuisine)
lib/coach.js       coaching note (Gemini if available, template otherwise)
public/            the front end, vanilla JS, no build step
test/              agent test against a mock Qloo server
```

## API routes

| Route | What it does |
| --- | --- |
| `POST /api/plan` | Runs the agent. Streams NDJSON: `step` events, then one `plan` event |
| `GET /api/suggest?q=` | Autocomplete for the favourites box (Qloo `/search`) |
| `GET /api/options` | Languages and levels |
| `GET /api/health` | Whether the server has its keys |

## Limits, honestly

- Qloo describes what *audiences* who like X also like. It's a strong hint about what you'll enjoy, not a promise.
- Some languages have thinner data for some media (podcasts especially). When that happens the plan says so instead of padding it.
- "Released in Japan" doesn't always mean "in Japanese" — co-productions slip through now and then.
- No accounts, no tracking. Your favourites are only used for the request you make. Qloo responses are cached in memory on the server and never written to this repo.

## Built with

Node.js, Qloo Insights / Search / Tags APIs, optional Gemini, Render.

Made by [Swapnil Chaudhari](https://github.com/Swapnilchaudhari007) for the Qloo Agentic Hackathon 2026. MIT licensed.
