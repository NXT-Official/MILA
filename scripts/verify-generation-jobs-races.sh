#!/usr/bin/env bash
# Two-session race checks for supabase/migrations/20261007143000_generation_jobs.sql
#
# LOCAL DATABASE ONLY. Races need committed rows, so every scenario commits a
# throwaway member (race-<uuid>@example.test) and her jobs. Run it against a
# local Supabase you can rebuild (`supabase db reset`), never production:
#
#   LOCAL_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
#     bash scripts/verify-generation-jobs-races.sh
#
# or set PSQL to any psql command line (it gets -X -v ON_ERROR_STOP=1 -qtA).
#
# In each race, session A opens a transaction, makes its move, holds its row
# locks for HOLD seconds and commits; session B makes the competing move
# while A holds them. Every check prints "ok: ..." or "FAIL: ..."; the exit
# code is the number of failed checks. A bystander member who never acts is
# checked at the end: no race may change her balance or what she is owed.
#
# It refuses to run unless the server address is local or private (a unix
# socket, loopback, 10/8, 172.16/12, 192.168/16, fc00::/7), because it
# commits rows that may never be deleted. RACES_ALLOW_COMMIT=1 overrides.

set -u
HOLD=${HOLD:-2}
failures=0

q() {
  if [ -n "${PSQL:-}" ]; then
    # shellcheck disable=SC2086 # PSQL is a command line on purpose
    $PSQL -X -v ON_ERROR_STOP=1 -qtA "$@"
  else
    psql "${LOCAL_DB_URL:?set LOCAL_DB_URL or PSQL}" -X -v ON_ERROR_STOP=1 -qtA "$@"
  fi
}

where=$(q -c "SELECT CASE WHEN inet_server_addr() IS NULL
                            OR inet_server_addr() <<= ANY (ARRAY['127.0.0.0/8', '::1/128', '10.0.0.0/8',
                                 '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']::inet[])
                          THEN 'local' ELSE host(inet_server_addr()) END" 2>&1)
if [ "$where" != "local" ] && [ "${RACES_ALLOW_COMMIT:-}" != "1" ]; then
  echo "Refusing to run: the database ($where) does not look local, and this script commits test members."
  echo "Set RACES_ALLOW_COMMIT=1 only for a database you can rebuild."
  exit 99
fi

check() { # name, SQL boolean expression
  local got
  got=$(q -c "SELECT ($2)::text" 2>&1)
  if [ "$got" = "true" ]; then
    echo "ok: $1"
  else
    echo "FAIL: $1 (got: $got)"
    failures=$((failures + 1))
  fi
}

expect_eq() { # name, actual, expected
  if [ "$2" = "$3" ]; then
    echo "ok: $1"
  else
    echo "FAIL: $1 (expected: $3, got: $2)"
    failures=$((failures + 1))
  fi
}

now_ms() { date +%s%3N; }

new_member() { # daily purchased -> member id
  local id
  id=$(q -c "INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
             SELECT '00000000-0000-0000-0000-000000000000', g, 'authenticated', 'authenticated',
                    'race-' || g || '@example.test',
                    jsonb_build_object('username', 'race_' || left(replace(g::text, '-', ''), 16)),
                    now(), now()
               FROM gen_random_uuid() AS g
             RETURNING id")
  q -c "UPDATE public.user_entitlements
           SET ai_credits = $1, purchased_credits = $2, credits_reset_at = current_date
         WHERE user_id = '$id'" >/dev/null
  echo "$id"
}

start_job() { # member kind -> job id (charged; allowance 0, so the balance set above decides)
  q -c "SELECT (s.job).id FROM public.start_generation_job('$1', '$2', gen_random_uuid(), '{}', TRUE, 0, 60) AS s"
}

make_overdue() { # job id
  q -c "UPDATE public.generation_jobs SET deadline_at = now() - interval '40 seconds' WHERE id = '$1'" >/dev/null
}

# race "<session A statement>" "<session B statement>": sets OUT_B and WAIT_B_MS
race() {
  q -c "BEGIN; $1; SELECT pg_sleep($HOLD); COMMIT;" >/dev/null 2>&1 &
  local pid=$!
  sleep 0.7
  local t0
  t0=$(now_ms)
  OUT_B=$(q -c "$2" 2>&1)
  WAIT_B_MS=$(($(now_ms) - t0))
  wait "$pid"
}

col() { # job id, column -> value
  q -c "SELECT $2 FROM public.generation_jobs WHERE id = '$1'"
}
purchased() { q -c "SELECT purchased_credits FROM public.user_entitlements WHERE user_id = '$1'"; }
daily() { q -c "SELECT ai_credits FROM public.user_entitlements WHERE user_id = '$1'"; }
owed() { # member -> owed daily job refunds
  q -c "SELECT count(*) FROM public.generation_jobs
         WHERE user_id = '$1' AND charged_from = 'daily' AND credit_state = 'refunded' AND refund_applied_at IS NULL"
}

echo "-- bystander: a member who never acts, with an owed refund and a purchased balance"
by=$(new_member 1 0)
j=$(start_job "$by" look)
q -c "UPDATE public.user_entitlements SET credits_reset_at = credits_reset_at - 1 WHERE user_id = '$by';
      UPDATE public.generation_jobs SET created_at = created_at - interval '1 day' WHERE user_id = '$by';" >/dev/null
q -c "SELECT 1 FROM public.fail_generation_job('$j', 'provider_error', TRUE)" >/dev/null
q -c "UPDATE public.user_entitlements SET ai_credits = 1, purchased_credits = 2, credits_reset_at = current_date
       WHERE user_id = '$by'" >/dev/null
BYSTANDER_BEFORE="1/2/$(owed "$by")"
expect_eq "BY the bystander starts with one owed refund" "$BYSTANDER_BEFORE" "1/2/1"

echo "-- R0 start vs start, same member and kind"
m=$(new_member 0 4)
race "SELECT 1 FROM public.start_generation_job('$m', 'look', gen_random_uuid(), '{}', TRUE, 0, 60)" \
     "SELECT s.outcome FROM public.start_generation_job('$m', 'look', gen_random_uuid(), '{}', TRUE, 0, 60) AS s"
expect_eq "R0 the second start attaches (in_flight)" "$OUT_B" "in_flight"
check "R0 it waited for the first start's lock ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
check "R0 one running row" "(SELECT count(*) FROM public.generation_jobs WHERE user_id = '$m' AND status = 'running') = 1"
expect_eq "R0 one charge" "$(purchased "$m")" "3"
# Finish it, so no later reaper (in this or a later run) counts it.
q -c "SELECT 1 FROM public.complete_generation_job(
        (SELECT id FROM public.generation_jobs WHERE user_id = '$m' AND status = 'running'), '{}', NULL)" >/dev/null

echo "-- R1 complete holds the row while the reaper runs"
m=$(new_member 0 1)
j=$(start_job "$m" look)
make_overdue "$j"
# lock_timeout makes "does not wait" deterministic: a reaper that waited on
# the locked row would fail with lock_not_available instead of answering 0.
race "SELECT 1 FROM public.complete_generation_job('$j', '{\"ok\":true}', NULL)" \
     "SET lock_timeout = '500ms'; SELECT public.reap_generation_jobs('$m')"
expect_eq "R1 the reaper skips the row being completed, without waiting (lock_timeout 500 ms)" "$OUT_B" "0"
expect_eq "R1 the job is completed" "$(col "$j" "status || '/' || credit_state")" "succeeded/charged"
expect_eq "R1 a completed job is not refunded" "$(purchased "$m")" "0"

echo "-- R2 the reaper holds the row while complete runs"
m=$(new_member 0 1)
j=$(start_job "$m" look)
make_overdue "$j"
race "SELECT public.reap_generation_jobs('$m')" \
     "SELECT s.outcome FROM public.complete_generation_job('$j', '{\"ok\":true}', NULL) AS s"
expect_eq "R2 a reaped job cannot be completed" "$OUT_B" "not_running"
check "R2 complete waited for the reaper ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
expect_eq "R2 the job is failed, refunded, without a result" \
  "$(col "$j" "status || '/' || credit_state || '/' || coalesce(result::text, 'none')")" "failed/refunded/none"
expect_eq "R2 refunded exactly once" "$(purchased "$m")" "1"

echo "-- R3 fail holds the row while the reaper runs"
m=$(new_member 0 1)
j=$(start_job "$m" look)
make_overdue "$j"
race "SELECT 1 FROM public.fail_generation_job('$j', 'provider_error', TRUE)" \
     "SELECT public.reap_generation_jobs('$m')"
expect_eq "R3 the reaper skips the row being failed" "$OUT_B" "0"
expect_eq "R3 failed by the server, refunded" "$(col "$j" "error_code || '/' || credit_state")" "provider_error/refunded"
expect_eq "R3 refunded exactly once" "$(purchased "$m")" "1"

echo "-- R4 the reaper holds the row while fail runs"
m=$(new_member 0 1)
j=$(start_job "$m" look)
make_overdue "$j"
race "SELECT public.reap_generation_jobs('$m')" \
     "SELECT s.outcome FROM public.fail_generation_job('$j', 'provider_error', TRUE) AS s"
expect_eq "R4 fail after the reaper finds it finished" "$OUT_B" "not_running"
check "R4 fail waited for the reaper ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
expect_eq "R4 reaped, refunded" "$(col "$j" "error_code || '/' || credit_state")" "deadline_exceeded/refunded"
expect_eq "R4 refunded exactly once" "$(purchased "$m")" "1"

echo "-- R5 fail vs fail"
m=$(new_member 0 1)
j=$(start_job "$m" look)
race "SELECT 1 FROM public.fail_generation_job('$j', 'provider_error', TRUE)" \
     "SELECT s.outcome FROM public.fail_generation_job('$j', 'provider_error', TRUE) AS s"
expect_eq "R5 the second fail finds it finished" "$OUT_B" "not_running"
check "R5 the second fail waited for the first ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
expect_eq "R5 refunded exactly once" "$(purchased "$m")" "1"

echo "-- R6 cron reaper holds a daily-charged row while fail runs"
m=$(new_member 1 0)
j=$(start_job "$m" look)
expect_eq "R6 charged from the daily pool" "$(daily "$m")" "0"
make_overdue "$j"
race "SELECT public.reap_generation_jobs()" \
     "SELECT s.outcome FROM public.fail_generation_job('$j', 'provider_error', TRUE) AS s"
expect_eq "R6 fail after the reaper finds it finished" "$OUT_B" "not_running"
expect_eq "R6 the daily credit is back in the daily pool, once" "$(daily "$m")/$(purchased "$m")" "1/0"
check "R6 the refund landed" "(SELECT refund_applied_at IS NOT NULL FROM public.generation_jobs WHERE id = '$j')"

echo "-- R7 two cron reapers at once"
# Reap anything already overdue (e.g. left by an interrupted earlier run), so
# the counts below are this scenario's alone.
q -c "SELECT public.reap_generation_jobs()" >/dev/null
m=$(new_member 0 1)
j=$(start_job "$m" look)
make_overdue "$j"
race "SELECT public.reap_generation_jobs()" "SELECT public.reap_generation_jobs()"
expect_eq "R7 the second reaper skips the row the first one holds" "$OUT_B" "0"
expect_eq "R7 refunded exactly once" "$(purchased "$m")" "1"

echo "-- bystander after every race"
expect_eq "BY the bystander is untouched (daily/purchased/owed)" \
  "$(daily "$by")/$(purchased "$by")/$(owed "$by")" "$BYSTANDER_BEFORE"
check "BY her day is still stamped today" "(SELECT credits_reset_at = current_date FROM public.user_entitlements WHERE user_id = '$by')"

if [ "$failures" -eq 0 ]; then
  echo "generation_jobs races: all checks passed"
fi
exit "$failures"
