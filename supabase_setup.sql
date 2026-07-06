-- ============================================================
--  CONFIGURACIÓN DE LA BASE DE DATOS EN SUPABASE
-- ============================================================
--  Copiá TODO este archivo y pegalo en Supabase:
--    Menú izquierdo  ->  "SQL Editor"  ->  "New query"
--    Pegá esto  ->  botón "Run" (o Ctrl+Enter)
--  Con esto se crea la tabla y los permisos de una sola vez.
-- ============================================================

-- 1) La tabla donde se guarda cada carga (una fila = una serie de un ejercicio en un día).
create table if not exists public.registros (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  fecha       date        not null,               -- día del entrenamiento (AAAA-MM-DD)
  usuario     text        not null,               -- 'tato' o 'gabi'
  dia         text        not null,               -- id del día del plan, ej: 'dia1'
  ejercicio   text        not null,               -- id del ejercicio del plan
  ejercicio_nombre text,                          -- nombre legible del ejercicio
  medida      text        not null default 'kg',  -- 'kg' | 'reps' | 'seg'
  kg          numeric,                            -- valor cargado (peso, reps o segundos según 'medida')
  rir         numeric,                            -- reps en reserva
  nota        text                                -- nota opcional
);

-- Si ya tenías la tabla creada de antes, esta línea agrega la columna 'medida'
-- sin borrar nada (es seguro correrla aunque ya exista).
alter table public.registros add column if not exists medida text not null default 'kg';

-- Índice para que el historial por usuario+ejercicio salga rápido.
create index if not exists registros_busqueda_idx
  on public.registros (usuario, ejercicio, fecha desc);

-- 2) Activamos "Row Level Security" (RLS). Es un candado: sin permisos, nadie entra.
alter table public.registros enable row level security;

-- 3) Como no hay login (solo elegís Tato o Gabi), permitimos leer e insertar
--    a cualquiera que use la app con la clave pública (rol 'anon').
--    Borramos policies viejas por si corrés esto más de una vez.
drop policy if exists "leer registros" on public.registros;
drop policy if exists "insertar registros" on public.registros;
drop policy if exists "actualizar registros" on public.registros;
drop policy if exists "borrar registros" on public.registros;

create policy "leer registros"
  on public.registros for select
  to anon using (true);

create policy "insertar registros"
  on public.registros for insert
  to anon with check (true);

create policy "actualizar registros"
  on public.registros for update
  to anon using (true) with check (true);

create policy "borrar registros"
  on public.registros for delete
  to anon using (true);

-- Listo. Si ves "Success. No rows returned" está todo bien.
