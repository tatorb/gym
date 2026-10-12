-- ============================================================
--  PASO 4 — Tabla para el REGISTRO CORPORAL (peso / cintura / sueño)
--  Pegá TODO en Supabase -> SQL Editor -> New query -> Run.
--  No toca ninguna otra tabla. La app funciona local desde ya;
--  cuando crees esta tabla, empieza a sincronizar.
-- ============================================================

create table if not exists public.corporal (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  fecha       date        not null,               -- día de la medición
  usuario     text        not null,               -- 'tato' | 'gabi'
  peso        numeric,                             -- kg
  cintura     numeric,                             -- cm (a la altura del ombligo)
  sueno       integer                              -- 1 a 10
);

create index if not exists corporal_busqueda_idx on public.corporal (usuario, fecha desc);

alter table public.corporal enable row level security;

-- Acceso anónimo (igual que 'registros' hoy, sin login).
drop policy if exists "corp leer"       on public.corporal;
drop policy if exists "corp insertar"   on public.corporal;
drop policy if exists "corp actualizar" on public.corporal;
drop policy if exists "corp borrar"     on public.corporal;

create policy "corp leer"       on public.corporal for select to anon using (true);
create policy "corp insertar"   on public.corporal for insert to anon with check (true);
create policy "corp actualizar" on public.corporal for update to anon using (true) with check (true);
create policy "corp borrar"     on public.corporal for delete to anon using (true);

-- ============================================================
--  Cuando actives el login (AUTH_ENABLED), agregá además políticas
--  para usuarios logueados, como en supabase_auth_setup.sql:
--    create policy "corp auth leer" on public.corporal for select
--      to authenticated using (public.soy_admin() or usuario = public.mi_slug());
--    ...(insert/update/delete igual)...
-- ============================================================
