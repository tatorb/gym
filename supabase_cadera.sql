-- ============================================================
--  CADERA — agrega la columna "cadera" al registro corporal.
--  Pegá TODO en Supabase -> SQL Editor -> New query -> Run.
--
--  Es SEGURO:
--   • No borra ni cambia ningún dato que ya tengas.
--   • No toca los planes ni el historial de cargas (tabla 'registros').
--   • Solo suma una columna nueva y vacía ('cadera') a la tabla 'corporal'.
--   • Si ya la corriste antes, no pasa nada: no la duplica.
--
--  La app ya funciona sin esto (guarda la cadera en el teléfono).
--  Al correr esto, la cadera también empieza a sincronizar en la nube.
-- ============================================================

alter table public.corporal
  add column if not exists cadera numeric;   -- cm (en la parte más ancha)
