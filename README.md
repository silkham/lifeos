# LifeOS

The cross-app hub for my four life PWAs (Strive · Lexie & Me · Household · Investing).
One screen: **what do I need to do today, and what's coming that I haven't planned yet.**

Each source app publishes a small set of *signals* (metrics · tasks · nudges) into a shared
`lifeos.signals` table; this app merges and renders them. It owns no domain data — the CTA on
each item deep-links back into the source app, which stays the source of truth.

- Vanilla JS ES modules, no build step. Supabase for storage + auth. GitHub Pages.
- See `CLAUDE.md` for architecture (two Supabase projects, the signal contract, adapters).

Run locally: `python3 -m http.server 5174` then open http://localhost:5174.
