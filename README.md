# NEON TRIAL

NEON TRIAL is a mobile-first, individual precision platformer built with Next.js, TypeScript and Phaser 3. Each player runs their own attempt; the online leaderboard is global and does not use rooms or synchronized multiplayer.

## Current delivery

The repository started empty. The first delivery includes a hand-built four-zone course, keyboard and multitouch controls, variable jump height, coyote time, jump buffering, wall jump, dash, attackable targets, crystals, checkpoints, hazards, deaths and completion scoring.

The Supabase integration and versioned migration are included. Without project credentials, play remains local and scores are not confirmed or persisted. When configured, anonymous identities claim server-validated nicknames, attempts receive server IDs, score events are checked by a transaction, and the global ranking reads one best record per player. Event validation blocks simple duplication and impossible reward IDs, but device-side physics cannot prove a run came from an unmodified client.

## Requirements and local run

- Node.js 20.9 or newer
- npm

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. Use arrow keys or A/D to move, Space/W/Up to jump, Shift/C to dash, and X to attack. On a touch screen, press the on-screen controls; multiple buttons can be held at once. The game requests landscape orientation where the browser supports it and shows a rotate prompt otherwise.

## Verification

```sh
npm test
npm run lint
npm run build
```

The automated tests cover reward de-duplication, the score floor, simultaneous inputs and input cancellation. They do not replace playtesting on physical mobile devices.

## Publish with GitHub and Vercel

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml`. It runs lint, tests, TypeScript checks and a production build for pull requests and pushes to `main` or `master`.

1. Push this project to a GitHub repository using the `main` branch.
2. Import that repository into Vercel and keep the detected Next.js build settings.
3. To enable the online leaderboard, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Vercel project's Production and Preview environments, then apply the Supabase migration below.

The site can deploy without Supabase, but profiles and scores stay local and the online ranking is unavailable. Do not add a Supabase service-role key to Vercel's browser environment or to this repository.

## Supabase setup (leaderboard work in progress)

1. Create a Supabase project and copy its Project URL and publishable/anon key into `.env.local` using the names in `.env.example`.
2. Enable anonymous sign-ins in the Supabase Dashboard under **Authentication → Sign In / Providers → Anonymous**.
3. Apply `supabase/migrations/202610150001_neon_trial_leaderboard.sql` with the Supabase SQL editor or Supabase CLI.
4. Restart the Next.js development server after changing environment variables.

The API routes are `/api/profile`, `/api/attempt`, `/api/attempt/submit` and `/api/ranking`. The SQL functions enforce identity ownership, one-time event IDs, event bounds, score reconstruction, completion requirements, and an atomic best-score upsert. Ranking ties share the same position and are listed in stable player-ID order. Public ranking responses do not expose player IDs or attempt metadata.

Only the public project URL and anon key belong in browser configuration. A service role key is not used by this implementation and must not be added. Until a real project is configured, the app reports the ranking as unavailable.

## PWA

The app includes a web manifest, a project icon and a service worker. It caches the app shell and static assets; API calls and ranking responses are not cached. Landscape orientation is requested only where the browser supports locking, with a rotate prompt as fallback. Sound effects are synthesized with Web Audio after the player starts, with a volume control; vibration is optional and opt-in.

## Known limits

- The platform physics run on the player's device. Client-side event reporting cannot prove a run was legitimate; server validation checks attempt ownership, duplicate event IDs, reward IDs, progression thresholds, time bounds and score totals, but a modified client can still falsify a plausible event stream.
- Anonymous identity depends on the browser session. Clearing browser data or losing that session can make the profile and record inaccessible; there is no account recovery in the MVP.
- The nickname is reserved and checked for uniqueness only when Supabase is configured and reachable. The server-side profanity blocklist is intentionally limited and is not a moderation system.
- Database migrations and RLS policies are included but have not been applied to a live Supabase project in this workspace. Verify the anonymous provider and SQL function grants after applying them.
- A result from a server-created attempt is held in a small local pending queue if the submission request loses its connection; the app retries when it comes back online. Runs that never received a server attempt ID cannot be submitted later.
- Test on physical landscape-oriented phones before tuning final movement values and touch placement.
