#!/usr/bin/env bash
# Two-session race checks for supabase/migrations/20261007170000_tracked_ai_credit_refunds.sql
#
# LOCAL DATABASE ONLY. Races need committed rows, so every scenario commits a
# throwaway member (race-<uuid>@example.test) and her receipts. Run it against
# a local Supabase you can rebuild (`supabase db reset`), never production:
#
#   LOCAL_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
#     bash scripts/verify-tracked-ai-credits-races.sh
#
# or set PSQL to any psql command line (it gets -X -v ON_ERROR_STOP=1 -qtA).
#
# In each race, session A opens a transaction, makes its move, holds its locks
# for HOLD seconds and commits; session B makes the competing move while A
# holds them. Every check prints "ok: ..." or "FAIL: ..."; the exit code is
# the number of failed checks. A bystander member who never acts is checked
# at the end: no race may change her balance or what she is owed.
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

new_member() { # daily purchased -> member id (balance stamped today)
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

spend() { # member allowance -> receipt id
  q -c "SELECT s.receipt_id FROM public.spend_ai_credit_tracked('$1', $2) AS s"
}

midnight() { # member: her pool loses today's stamp and her spends move one day back
  q -c "UPDATE public.user_entitlements SET credits_reset_at = credits_reset_at - 1 WHERE user_id = '$1';
        UPDATE public.ai_credit_spends SET credit_day = credit_day - 1 WHERE user_id = '$1';" >/dev/null
}

owed() { # member -> owed daily receipts
  q -c "SELECT count(*) FROM public.ai_credit_spends
         WHERE user_id = '$1' AND bucket = 'daily' AND refunded_at IS NOT NULL AND refund_applied_at IS NULL"
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

purchased() { q -c "SELECT purchased_credits FROM public.user_entitlements WHERE user_id = '$1'"; }
daily() { q -c "SELECT ai_credits FROM public.user_entitlements WHERE user_id = '$1'"; }

echo "-- bystander: a member who never acts, with an owed refund and a purchased balance"
by=$(new_member 1 0)
rc=$(spend "$by" 1)
midnight "$by"
q -c "SELECT public.refund_ai_credit_tracked('$rc')" >/dev/null
q -c "UPDATE public.user_entitlements SET ai_credits = 1, purchased_credits = 2, credits_reset_at = current_date
       WHERE user_id = '$by'" >/dev/null
BYSTANDER_BEFORE="1/2/$(owed "$by")"
expect_eq "BY the bystander starts with one owed refund" "$BYSTANDER_BEFORE" "1/2/1"

echo "-- TR1 refund vs refund, purchased receipt"
m=$(new_member 0 2)
rc=$(spend "$m" 0)
expect_eq "TR1 charged from purchased" "$(purchased "$m")" "1"
race "SELECT public.refund_ai_credit_tracked('$rc')" "SELECT public.refund_ai_credit_tracked('$rc')"
expect_eq "TR1 the second refund finds it refunded" "$OUT_B" "already_refunded"
check "TR1 it waited for the first ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
expect_eq "TR1 refunded exactly once, to purchased" "$(daily "$m")/$(purchased "$m")" "0/2"

echo "-- TR2 refund vs refund, same-day daily receipt"
m=$(new_member 2 0)
rc=$(spend "$m" 2)
race "SELECT public.refund_ai_credit_tracked('$rc')" "SELECT public.refund_ai_credit_tracked('$rc')"
expect_eq "TR2 the second refund finds it refunded" "$OUT_B" "already_refunded"
expect_eq "TR2 refunded exactly once, to the daily pool" "$(daily "$m")/$(purchased "$m")" "2/0"

echo "-- TR3 two spends at once both stamping the day, with refunds owed"
m=$(new_member 2 0)
r1=$(spend "$m" 2)
r2=$(spend "$m" 2)
midnight "$m"
q -c "SELECT public.refund_ai_credit_tracked('$r1'), public.refund_ai_credit_tracked('$r2')" >/dev/null
check "TR3 two refunds owed, nothing written" "(SELECT ai_credits = 0 AND purchased_credits = 0 FROM public.user_entitlements WHERE user_id = '$m')"
race "SELECT 1 FROM public.spend_ai_credit_tracked('$m', 3)" \
     "SELECT s.allowed FROM public.spend_ai_credit_tracked('$m', 3) AS s"
expect_eq "TR3 the second spend is allowed" "$OUT_B" "t"
check "TR3 it waited for the first ($WAIT_B_MS ms)" "$WAIT_B_MS > 900"
expect_eq "TR3 the fresh pool absorbed the owed refunds once: 3 - 2 spent, never above 3" "$(daily "$m")/$(purchased "$m")" "1/0"
expect_eq "TR3 nothing left owed" "$(owed "$m")" "0"

echo "-- TR4 an owed refund racing the spend that stamps the day"
m=$(new_member 1 0)
rc=$(spend "$m" 1)
midnight "$m"
race "SELECT 1 FROM public.spend_ai_credit_tracked('$m', 3)" \
     "SELECT public.refund_ai_credit_tracked('$rc')"
expect_eq "TR4 a rolled-over refund stays owed for the next spend" "$OUT_B" "owed"
expect_eq "TR4 nothing added yet: 3 - 1" "$(daily "$m")/$(purchased "$m")/$(owed "$m")" "2/0/1"
spend "$m" 3 >/dev/null
expect_eq "TR4 the next spend refills to the allowance, then spends: 2 + 1 - 1" "$(daily "$m")/$(purchased "$m")/$(owed "$m")" "2/0/0"

echo "-- TR5 refund vs refund on an owed daily receipt, then the stamp"
m=$(new_member 1 0)
rc=$(spend "$m" 1)
midnight "$m"
race "SELECT public.refund_ai_credit_tracked('$rc')" "SELECT public.refund_ai_credit_tracked('$rc')"
expect_eq "TR5 the second refund finds it refunded" "$OUT_B" "already_refunded"
spend "$m" 3 >/dev/null
expect_eq "TR5 settled once when the day is stamped; the fresh pool absorbs it: 3 - 1" "$(daily "$m")/$(purchased "$m")/$(owed "$m")" "2/0/0"

echo "-- bystander after every race"
expect_eq "BY the bystander is untouched (daily/purchased/owed)" \
  "$(daily "$by")/$(purchased "$by")/$(owed "$by")" "$BYSTANDER_BEFORE"
check "BY her day is still stamped today" "(SELECT credits_reset_at = current_date FROM public.user_entitlements WHERE user_id = '$by')"

if [ "$failures" -eq 0 ]; then
  echo "tracked ai credits races: all checks passed"
fi
exit "$failures"
