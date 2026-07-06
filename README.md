# 🏋️ Gym · Tato & Gabi

App de seguimiento de entrenamiento para dos personas. Funciona en el teléfono,
se instala como una app, y guarda todo en la nube (Supabase). Sin login: solo
elegís **Tato** o **Gabi**.

Esta guía está pensada para alguien que **no programa**. Seguí los pasos en orden.
Cada vez que aparezca una **palabra técnica** te la explico entre paréntesis.

---

## 📁 Qué es cada archivo (para ubicarte)

No necesitás entenderlos todos. Los que **quizás quieras tocar** son solo dos:

| Archivo | Para qué sirve | ¿Lo vas a tocar? |
|---|---|---|
| `config.js` | Donde pegás tus 2 claves de Supabase | **SÍ**, una vez |
| `plan.json` | El plan de entrenamiento (días y ejercicios) | Cuando quieras cambiar el plan |
| `supabase_setup.sql` | Texto que copiás y pegás en Supabase para crear la base | **SÍ**, una vez |
| `index.html`, `styles.css`, `app.js`, `db.js` | El código de la app | No hace falta |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | Hacen que se instale como app | No hace falta |

---

## PARTE 1 · Crear la base de datos en Supabase

**¿Qué es Supabase?** Es un servicio gratuito que te da una **base de datos**
(una planilla gigante en la nube) a la que la app se conecta para guardar y leer
tus cargas. Vos y Gabi entran desde teléfonos distintos y ven **los mismos datos**.

### Paso 1.1 — Crear la cuenta y el proyecto
1. Entrá a **https://supabase.com** y tocá **"Start your project"**.
2. Registrate con tu cuenta de GitHub o con email. Es gratis.
3. Ya adentro, tocá **"New project"**.
4. Completá:
   - **Name** (nombre): `gym` (o lo que quieras).
   - **Database Password** (contraseña de la base): poné una contraseña y
     **guardala en un lugar seguro**. No la vas a usar en la app, pero Supabase
     la pide. Si la perdés no pasa nada grave, se puede resetear.
   - **Region** (región): elegí la más cercana, por ejemplo *South America (São Paulo)*.
5. Tocá **"Create new project"** y esperá 1–2 minutos a que diga que está listo.

### Paso 1.2 — Crear la tabla (con un copiar y pegar)
1. En el menú de la izquierda, tocá **"SQL Editor"** (el ícono de base de datos con `>_`).
2. Tocá **"New query"**.
3. Abrí el archivo **`supabase_setup.sql`** de este proyecto, copiá **todo** su
   contenido y pegalo en el editor.
4. Tocá **"Run"** (o `Ctrl+Enter`).
5. Si abajo dice **"Success"**, ¡listo! Ya tenés la tabla `registros` creada con
   los permisos correctos.

> **¿Qué acabás de hacer?** Creaste una tabla llamada `registros`. Cada fila va a
> ser una carga tuya o de Gabi: fecha, usuario, día, ejercicio, kg, RIR y nota.
> También le diste permiso a la app para leer y escribir sin necesidad de login.

### Paso 1.3 — Conseguir las 2 claves de conexión
La app necesita 2 datos para conectarse. Los buscás así:
1. En el menú de la izquierda, abajo de todo, tocá el engranaje **"Project Settings"**.
2. Tocá **"API"** (o **"API Keys"** / **"Data API"** según la versión).
3. Vas a ver estos dos valores. **Copialos:**

| Nombre en Supabase | Qué es | Cómo se ve |
|---|---|---|
| **Project URL** | La dirección de tu base de datos en internet. | `https://abcdefgh.supabase.co` |
| **anon public** (API Key) | Una clave pública que permite a la app leer y guardar datos. | Un texto largo que empieza con `eyJ...` |

> **¿Es peligroso que la clave `anon` quede pública en GitHub?**
> **No.** Esa clave está *diseñada* para ir en el navegador de la app. No es la
> clave de administrador. Los permisos reales los pusiste vos con el SQL del
> Paso 1.2. **Nunca uses la clave `service_role`** (esa sí es secreta) — la app
> no la necesita.

### Paso 1.4 — Pegar las claves en la app
1. Abrí el archivo **`config.js`** de este proyecto.
2. Reemplazá los dos textos entre comillas:
   - En `SUPABASE_URL` pegá el **Project URL**.
   - En `SUPABASE_ANON_KEY` pegá la clave **anon public**.
3. Guardá el archivo. Debería quedar así (con tus valores):

```js
window.CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
};
```

✅ Con esto la app ya sabe a qué base conectarse.

---

## PARTE 2 · Subir el proyecto a GitHub y publicarlo gratis

**¿Qué es GitHub Pages?** Es un servicio gratuito de GitHub que agarra tus
archivos y los publica como una **página web con una dirección propia** (una URL).
Ahí va a vivir tu app.

### Paso 2.1 — Subir los archivos a GitHub
Si estás leyendo esto es porque el proyecto ya está en un repositorio de GitHub.
Solo asegurate de que estos archivos estén subidos (ya lo están si ves este README online):
`index.html`, `config.js` (con tus claves), `plan.json`, y las carpetas del proyecto.

> Si tuvieras que subirlo a mano: en la página del repositorio, botón **"Add file"
> → "Upload files"**, arrastrás todos los archivos, y **"Commit changes"**.

### Paso 2.2 — Activar GitHub Pages
1. En tu repositorio de GitHub, tocá la pestaña **"Settings"** (arriba a la derecha).
2. En el menú de la izquierda, tocá **"Pages"**.
3. En **"Source"** (fuente) elegí **"Deploy from a branch"** (publicar desde una rama).
4. En **"Branch"** (rama) elegí la rama donde están tus archivos:
   - Normalmente `main`. Si tu proyecto está en otra rama, elegila.
   - Al lado, dejá **`/ (root)`**.
5. Tocá **"Save"**.
6. Esperá 1–2 minutos y recargá la página. Va a aparecer un cartel verde con la
   dirección de tu app, tipo:
   **`https://TU-USUARIO.github.io/gym/`**
7. Abrí esa dirección en el teléfono. ¡Ahí está tu app online! 🎉

> **Nota:** cada vez que cambies un archivo y lo subas, GitHub Pages actualiza la
> app sola en 1–2 minutos. Si no ves el cambio, cerrá y abrí la app, o esperá un
> poco (a veces el teléfono guarda una copia vieja).

---

## PARTE 3 · Probar que Supabase guarda bien (antes del gimnasio)

Hacé esta prueba **con internet** (wifi o datos), no en modo avión:

1. Abrí la app en el teléfono (la dirección de GitHub Pages).
2. **Importante:** en la pantalla de inicio **NO** debe aparecer el cartel naranja
   que dice *"Falta configurar Supabase"*. Si aparece, revisá el Paso 1.4 (las
   claves en `config.js`).
3. Elegí **Tato**, entrá a **Día 1**, cargá un ejercicio de prueba (kg y RIR) y
   tocá **Guardar**.
4. Andá a **Supabase → menú izquierdo "Table Editor" → tabla `registros`**.
5. **Deberías ver ahí la fila que acabás de cargar** (con usuario `tato`, el kg,
   el RIR, etc.). ✅ Si la ves, ¡Supabase está guardando bien!
6. Prueba final de "los dos ven lo mismo": pedile a Gabi que abra la misma
   dirección en **su** teléfono, elija **Tato**, y entre al mismo ejercicio.
   Debería ver en el **Historial** la carga que hiciste vos. ✅

> Si algo no aparece: revisá que corriste el SQL del Paso 1.2 completo y que las
> claves de `config.js` son las correctas (URL y `anon public`).

---

## PARTE 4 · Instalar la app en el teléfono (PWA)

**¿Qué es una PWA?** Es una web que se puede **instalar como si fuera una app**:
queda con su ícono en la pantalla de inicio y abre a pantalla completa, sin la
barra del navegador.

### En Android (Chrome)
1. Abrí la dirección de la app en **Chrome**.
2. Tocá el menú **⋮** (arriba a la derecha).
3. Tocá **"Instalar app"** o **"Agregar a pantalla de inicio"**.
4. Confirmá. Aparece el ícono de la mancuerna en tu pantalla de inicio.

### En iPhone (Safari)
1. Abrí la dirección de la app en **Safari** (tiene que ser Safari).
2. Tocá el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Deslizá y tocá **"Agregar a inicio"** (*Add to Home Screen*).
4. Tocá **"Agregar"**. Aparece el ícono en tu pantalla de inicio.

Listo: ahora abrís la app tocando su ícono, como cualquier otra app.

---

## PARTE 5 · Uso diario y funciones extra

- **Elegir usuario:** la app recuerda el último (Tato o Gabi) y entra directo.
  Para cambiar, tocá la flecha **‹** arriba a la izquierda.
- **Pasar de ejercicio:** deslizá el dedo (**swipe**) a la izquierda/derecha, o
  usá las **flechas ‹ ›** de abajo. Los **puntos** te muestran en qué ejercicio
  estás (ej: 3 de 6).
- **Guardar:** al terminar el **último** ejercicio del día, aparece un **resumen**
  de toda la sesión.
- **Sin internet en el gimnasio:** cargá tranquilo. La app **guarda en el teléfono**
  (vas a ver un cartel naranja y un ⏳ en el historial). Cuando volvés a tener
  señal, **sube todo solo** a Supabase.

### Exportar un respaldo (backup)
- En la pantalla de días, tocá el ícono **⤓** (arriba a la derecha).
- Se descarga un archivo **`respaldo-gym-AAAA-MM-DD.json`** con **todo** el historial.
- **¿Dónde queda?** En la carpeta de **Descargas** de tu teléfono (o donde tu
  navegador guarde las descargas). Guardalo en Google Drive / iCloud si querés
  tenerlo a salvo.

---

## PARTE 6 · Editar el plan de entrenamiento

El plan vive en **`plan.json`**. Lo podés editar a mano en GitHub:
1. Abrí `plan.json` en tu repositorio → ícono del **lápiz** (Edit).
2. Cada ejercicio tiene: `nombre`, `series`, `reps`, `indicacion`.
3. Si un ejercicio es distinto para Tato y Gabi, se usa `variantes`:
   ```json
   "variantes": {
     "gabi": { "nombre": "Hip thrust en máquina", "series": 3, "reps": "10-12", "indicacion": "..." },
     "tato": { "nombre": "Curl femoral", "series": 3, "reps": "10", "indicacion": "..." }
   }
   ```
4. Si querés una nota solo para uno en un ejercicio compartido, se usa `notas`:
   ```json
   "notas": { "tato": "Opcional: fondos en paralelas 3 × máximas." }
   ```
5. **Importante:** el `id` de cada ejercicio **no se debe cambiar** una vez que ya
   cargaste datos, porque el historial se guarda por ese `id`. Si cambiás el `id`,
   se "desconecta" del historial viejo.
6. Guardá (**Commit changes**). En 1–2 minutos el plan nuevo aparece en la app.

---

## ❓ Problemas comunes

- **Cartel naranja "Falta configurar Supabase":** las claves de `config.js` están
  vacías o mal pegadas. Revisá el Paso 1.4.
- **No se ven las cargas en el otro teléfono:** asegurate de que ambos tengan
  internet y de que corriste el SQL del Paso 1.2.
- **Cambié algo y no se actualiza:** esperá 1–2 minutos (GitHub Pages) y cerrá/abrí
  la app. La PWA a veces guarda una copia; volver a abrirla la refresca.
- **Quiero empezar el historial de cero:** en Supabase, Table Editor → `registros`
  → seleccionás las filas y las borrás. (Guardá antes un respaldo con ⤓.)
