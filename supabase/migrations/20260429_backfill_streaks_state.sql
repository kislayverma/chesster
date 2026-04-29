-- Backfill streaks_state for existing users from historical activity.
--
-- Activity dates are derived from:
--   - games.finished_at   (completed games)
--   - weakness_events.ts  (mistake reviews)
--
-- For each user we compute:
--   - currentStreak / longestStreak from consecutive activity days
--   - lastActiveDate from the most recent activity
--   - weeklyGamesPlayed / weeklyReviewsDone for the current Mon-Sun week
--   - Default targets (5 games, 10 reviews per week)
--
-- Safe to re-run: only updates rows where streaks_state is empty ('{}').

with

-- 1. Gather all distinct activity dates per user.
activity_dates as (
  select user_id, (finished_at at time zone 'UTC')::date as activity_date
  from public.games
  where finished_at is not null
  union
  select user_id, (ts at time zone 'UTC')::date as activity_date
  from public.weakness_events
),

distinct_dates as (
  select user_id, activity_date
  from activity_dates
  group by user_id, activity_date
),

-- 2. Detect consecutive-day groups using the gaps-and-islands technique.
--    Subtracting a row_number from the date produces the same value for
--    consecutive days, giving us a "group id".
numbered as (
  select
    user_id,
    activity_date,
    activity_date - (row_number() over (
      partition by user_id order by activity_date
    ))::int as grp
  from distinct_dates
),

streaks as (
  select
    user_id,
    min(activity_date) as streak_start,
    max(activity_date) as streak_end,
    count(*)::int       as streak_days
  from numbered
  group by user_id, grp
),

-- 3. Longest streak per user.
longest as (
  select distinct on (user_id)
    user_id,
    streak_days as longest_streak
  from streaks
  order by user_id, streak_days desc
),

-- 4. Most recent streak per user (to determine current streak).
--    A streak is "current" if its end date is today or yesterday.
latest as (
  select distinct on (user_id)
    user_id,
    streak_end,
    streak_days
  from streaks
  order by user_id, streak_end desc
),

current_streak as (
  select
    user_id,
    case
      when streak_end >= (current_date - 1) then streak_days
      else 0
    end as current_streak,
    streak_end as last_active_date
  from latest
),

-- 5. Weekly counts for the current Monday-Sunday window.
current_monday as (
  select (current_date - extract(isodow from current_date)::int + 1)::date as mon
),

weekly_games as (
  select
    g.user_id,
    count(*)::int as cnt
  from public.games g, current_monday cm
  where g.finished_at is not null
    and (g.finished_at at time zone 'UTC')::date >= cm.mon
  group by g.user_id
),

weekly_reviews as (
  select
    w.user_id,
    count(*)::int as cnt
  from public.weakness_events w, current_monday cm
  where (w.ts at time zone 'UTC')::date >= cm.mon
  group by w.user_id
),

-- 6. Assemble the final JSON per user.
assembled as (
  select
    p.user_id,
    jsonb_build_object(
      'currentStreak',      coalesce(cs.current_streak, 0),
      'longestStreak',      coalesce(l.longest_streak, 0),
      'lastActiveDate',     coalesce(to_char(cs.last_active_date, 'YYYY-MM-DD'), ''),
      'weekStartDate',      to_char(cm.mon, 'YYYY-MM-DD'),
      'weeklyGamesPlayed',  coalesce(wg.cnt, 0),
      'weeklyReviewsDone',  coalesce(wr.cnt, 0),
      'weeklyGameTarget',   5,
      'weeklyReviewTarget', 10
    ) as streaks_json
  from public.profiles p
  cross join current_monday cm
  left join current_streak cs on cs.user_id = p.user_id
  left join longest l          on l.user_id  = p.user_id
  left join weekly_games wg    on wg.user_id = p.user_id
  left join weekly_reviews wr  on wr.user_id = p.user_id
)

-- 7. Write only to rows that haven't been populated yet.
update public.profiles p
set streaks_state = a.streaks_json
from assembled a
where p.user_id = a.user_id
  and (p.streaks_state is null or p.streaks_state = '{}'::jsonb);
