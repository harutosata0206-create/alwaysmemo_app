-- All metrics exclude development/test events. Change '-30 days' when needed.
-- Participants: pseudonymous installations with at least one event in the period.
SELECT COUNT(DISTINCT installation_id) AS participants_30d
FROM analytics_events
WHERE environment = 'production'
  AND occurred_at >= datetime('now', '-30 days');

-- First-24-hour reach. Denominator: installations that opted in during the period.
WITH cohort AS (
  SELECT installation_id, MIN(occurred_at) AS opted_at
  FROM analytics_events
  WHERE environment = 'production'
    AND event_name = 'analytics_enabled'
    AND occurred_at >= datetime('now', '-30 days')
  GROUP BY installation_id
),
reach AS (
  SELECT c.installation_id,
    MAX(e.event_name = 'memo_first_edited') AS edited,
    MAX(e.event_name = 'core_action_succeeded'
        AND json_extract(e.properties_json, '$.context') = 'normal') AS used_core
  FROM cohort c
  LEFT JOIN analytics_events e
    ON e.installation_id = c.installation_id
   AND e.environment = 'production'
   AND e.occurred_at >= c.opted_at
   AND e.occurred_at < datetime(c.opted_at, '+1 day')
  GROUP BY c.installation_id
)
SELECT COUNT(*) AS opted_in,
  SUM(edited) AS edited,
  ROUND(100.0 * SUM(edited) / NULLIF(COUNT(*), 0), 1) AS edit_reach_pct,
  SUM(used_core) AS used_core,
  ROUND(100.0 * SUM(used_core) / NULLIF(COUNT(*), 0), 1) AS core_reach_pct
FROM reach;

-- Onboarding outcome. Denominator: installations that saw onboarding.
WITH shown AS (
  SELECT installation_id, MIN(occurred_at) AS shown_at
  FROM analytics_events
  WHERE environment = 'production'
    AND event_name = 'onboarding_event'
    AND json_extract(properties_json, '$.action') = 'shown'
    AND occurred_at >= datetime('now', '-30 days')
  GROUP BY installation_id
),
outcomes AS (
  SELECT s.installation_id, s.shown_at,
    MAX(json_extract(e.properties_json, '$.action') = 'completed') AS completed,
    MAX(json_extract(e.properties_json, '$.action') = 'skipped') AS skipped
  FROM shown s
  LEFT JOIN analytics_events e
    ON e.installation_id = s.installation_id
   AND e.environment = 'production'
   AND e.event_name = 'onboarding_event'
  GROUP BY s.installation_id, s.shown_at
)
SELECT COUNT(*) AS shown,
  SUM(completed) AS completed,
  ROUND(100.0 * SUM(completed) / NULLIF(COUNT(*), 0), 1) AS completion_pct,
  SUM(skipped) AS skipped,
  ROUND(100.0 * SUM(skipped) / NULLIF(COUNT(*), 0), 1) AS skip_pct,
  SUM(shown_at <= datetime('now', '-1 day') AND completed = 0 AND skipped = 0)
    AS interrupted_after_24h
FROM outcomes;

-- Onboarding step funnel.
SELECT json_extract(properties_json, '$.step') AS step,
  COUNT(DISTINCT CASE WHEN json_extract(properties_json, '$.action') = 'step_viewed'
    THEN installation_id END) AS viewed,
  COUNT(DISTINCT CASE WHEN json_extract(properties_json, '$.action') = 'step_succeeded'
    THEN installation_id END) AS succeeded
FROM analytics_events
WHERE environment = 'production'
  AND event_name = 'onboarding_event'
  AND json_extract(properties_json, '$.step') IS NOT NULL
  AND occurred_at >= datetime('now', '-30 days')
GROUP BY step;

-- Core-feature usage. Denominator: all participants in the same period.
WITH participants AS (
  SELECT COUNT(DISTINCT installation_id) AS total
  FROM analytics_events
  WHERE environment = 'production' AND occurred_at >= datetime('now', '-30 days')
)
SELECT json_extract(properties_json, '$.action') AS action,
  COUNT(DISTINCT installation_id) AS users,
  ROUND(100.0 * COUNT(DISTINCT installation_id) / NULLIF(participants.total, 0), 1) AS usage_pct
FROM analytics_events, participants
WHERE environment = 'production'
  AND event_name = 'core_action_succeeded'
  AND json_extract(properties_json, '$.context') = 'normal'
  AND occurred_at >= datetime('now', '-30 days')
GROUP BY action, participants.total
ORDER BY users DESC;

-- Day-return, W2 (days 8-14), W4 (days 22-28).
-- Each denominator contains only cohorts old enough to finish that window.
WITH first_use AS (
  SELECT installation_id, date(MIN(occurred_at)) AS cohort_day
  FROM analytics_events
  WHERE environment = 'production' AND event_name = 'analytics_enabled'
  GROUP BY installation_id
),
active_days AS (
  SELECT DISTINCT installation_id, date(occurred_at) AS active_day
  FROM analytics_events
  WHERE environment = 'production'
),
returns AS (
  SELECT f.installation_id, f.cohort_day,
    MAX(julianday(a.active_day) - julianday(f.cohort_day) >= 1) AS another_day,
    MAX(julianday(a.active_day) - julianday(f.cohort_day) BETWEEN 8 AND 14) AS w2,
    MAX(julianday(a.active_day) - julianday(f.cohort_day) BETWEEN 22 AND 28) AS w4
  FROM first_use f
  LEFT JOIN active_days a ON a.installation_id = f.installation_id
  GROUP BY f.installation_id, f.cohort_day
)
SELECT
  SUM(cohort_day <= date('now', '-1 day')) AS day_return_eligible,
  SUM(CASE WHEN cohort_day <= date('now', '-1 day') THEN another_day ELSE 0 END) AS day_returned,
  ROUND(100.0 * SUM(CASE WHEN cohort_day <= date('now', '-1 day') THEN another_day ELSE 0 END) /
    NULLIF(SUM(cohort_day <= date('now', '-1 day')), 0), 1) AS day_return_pct,
  SUM(cohort_day <= date('now', '-14 days')) AS w2_eligible,
  SUM(CASE WHEN cohort_day <= date('now', '-14 days') THEN w2 ELSE 0 END) AS w2_returned,
  ROUND(100.0 * SUM(CASE WHEN cohort_day <= date('now', '-14 days') THEN w2 ELSE 0 END) /
    NULLIF(SUM(cohort_day <= date('now', '-14 days')), 0), 1) AS w2_pct,
  SUM(cohort_day <= date('now', '-28 days')) AS w4_eligible,
  SUM(CASE WHEN cohort_day <= date('now', '-28 days') THEN w4 ELSE 0 END) AS w4_returned,
  ROUND(100.0 * SUM(CASE WHEN cohort_day <= date('now', '-28 days') THEN w4 ELSE 0 END) /
    NULLIF(SUM(cohort_day <= date('now', '-28 days')), 0), 1) AS w4_pct
FROM returns;

-- Default-app and review prompt response.
SELECT json_extract(properties_json, '$.prompt') AS prompt,
  json_extract(properties_json, '$.action') AS action,
  COUNT(DISTINCT installation_id) AS users
FROM analytics_events
WHERE environment = 'production'
  AND event_name = 'prompt_event'
  AND occurred_at >= datetime('now', '-30 days')
GROUP BY prompt, action;

-- Version/language trend.
SELECT app_version, ui_language,
  COUNT(DISTINCT installation_id) AS users,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(*) AS events
FROM analytics_events
WHERE environment = 'production' AND occurred_at >= datetime('now', '-30 days')
GROUP BY app_version, ui_language
ORDER BY users DESC;

-- File failure rate excludes cancellations from the denominator.
SELECT json_extract(properties_json, '$.operation') AS operation,
  SUM(json_extract(properties_json, '$.outcome') = 'success') AS successes,
  SUM(json_extract(properties_json, '$.outcome') = 'cancelled') AS cancellations,
  SUM(json_extract(properties_json, '$.outcome') = 'failure') AS failures,
  ROUND(100.0 * SUM(json_extract(properties_json, '$.outcome') = 'failure') /
    NULLIF(SUM(json_extract(properties_json, '$.outcome') IN ('success', 'failure')), 0), 2)
    AS failure_pct
FROM analytics_events
WHERE environment = 'production'
  AND event_name = 'file_operation'
  AND occurred_at >= datetime('now', '-30 days')
GROUP BY operation;
