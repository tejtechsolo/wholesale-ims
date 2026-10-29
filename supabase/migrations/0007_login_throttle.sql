-- Stage 7c-3a: throttle failed password sign-ins per (client IP + email) and per client IP.
--
-- Sign-in happens on the Next.js server, so Supabase Auth sees the server's IP for every
-- user: its own IP-based limits can't single out one attacker. The app therefore derives
-- keys from the real client IP + email, HMACs them with a server-only pepper
-- (LOGIN_THROTTLE_SECRET) and counts FAILURES here. Successful sign-in clears the pair.
-- Keys are opaque hex digests: the table never stores an email or an IP.

create table public.login_failures (
  key           text primary key check (key ~ '^[0-9a-f]{64}$'),
  failures      integer not null default 0 check (failures >= 0),
  window_start  timestamptz not null default now()
);

-- p_event: 'check' (is either key blocked?), 'fail' (count a failure), 'success' (clear pair).
-- Returns true when the caller must refuse the sign-in attempt.
create function public.login_throttle(p_pair text, p_ip text, p_event text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_window      constant interval := interval '15 minutes';
  c_pair_limit  constant int := 5;
  c_ip_limit    constant int := 30;
  v_blocked     boolean;
begin
  if p_pair !~ '^[0-9a-f]{64}$' or p_ip !~ '^[0-9a-f]{64}$' or p_pair = p_ip
     or p_event not in ('check', 'fail', 'success') then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'login_throttle'));
  end if;

  if p_event = 'success' then
    delete from public.login_failures where key = p_pair;
    return false;
  end if;

  if p_event = 'fail' then
    insert into public.login_failures as f (key, failures, window_start)
    values (p_pair, 1, now()), (p_ip, 1, now())
    on conflict (key) do update
      set failures = case when f.window_start < now() - c_window then 1 else f.failures + 1 end,
          window_start = case when f.window_start < now() - c_window then now() else f.window_start end;
    -- Opportunistic cleanup keeps the table small without a cron job.
    delete from public.login_failures where window_start < now() - interval '1 day';
  end if;

  select coalesce(bool_or(
           (key = p_pair and failures >= c_pair_limit) or (key = p_ip and failures >= c_ip_limit)), false)
    into v_blocked
    from public.login_failures
   where key in (p_pair, p_ip) and window_start >= now() - c_window;
  return v_blocked;
end $$;

-- Nobody reads or writes the table directly; only the function touches it.
revoke all on public.login_failures from anon, authenticated;
alter table public.login_failures enable row level security;

-- Sign-in runs before there is a session, so anon must be able to call it.
revoke execute on function public.login_throttle(text, text, text) from public;
grant execute on function public.login_throttle(text, text, text) to anon, authenticated;
