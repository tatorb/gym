# Backups y restauración

Esta carpeta guarda copias de seguridad de la base de datos (Supabase), con fecha.

## Cómo hacer un backup (lo hace Tato, 2 minutos)

**A) Desde Supabase (el backup oficial):**
1. Supabase → **Table Editor** → tabla **`registros`**.
2. Arriba a la derecha: **Export** → **Export table as CSV**.
3. Guardá el archivo en una subcarpeta con la fecha, por ej. `backups/2026-10-12/registros.csv`.

**B) Desde la app (rápido):**
1. App → pantalla de días → botón **⤓** → **Respaldo (JSON)**.
2. Guardá el archivo junto al anterior, por ej. `backups/2026-10-12/respaldo-gym.json`.

> Hoy la única tabla con datos es `registros`. Si más adelante se crean otras
> (perfiles, registro corporal, etc.), se exportan igual, una por una.

## Cómo restaurar (si algo saliera mal)

1. Supabase → **Table Editor** → tabla **`registros`** → **Insert** → **Import data from CSV**.
2. Elegí el `registros.csv` del backup. Supabase vuelve a cargar esas filas.
   (Si hay filas con el mismo `id`, elegí actualizar; el `id` es único.)

La estrategia de la migración es **no borrar nunca** el historial: se trabaja con
columnas nuevas y copias, así el backup es una red de seguridad, no el plan principal.
