// ============================================================
//  db.js  —  Base de datos + funcionamiento sin internet
// ============================================================
//  Idea general:
//   - Todo (guardar, editar, borrar) pasa PRIMERO por la memoria
//     del teléfono (localStorage). Así funciona aunque no haya señal.
//   - Cada cambio se anota en una "cola de salida" (outbox).
//   - Cuando hay internet, la cola se envía a Supabase sola.
// ============================================================

const LS_RECORDS = "gym_records";  // vista local de los registros
const LS_OUTBOX  = "gym_outbox";   // cambios pendientes de enviar a Supabase
const LS_USER    = "gym_last_user";
const LS_VIDEOS  = "gym_video_overrides"; // links de video editados desde la app
const LS_PROFILE = "gym_profile";  // perfil del usuario logueado (slug, admin, mail)
const LS_OWNER   = "gym_owner_slug"; // de quién es la copia local (para no mezclar datos)

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) ?? fallback);
  } catch { return fallback; }
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

let records = load(LS_RECORDS, null);
let outbox  = load(LS_OUTBOX, []);

// Migración desde el formato anterior (gym_synced / gym_pending), si existiera.
if (records === null) {
  const oldSynced = load("gym_synced", []);
  const oldPending = load("gym_pending", []);
  records = [...oldSynced, ...oldPending].map(({ _pending, ...r }) => r);
  outbox = oldPending.map(({ _pending, ...r }) => ({ op: "insert", id: r.id, row: r }));
  store(LS_RECORDS, records);
  store(LS_OUTBOX, outbox);
}

let client = null;        // cliente de Supabase (se crea cuando hay internet)
let statusCb = () => {};

const cfg = window.CONFIG || {};
const isConfigured = () =>
  cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.startsWith("PEGA_") &&
  !cfg.SUPABASE_ANON_KEY.startsWith("PEGA_");
const authEnabled = () => isConfigured() && cfg.AUTH_ENABLED === true;

async function getClient() {
  if (client) return client;
  if (!isConfigured() || !navigator.onLine) return null;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: authEnabled()
        ? { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        : { persistSession: false },
    });
    return client;
  } catch (e) {
    return null; // sin internet o CDN no disponible: seguimos en modo local
  }
}

// Traduce los errores de login de Supabase a algo entendible.
function traducirAuth(error) {
  const m = (error?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Mail o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Todavía no confirmaste tu mail.";
  if (m.includes("password should be at least")) return "La contraseña es muy corta (mínimo 6 caracteres).";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Esperá un momento.";
  if (m.includes("user already registered")) return "Ese mail ya tiene cuenta.";
  return error?.message || "No se pudo completar. Probá de nuevo.";
}

// Si cambia el dueño de la copia local (y no es admin), limpiamos para no
// mezclar el historial de una persona con el de otra en el mismo teléfono.
function handleOwnerChange(slug, isAdmin) {
  const key = isAdmin ? "admin" : slug;
  const prev = load(LS_OWNER, null);
  if (prev && prev !== key && !isAdmin) {
    records = [];
    outbox = [];
    persist();
  }
  store(LS_OWNER, key);
}

function persist() { store(LS_RECORDS, records); store(LS_OUTBOX, outbox); }
function setStatus(state, extra) { statusCb(state, { pending: outbox.length, ...extra }); }
function isPending(id) { return outbox.some(o => o.id === id); }

// Devuelve los registros con la marca _pending calculada.
function view() { return records.map(r => ({ ...r, _pending: isPending(r.id) })); }

// ---- Cola de salida (outbox) ----
function queueInsert(rec) {
  outbox.push({ op: "insert", id: rec.id, row: { ...rec } });
}
function queueUpdate(id, fields) {
  const ins = outbox.find(o => o.id === id && o.op === "insert");
  if (ins) { Object.assign(ins.row, fields); return; }   // aún no subido: edito el insert
  const upd = outbox.find(o => o.id === id && o.op === "update");
  if (upd) { Object.assign(upd.fields, fields); return; }
  outbox.push({ op: "update", id, fields: { ...fields } });
}
function queueDelete(id) {
  const hadInsert = outbox.some(o => o.id === id && o.op === "insert");
  outbox = outbox.filter(o => o.id !== id);              // descarto insert/update pendientes
  if (!hadInsert) outbox.push({ op: "delete", id });     // si nunca se subió, no hay nada que borrar allá
}

// Reconstruye la vista local a partir de los datos del server + la cola pendiente.
function reapplyOutbox(serverRows) {
  const map = new Map(serverRows.map(r => [r.id, { ...r }]));
  for (const op of outbox) {
    if (op.op === "insert") map.set(op.id, { ...op.row });
    else if (op.op === "update") { const r = map.get(op.id); if (r) Object.assign(r, op.fields); }
    else if (op.op === "delete") map.delete(op.id);
  }
  return [...map.values()];
}

// ---- API pública ----
export const DB = {
  onStatus(cb) { statusCb = cb; },
  configured: isConfigured,
  authEnabled,

  // ---- Autenticación (login con mail + contraseña) ----
  getProfile() { return load(LS_PROFILE, null); },

  async initAuth() {
    // Devuelve el estado inicial de sesión: { session, profile }.
    const c = await getClient();
    if (!c) return { session: null, profile: this.getProfile() };
    const { data: { session } } = await c.auth.getSession();
    if (!session) { store(LS_PROFILE, null); return { session: null, profile: null }; }
    const profile = await this.loadProfile();
    return { session, profile };
  },

  onAuth(cb) {
    getClient().then(c => { if (c) c.auth.onAuthStateChange((event, session) => cb(event, session)); });
  },

  async signIn(email, password) {
    const c = await getClient();
    if (!c) return { error: "Sin conexión. Entrá con internet la primera vez." };
    const { error } = await c.auth.signInWithPassword({ email: (email || "").trim(), password });
    if (error) return { error: traducirAuth(error) };
    const profile = await this.loadProfile();
    return { ok: true, profile };
  },

  async updatePassword(password) {
    const c = await getClient();
    if (!c) return { error: "Sin conexión." };
    const { error } = await c.auth.updateUser({ password });
    if (error) return { error: traducirAuth(error) };
    const profile = await this.loadProfile();
    return { ok: true, profile };
  },

  async sendRecovery(email) {
    const c = await getClient();
    if (!c) return { error: "Sin conexión." };
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await c.auth.resetPasswordForEmail((email || "").trim(), { redirectTo });
    if (error) return { error: traducirAuth(error) };
    return { ok: true };
  },

  async signOut() {
    const c = await getClient();
    if (c) { try { await c.auth.signOut(); } catch {} }
    store(LS_PROFILE, null);
  },

  async loadProfile() {
    const c = await getClient();
    if (!c) return this.getProfile();
    const { data: { user } } = await c.auth.getUser();
    if (!user) { store(LS_PROFILE, null); return null; }
    const { data, error } = await c
      .from("perfiles").select("slug, es_admin, email").eq("id", user.id).maybeSingle();
    if (error || !data) {
      const p = { slug: null, es_admin: false, email: user.email, sinPerfil: true };
      store(LS_PROFILE, p); return p;
    }
    const p = { slug: data.slug, es_admin: !!data.es_admin, email: data.email || user.email };
    store(LS_PROFILE, p);
    handleOwnerChange(p.slug, p.es_admin);
    return p;
  },

  getLastUser() { return load(LS_USER, null); },
  setLastUser(u) { store(LS_USER, u); },

  getVideoOverride(user, exId) {
    const o = load(LS_VIDEOS, {});
    return o[`${user}:${exId}`] ?? null;
  },
  setVideoOverride(user, exId, url) {
    const o = load(LS_VIDEOS, {});
    o[`${user}:${exId}`] = url || "";
    store(LS_VIDEOS, o);
  },

  all() { return view(); },

  history(user, exerciseId) {
    return view()
      .filter(r => r.usuario === user && r.ejercicio === exerciseId)
      .sort((a, b) => {
        if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
        return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
      });
  },

  // Crear una carga.
  async save(data) {
    const rec = { id: uuid(), created_at: new Date().toISOString(), ...data };
    records.push(rec);
    queueInsert(rec);
    persist();
    setStatus("saved");
    this.sync();
    return rec;
  },

  // Editar una carga existente.
  async update(id, fields) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    Object.assign(r, fields);
    queueUpdate(id, fields);
    persist();
    setStatus("saved");
    this.sync();
  },

  // Eliminar una carga.
  async remove(id) {
    records = records.filter(x => x.id !== id);
    queueDelete(id);
    persist();
    setStatus("saved");
    this.sync();
  },

  // Baja de Supabase todo y reconstruye la vista local.
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
    records = reapplyOutbox(data || []);
    persist();
    setStatus(outbox.length ? "syncing" : "idle");
    if (outbox.length) this.sync();
    return true;
  },

  // Envía la cola de cambios a Supabase, en orden.
  async sync() {
    if (outbox.length === 0) return;
    const c = await getClient();
    if (!c) return; // sin internet: la cola espera
    setStatus("syncing");
    while (outbox.length) {
      const op = outbox[0];
      let error = null;
      if (op.op === "insert") {
        const { error: e } = await c.from("registros").insert(op.row);
        error = (e && e.code !== "23505") ? e : null; // 23505 = ya estaba subido
      } else if (op.op === "update") {
        const { error: e } = await c.from("registros").update(op.fields).eq("id", op.id);
        error = e;
      } else if (op.op === "delete") {
        const { error: e } = await c.from("registros").delete().eq("id", op.id);
        error = e;
      }
      if (error) { setStatus("error", { message: error.message }); return; }
      outbox.shift();
      store(LS_OUTBOX, outbox);
    }
    setStatus("idle");
  },

  pendingCount() { return outbox.length; },

  exportData() {
    const all = view();
    return {
      exportado: new Date().toISOString(),
      total: all.length,
      registros: all.map(({ _pending, ...r }) => r),
    };
  },
};

// Cuando vuelve internet, sincronizamos solos.
window.addEventListener("online", () => { DB.refresh().then(() => DB.sync()); });
