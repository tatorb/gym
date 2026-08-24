-- ============================================================
--  SISTEMA DE USUARIOS (login con mail + contraseña)
-- ============================================================
--  Corré este archivo en Supabase:
--    Menú izquierdo  ->  "SQL Editor"  ->  "New query"
--    Pegá TODO  ->  botón "Run" (Ctrl/Cmd + Enter)
--
--  IMPORTANTE — hacé los pasos en este orden (ver README):
--    1) Authentication -> Providers -> Email: activado (Confirm email ON).
--    2) Authentication -> URL Configuration: poné la URL de tu sitio
--       (la de GitHub Pages) en "Site URL" y en "Redirect URLs".
--    3) Authentication -> Users -> "Add user" / "Invite":
--         - mrodriguezrusco@gmail.com   (Tato, administrador)
--         - arqgabrielabordabossana@hotmail.com  (Gabi)
--    4) Recién ahí corré ESTE archivo.
--    5) En config.js poné  AUTH_ENABLED: true.
--    6) Cuando el login ande bien, corré el "PASO FINAL" del final
--       de este archivo para cerrar el acceso anónimo.
-- ============================================================

-- 1) Tabla de perfiles: enlaza cada cuenta (auth.users) con su
--    "slug" del plan ('tato' | 'gabi') y si es administrador.
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text,
  slug      text not null,               -- 'tato' | 'gabi'
  es_admin  boolean not null default false
);

alter table public.perfiles enable row level security;

-- Funciones ayudantes (security definer: pueden leer perfiles sin recursión de RLS).
create or replace function public.mi_slug()
  returns text language sql stable security definer set search_path = public as $$
  select slug from public.perfiles where id = auth.uid()
$$;

create or replace function public.soy_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false)
$$;

-- Cada usuario puede leer su propio perfil; el admin, todos.
drop policy if exists "perfil propio o admin" on public.perfiles;
create policy "perfil propio o admin"
  on public.perfiles for select
  to authenticated
  using (id = auth.uid() or public.soy_admin());

-- 2) Permisos sobre 'registros' para usuarios LOGUEADOS (rol authenticated):
--    cada uno ve/edita SOLO lo suyo (usuario = su slug); el admin, todo.
drop policy if exists "auth leer registros" on public.registros;
drop policy if exists "auth insertar registros" on public.registros;
drop policy if exists "auth actualizar registros" on public.registros;
drop policy if exists "auth borrar registros" on public.registros;

create policy "auth leer registros"
  on public.registros for select
  to authenticated
  using (public.soy_admin() or usuario = public.mi_slug());

create policy "auth insertar registros"
  on public.registros for insert
  to authenticated
  with check (public.soy_admin() or usuario = public.mi_slug());

create policy "auth actualizar registros"
  on public.registros for update
  to authenticated
  using (public.soy_admin() or usuario = public.mi_slug())
  with check (public.soy_admin() or usuario = public.mi_slug());

create policy "auth borrar registros"
  on public.registros for delete
  to authenticated
  using (public.soy_admin() or usuario = public.mi_slug());

-- 3) Enlazamos las cuentas ya creadas con su perfil (por mail).
--    Se puede correr varias veces sin problema. Si todavía no creaste
--    los usuarios en Authentication -> Users, no inserta nada: creás
--    los usuarios y volvés a correr esta parte.
insert into public.perfiles (id, email, slug, es_admin)
select u.id, u.email,
  case
    when lower(u.email) = 'mrodriguezrusco@gmail.com' then 'tato'
    when lower(u.email) = 'arqgabrielabordabossana@hotmail.com' then 'gabi'
  end as slug,
  (lower(u.email) = 'mrodriguezrusco@gmail.com') as es_admin
from auth.users u
where lower(u.email) in ('mrodriguezrusco@gmail.com', 'arqgabrielabordabossana@hotmail.com')
on conflict (id) do update
  set slug = excluded.slug, es_admin = excluded.es_admin, email = excluded.email;

-- ============================================================
--  PASO FINAL (correr SOLO cuando el login ya funcione bien):
--  cierra el acceso anónimo, así queda "cada uno ve lo suyo".
--  Mientras esté comentado, la app vieja (sin login) sigue andando.
-- ============================================================
-- drop policy if exists "leer registros"       on public.registros;
-- drop policy if exists "insertar registros"   on public.registros;
-- drop policy if exists "actualizar registros" on public.registros;
-- drop policy if exists "borrar registros"     on public.registros;
