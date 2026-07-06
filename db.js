// ============================================================
//  db.js  —  Base de datos + funcionamiento sin internet
// ============================================================
//  Idea general:
//   - Todo lo que guardás va PRIMERO a la memoria del teléfono
//     (localStorage). Así funciona aunque no haya señal.
//   - Cuando hay internet, se sube a Supabase solo.
//   - El historial que ves es: lo que está en Supabase + lo que
//     todavía no se subió (pendiente).
// ============================================================

const LS_SYNCED  = "gym_synced";   // registros ya guardados en Supabase
const LS_PENDING = "gym_pending";  // registros esperando subir
const LS_USER    = "gym_last_user";
const LS_VIDEOS  = "gym_video_overrides"; // links de video editados desde la app

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let synced = load(LS_SYNCED, []);
let pending = load(LS_PENDING, []);
let client = null;        // cliente de Supabase (se crea cuando hay internet)
let statusCb = () => {};

const cfg = window.CONFIG || {};
const isConfigured = () =>
  cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.startsWith("PEGA_") &&
  !cfg.SUPABASE_ANON_KEY.startsWith("PEGA_");

// Crea el cliente de Supabase de forma perezosa (solo si hay internet).
async function getClient() {
  if (client) return client;
  if (!isConfigured() || !navigator.onLine) return null;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    return client;
  } catch (e) {
    return null; // sin internet o CDN no disponible: seguimos en modo local
  }
}

function setStatus(state, extra) {
  statusCb(state, { pending: pending.length, ...extra });
}

// ---- API pública ----

export const DB = {
  onStatus(cb) { statusCb = cb; },

  configured: isConfigured,

  getLastUser() { return load(LS_USER, null); },
  setLastUser(u) { store(LS_USER, u); },

  // Link de video editado a mano (se guarda en este teléfono).
  getVideoOverride(user, exId) {
    const o = load(LS_VIDEOS, {});
    return o[`${user}:${exId}`] ?? null;
  },
  setVideoOverride(user, exId, url) {
    const o = load(LS_VIDEOS, {});
    // "" se guarda a propósito: significa "ocultar el video" aunque el plan tenga uno.
    o[`${user}:${exId}`] = url || "";
    store(LS_VIDEOS, o);
  },

  // Todos los registros (subidos + pendientes)
  all() { return [...synced, ...pending]; },

  // Historial de un ejercicio para un usuario, más reciente arriba.
  history(user, exerciseId) {
    return this.all()
      .filter(r => r.usuario === user && r.ejercicio === exerciseId)
      .sort((a, b) => {
        if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
        return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
      });
  },

  // Guarda una carga. Devuelve el registro creado.
  async save(data) {
    const rec = {
      id: uuid(),
      created_at: new Date().toISOString(),
      _pending: true,
      ...data,
    };
    pending.push(rec);
    store(LS_PENDING, pending);
    setStatus("saved");
    this.sync(); // intenta subir (sin bloquear)
    return rec;
  },

  // Baja de Supabase todo lo que haya y refresca la memoria local.
  async refresh() {
    const c = await getClient();
    if (!c) return false;
    setStatus("syncing");
    const { data, error } = await c
      .from("registros")
      .select("*")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) { setStatus("error", { message: error.message }); return false; }
    synced = (data || []).map(r => ({ ...r, _pending: false }));
    store(LS_SYNCED, synced);
    // Si algún pendiente ya está en el servidor, lo sacamos de la cola.
    const serverIds = new Set(synced.map(r => r.id));
    pending = pending.filter(p => !serverIds.has(p.id));
    store(LS_PENDING, pending);
    setStatus("idle");
    return true;
  },

  // Sube los registros pendientes a Supabase.
  async sync() {
    if (pending.length === 0) return;
    const c = await getClient();
    if (!c) return; // sin internet: quedan en la cola
    setStatus("syncing");
    const cola = [...pending];
    for (const rec of cola) {
      const row = { ...rec };
      delete row._pending;
      const { error } = await c.from("registros").insert(row);
      // 23505 = clave duplicada = ya estaba subido -> lo damos por subido
      if (!error || error.code === "23505") {
        pending = pending.filter(p => p.id !== rec.id);
        synced.push({ ...rec, _pending: false });
        store(LS_PENDING, pending);
        store(LS_SYNCED, synced);
      } else {
        setStatus("error", { message: error.message });
        return; // paramos; reintentamos cuando vuelva la conexión
      }
    }
    setStatus("idle");
  },

  pendingCount() { return pending.length; },

  // Exporta TODO el historial a un objeto para respaldo.
  exportData() {
    return {
      exportado: new Date().toISOString(),
      total: this.all().length,
      registros: this.all().map(({ _pending, ...r }) => r),
    };
  },
};

// Cuando vuelve internet, intentamos sincronizar solos.
window.addEventListener("online", () => { DB.refresh().then(() => DB.sync()); });
