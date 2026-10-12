-- ============================================================
--  PASO 1 — Migración de IDs de ejercicios (por posición -> por nombre)
--  NO BORRA NADA. Guarda el código original en 'ejercicio_old'.
--  REQUISITO: tener el backup hecho (ver /backups/README.md).
--  Pegá TODO en Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Tabla de equivalencias (usuario + código viejo -> código nuevo)
create table if not exists public.equivalencias (
  usuario          text not null,
  ejercicio_old    text not null,
  ejercicio_nuevo  text not null,
  primary key (usuario, ejercicio_old)
);

-- 2) Cargar las equivalencias (se puede correr varias veces sin problema)
insert into public.equivalencias (usuario, ejercicio_old, ejercicio_nuevo) values
  ('tato','d1_back_squat','back_squat'),
  ('tato','d1_prensa','prensa'),
  ('tato','d1_jalon_prono','jalon_prono'),
  ('tato','d1_remo_maquina','remo_maquina'),
  ('tato','d1_quinto','curl_femoral'),
  ('tato','d1_sexto','press_inclinado_mancuernas'),
  ('tato','d2_hip_thrust_barra','hip_thrust_barra'),
  ('tato','d2_press_militar_mancuernas','press_militar_mancuernas'),
  ('tato','d2_vuelos_laterales','vuelos_laterales'),
  ('tato','d2_remo_polea_baja','remo_polea_baja'),
  ('tato','d2_superserie_biceps_triceps','superserie_curl_triceps_polea'),
  ('tato','d2_sexto','plancha_lateral'),
  ('tato','d3_estocadas_bulgaras','bulgaras'),
  ('tato','d3_jalon_o_remo','jalon_prono'),
  ('tato','d3_press_pecho_maquina','press_pecho_maquina'),
  ('tato','d3_ab_wheel','ab_wheel'),
  ('tato','d3_superserie_biceps_triceps','superserie_curl_triceps_extension'),
  ('tato','d3_sexto','vuelos_posteriores'),
  ('gabi','d1_back_squat','back_squat'),
  ('gabi','d1_prensa','prensa'),
  ('gabi','d1_jalon_prono','jalon_prono'),
  ('gabi','d1_remo_maquina','remo_maquina'),
  ('gabi','d1_quinto','hip_thrust_maquina'),
  ('gabi','d1_sexto','abduccion_maquina'),
  ('gabi','d2_hip_thrust_barra','hip_thrust_barra'),
  ('gabi','d2_press_militar_mancuernas','press_militar_mancuernas'),
  ('gabi','d2_vuelos_laterales','vuelos_laterales'),
  ('gabi','d2_remo_polea_baja','remo_polea_baja'),
  ('gabi','d2_superserie_biceps_triceps','superserie_curl_triceps_polea'),
  ('gabi','d2_sexto','peso_muerto_rumano_mancuernas'),
  ('gabi','d3_estocadas_bulgaras','bulgaras'),
  ('gabi','d3_jalon_o_remo','jalon_prono'),
  ('gabi','d3_press_pecho_maquina','press_pecho_maquina'),
  ('gabi','d3_ab_wheel','ab_wheel'),
  ('gabi','d3_superserie_biceps_triceps','superserie_curl_triceps_extension'),
  ('gabi','d3_sexto','frog_pump')
on conflict (usuario, ejercicio_old) do update set ejercicio_nuevo = excluded.ejercicio_nuevo;

-- 3) Guardar el código ORIGINAL (una sola vez, así nunca se pierde)
alter table public.registros add column if not exists ejercicio_old text;
update public.registros set ejercicio_old = ejercicio where ejercicio_old is null;

-- 4) Aplicar el código NUEVO, usando el original como referencia (repetible)
update public.registros r
set    ejercicio = e.ejercicio_nuevo
from   public.equivalencias e
where  e.usuario = r.usuario
  and  e.ejercicio_old = r.ejercicio_old;

-- 5) Para CONTROLAR el resultado (opcional): cuántas filas por ejercicio
-- select usuario, ejercicio_old, ejercicio, count(*)
-- from public.registros group by 1,2,3 order by 1,2;

-- ============================================================
--  PARA REVERTIR (si hiciera falta): vuelve al código viejo.
--  update public.registros set ejercicio = ejercicio_old;
-- ============================================================
