# AlwaysMemo analytics (Cloudflare Workers + D1)

This receiver stores only the allowlisted v1 events. It rejects unknown event
names and fields, including memo content, file names, file paths, window titles,
raw errors, and account or hardware identifiers. D1 deduplicates by event ID.
The scheduled handler deletes raw rows after 90 days.

## Release order

1. Publish the revised privacy policy. The current public policy says that no
   usage analytics are collected, so the app must not be released first.
2. Create a D1 database with `npx wrangler d1 create alwaysmemo-analytics`.
3. Copy `wrangler.jsonc.example` to `wrangler.jsonc` and replace only
   `<D1_DATABASE_ID>` with the returned ID. Do not add client secrets.
4. Apply the schema:
   `npx wrangler d1 migrations apply alwaysmemo-analytics --remote`.
5. Deploy from this directory with `npx wrangler deploy`. Record the exact
   `https://alwaysmemo-analytics.<account>.workers.dev/v1/events` URL.
6. Send one `environment: "test"` event, then verify it with:
   `npx wrangler d1 execute alwaysmemo-analytics --remote --command
   "SELECT event_name, environment FROM analytics_events ORDER BY received_at DESC LIMIT 5"`.
7. Set `VITE_ANALYTICS_ENDPOINT` to that exact URL and
   `VITE_ANALYTICS_ENV=production` for the Store build. Add that one origin to
   Tauri's `connect-src`; do not use a `*.workers.dev` wildcard.
8. Run `npm run test:analytics`, `npm run build`, and `cargo test`, then
   perform the consent/offline/IME/file-operation manual checks before release.

The Cloudflare dashboard is sufficient for Worker health and request errors.
A custom dashboard is not needed at this scale: run `queries/report.sql` in
the D1 console (or through `wrangler d1 execute`) and export results when
needed.

## Definitions and caveats

- User/device: one random installation ID created only after opt-in. It is
  pseudonymous, not fully anonymous, and is deleted locally when collection is
  disabled.
- Session: the shared installation session continues until 30 minutes without
  a recorded event. Settings and memo windows share the same ID and session.
- Participant: a distinct installation with a production event in the period.
- Initial reach: events within 24 hours after `analytics_enabled`; existing
  users are marked `preexisting`, otherwise installation status is `unknown`.
- W2 and W4: activity on days 8-14 and 22-28 after opt-in. Incomplete cohorts
  are excluded, never counted as zero-retention users.
- No edit event means only that no edit was observed; read-only use remains
  valid usage.
- Opt-out/deferred users produce no event. Compare opt-in participants with
  Store install counts separately and report this consent bias alongside every
  product conclusion.
- Store metrics and these pseudonymous event metrics have different
  definitions and should not be expected to match.

At the August 2026 scale (96 Store MAU and 1,290 sessions), the Workers and D1
free allowances are ample. The likely cost is $0/month. If paid Workers becomes
necessary, budget the plan minimum (currently about US$5/month) plus any D1
storage overage; confirm current Cloudflare prices before enabling billing.
