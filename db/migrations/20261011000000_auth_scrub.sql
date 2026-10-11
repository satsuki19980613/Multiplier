-- Personal data that arrives with the Google login is not kept in the database (the operator cannot see it either, not even in the Neon console).
-- Same as PrivateMatch (20261010000000_auth_scrub.sql + 20261010100000_auth_scrub_profile.sql there).
--   Neon Auth writes the person to neon_auth."user" (email, name, image), neon_auth.account (Google's tokens) and neon_auth.session
--   (IP address, browser). The app uses none of them (the shown name is profiles.nickname; a returning login is found by account."accountId").
--   user:    email -> <id>@multiplier.invalid (still unique, not a real address), name -> 'Player', image -> null
--   account: "idToken" (carries the email address), "accessToken" / "refreshToken" (Google would tell the email address) -> null
--   session: "ipAddress", "userAgent" -> null
-- Triggers replace the values just before every write, whoever writes them. Rows already there are replaced too (cannot be undone).

create function public.auth_user_scrub()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.email := new.id::text || '@multiplier.invalid';
  new.name := 'Player';
  new.image := null;
  return new;
end $$;

create function public.auth_account_scrub()
returns trigger language plpgsql set search_path = '' as $$
begin
  new."idToken" := null;
  new."accessToken" := null;
  new."refreshToken" := null;
  return new;
end $$;

create function public.auth_session_scrub()
returns trigger language plpgsql set search_path = '' as $$
begin
  new."ipAddress" := null;
  new."userAgent" := null;
  return new;
end $$;

revoke all on function public.auth_user_scrub(), public.auth_account_scrub(), public.auth_session_scrub() from public, anonymous, authenticated;

create trigger auth_user_scrub before insert or update on neon_auth."user"
  for each row execute function public.auth_user_scrub();
create trigger auth_account_scrub before insert or update on neon_auth.account
  for each row execute function public.auth_account_scrub();
create trigger auth_session_scrub before insert or update on neon_auth.session
  for each row execute function public.auth_session_scrub();

-- rows already there (the user trigger also puts in the email and the name)
update neon_auth."user" set image = null
  where email <> id::text || '@multiplier.invalid' or name <> 'Player' or image is not null;
update neon_auth.account set "idToken" = null, "accessToken" = null, "refreshToken" = null
  where "idToken" is not null or "accessToken" is not null or "refreshToken" is not null;
update neon_auth.session set "ipAddress" = null, "userAgent" = null
  where "ipAddress" is not null or "userAgent" is not null;
