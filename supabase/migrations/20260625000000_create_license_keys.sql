create extension if not exists pgcrypto with schema extensions;

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  active boolean not null default true,
  device_id text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  constraint license_keys_key_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint license_keys_device_id_uuid check (device_id is null or device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

alter table public.license_keys enable row level security;
revoke all on table public.license_keys from anon, authenticated;
