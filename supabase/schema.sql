create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_limit integer not null default 10 check (invite_limit between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  plan_type text not null default 'personal',
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  payment_provider text not null default 'manual',
  abacatepay_customer_id text,
  abacatepay_subscription_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.subscriptions
  add column if not exists plan_type text not null default 'personal';

alter table public.subscriptions
  add column if not exists payment_provider text not null default 'manual';

alter table public.subscriptions
  add column if not exists abacatepay_customer_id text;

alter table public.subscriptions
  add column if not exists abacatepay_subscription_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_abacatepay_subscription_id_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_abacatepay_subscription_id_key
      unique (abacatepay_subscription_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_plan_type_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_type_check
      check (plan_type in ('personal', 'business'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_plan_organization_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_organization_check
      check (
        (plan_type = 'personal' and organization_id is null)
        or
        (plan_type = 'business' and organization_id is not null)
      );
  end if;
end $$;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'canceled', 'expired')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

alter table public.organizations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.organization_active_seats(target_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.organization_memberships
  where organization_id = target_organization_id
    and status = 'active';
$$;

drop policy if exists "Members can read their organizations" on public.organizations;
create policy "Members can read their organizations"
on public.organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

drop policy if exists "Users can read personal or organization subscription" on public.subscriptions;
create policy "Users can read personal or organization subscription"
on public.subscriptions
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    organization_id is not null
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = subscriptions.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
);

drop policy if exists "Users can read their memberships" on public.organization_memberships;
create policy "Users can read their memberships"
on public.organization_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_admin(organization_id)
);

drop policy if exists "Admins can read invitations" on public.organization_invitations;
create policy "Admins can read invitations"
on public.organization_invitations
for select
to authenticated
using (public.is_organization_admin(organization_id));

drop policy if exists "Admins can create invitations" on public.organization_invitations;
create policy "Admins can create invitations"
on public.organization_invitations
for insert
to authenticated
with check (
  invited_by = auth.uid()
  and public.is_organization_admin(organization_id)
  and public.organization_active_seats(organization_id) < (
    select invite_limit + 1
    from public.organizations
    where id = organization_invitations.organization_id
  )
);

create index if not exists organizations_owner_user_id_idx on public.organizations(owner_user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_organization_id_idx on public.subscriptions(organization_id);
create index if not exists subscriptions_plan_type_idx on public.subscriptions(plan_type);
create index if not exists subscriptions_status_idx on public.subscriptions(status);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships(user_id);
create index if not exists organization_memberships_organization_id_idx on public.organization_memberships(organization_id);
create index if not exists organization_invitations_organization_id_idx on public.organization_invitations(organization_id);
create index if not exists organization_invitations_email_idx on public.organization_invitations(email);

-- Fluxo recomendado em producao:
-- 1. O webhook de pagamento cria/atualiza subscriptions usando service_role.
-- 2. Para plano business, o backend cria organizations e adiciona o comprador
--    em organization_memberships com role = 'owner'.
-- 3. Cada organization aceita ate 10 convidados alem do owner.
-- 4. Convites por e-mail devem ser enviados por Supabase Edge Function ou backend
--    proprio usando service_role e um provedor de e-mail.
-- 5. Nunca coloque a service_role key dentro do app desktop.
