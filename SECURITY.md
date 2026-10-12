# Security Policy

## Supported versions

Only the latest code on `main` is supported.

## Reporting a vulnerability

**Please don't open a public issue.** Use the repo's **Security** tab → **Report a vulnerability**, or contact [@swapnilchaudhari007](https://github.com/swapnilchaudhari007).

Include a description, the impact, steps to reproduce and any suggested fix. You'll get an acknowledgement within 72 hours and an initial assessment within 7 days. Reporters are credited unless they'd rather stay anonymous.

## What we especially care about in Subtitled

- **API key exposure:** Qloo or LLM provider keys leaking into the client bundle, logs or responses
- **Prompt injection:** taste inputs (titles, artists, places) crafted to change the agent's instructions
- **Unsafe output:** generated plans that link to or recommend inappropriate content
- **Server abuse:** endpoints that can be used to run up API costs without limits

## For contributors

- Never commit secrets: use `.env` files (git-ignored) or GitHub Actions secrets
- Keep real personal data out of code, tests, issues and screenshots
- Treat all user input, and anything passed to an AI model, as untrusted
