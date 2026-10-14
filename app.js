// ============================================================
//  app.js  —  Lógica de la aplicación
// ============================================================
import { DB } from "./db.js";

let PLAN = null;
let currentUser = null;     // 'tato' | 'gabi'
let currentDay = null;      // objeto del día
let exercises = [];         // ejercicios resueltos del día para el usuario
let currentIndex = 0;
let PROFILE = null;         // perfil del usuario logueado (si hay login)

// Tipo de link de auth con el que se abrió la app (invitación / recuperación).
// Se lee ANTES de que Supabase consuma el hash de la URL.
const AUTH_HASH = (() => {
  const m = (window.location.hash || "").match(/[#&]type=([a-z_]+)/i);
  return m ? m[1].toLowerCase() : null;
})();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Equivalencias de IDs viejos -> nuevos (por usuario). Sirve para que el
// historial cargado con los códigos viejos siga apareciendo, aunque todavía
// no se haya corrido la migración en Supabase.
const EQUIV = {
  tato: {
    d1_back_squat:"back_squat", d1_prensa:"prensa", d1_jalon_prono:"jalon_prono",
    d1_remo_maquina:"remo_maquina", d1_quinto:"curl_femoral", d1_sexto:"press_inclinado_mancuernas",
    d2_hip_thrust_barra:"hip_thrust_barra", d2_press_militar_mancuernas:"press_militar_mancuernas",
    d2_vuelos_laterales:"vuelos_laterales", d2_remo_polea_baja:"remo_polea_baja",
    d2_superserie_biceps_triceps:"superserie_curl_triceps_polea", d2_sexto:"plancha_lateral",
    d3_estocadas_bulgaras:"bulgaras", d3_jalon_o_remo:"jalon_prono", d3_press_pecho_maquina:"press_pecho_maquina",
    d3_ab_wheel:"ab_wheel", d3_superserie_biceps_triceps:"superserie_curl_triceps_mancuernas", d3_sexto:"vuelos_posteriores",
  },
  gabi: {
    d1_back_squat:"back_squat", d1_prensa:"prensa", d1_jalon_prono:"jalon_prono",
    d1_remo_maquina:"remo_maquina", d1_quinto:"hip_thrust_maquina", d1_sexto:"abduccion_maquina",
    d2_hip_thrust_barra:"hip_thrust_barra", d2_press_militar_mancuernas:"press_militar_mancuernas",
    d2_vuelos_laterales:"vuelos_laterales", d2_remo_polea_baja:"remo_polea_baja",
    d2_superserie_biceps_triceps:"superserie_curl_triceps_polea", d2_sexto:"peso_muerto_rumano_mancuernas",
    d3_estocadas_bulgaras:"bulgaras", d3_jalon_o_remo:"jalon_prono", d3_press_pecho_maquina:"press_pecho_maquina",
    d3_ab_wheel:"ab_wheel", d3_superserie_biceps_triceps:"superserie_curl_triceps_mancuernas", d3_sexto:"frog_pump",
  },
};
// Todos los IDs (nuevo + viejos equivalentes) a buscar en el historial.
function histIds(user, newId) {
  const map = EQUIV[user] || {};
  const ids = new Set([newId]);
  for (const oldId in map) if (map[oldId] === newId) ids.add(oldId);
  return ids;
}
// Historial de un ejercicio (por id nuevo), uniendo los códigos viejos equivalentes.
function exHistory(user, newId) {
  const ids = histIds(user, newId);
  return DB.all()
    .filter(r => r.usuario === user && ids.has(r.ejercicio))
    .sort((a, b) => a.fecha !== b.fecha ? (a.fecha < b.fecha ? 1 : -1)
      : ((a.created_at || "") < (b.created_at || "") ? 1 : -1));
}

function hoyISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function fechaCorta(iso) {
  // iso: '2026-07-06'
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

// Resuelve un ejercicio del plan para un usuario.
// IDs por nombre (compartidos). Admite 'variantes' por persona (ej. Gabi: dead bug).
// Tato ve objetivos; Gabi no.
function resolveExercise(ex, user) {
  let base = ex;
  if (ex.variantes && ex.variantes[user]) base = { ...ex, ...ex.variantes[user] };
  const ss = Array.isArray(base.superset) && base.superset.length === 2 ? base.superset : null;
  return {
    id: base.id || ex.id,
    nombre: base.nombre,
    series: base.series != null ? base.series : (ss ? ss[0].series : undefined),
    reps: base.reps != null ? base.reps : (ss ? ss[0].reps : undefined),
    rir: base.rir != null ? base.rir : null,
    indicacion: base.indicacion || "",
    notaUsuario: null,
    medida: base.medida || "kg",
    video: base.video || null,
    superset: ss ? ss.map(m => m.nombre) : null,   // nombres para el formulario
    supersetDetalle: ss,                           // series/reps por movimiento
    repsVar: !ss && /\d\s*-\s*\d/.test(String(base.reps || "")),
    prescrito: true,                               // ahora los dos tienen series/reps/RIR
  };
}
// Lista de ejercicios de un día para un usuario (Gabi puede tener su propia lista).
function listaDe(dia, user) {
  return (user === "gabi" && Array.isArray(dia.ejerciciosGabi)) ? dia.ejerciciosGabi : (dia.ejercicios || []);
}
function objetivo(ex) {
  if (ex.supersetDetalle) return ex.supersetDetalle.map(m => `${m.series}×${m.reps}`).join(" + ");
  const base = (ex.reps != null && ex.reps !== "") ? `${ex.series} × ${ex.reps}` : `${ex.series} series`;
  return ex.rir != null ? `${base} · RIR ${ex.rir}` : base;
}
// Texto del bloque de 5 semanas para hoy (solo Tato). null si no aplica.
function bloqueActual() {
  const b = PLAN.bloque;
  if (!b || !b.inicio || !Array.isArray(b.reglas) || !b.reglas.length) return null;
  const start = Date.parse(b.inicio + "T00:00:00");
  const now = Date.parse(hoyISO() + "T00:00:00");
  if (isNaN(start) || now < start) return null;
  const semanas = b.semanas || b.reglas.length;
  const idx = Math.floor((now - start) / (7 * 86400000)) % semanas;
  return { n: idx + 1, texto: b.reglas[idx] || "" };
}

// Si la URL es de YouTube, devuelve el ID del video; si no, null.
function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean); // embed/ID, shorts/ID, v/ID, live/ID
      const i = parts.findIndex(p => ["embed", "shorts", "v", "live"].includes(p));
      if (i >= 0 && parts[i + 1]) return parts[i + 1];
    }
    return null;
  } catch {
    return null;
  }
}

// El video efectivo: primero el link editado a mano, si no el del plan.
//  - sin override (null)      -> usa el del plan
//  - override "" (ocultado)   -> sin video
//  - override con link        -> usa ese link
function effectiveVideo(ex) {
  const ov = DB.getVideoOverride(currentUser, ex.id);
  if (ov === null) return ex.video || null;
  return ov || null;
}

// HTML del reproductor de YouTube embebido.
function ytEmbedHTML(id) {
  return `<div class="video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1&playsinline=1"
      title="Video del ejercicio" loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen></iframe>
  </div>`;
}

// Construye el bloque de video de una tarjeta de ejercicio.
function buildVideoBlock(ex) {
  const wrap = document.createElement("div");
  wrap.className = "video-block";
  renderVideoInto(wrap, ex);
  return wrap;
}

function renderVideoInto(wrap, ex) {
  wrap.innerHTML = "";
  const url = effectiveVideo(ex);

  // Sin video: opción discreta para agregar uno.
  if (!url) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "video-add";
    add.textContent = "➕ Agregar video";
    add.addEventListener("click", () => editVideo(ex, wrap));
    wrap.appendChild(add);
    return;
  }

  const id = youtubeId(url);
  const player = document.createElement("div");
  player.className = "video-player";
  if (id) {
    // YouTube: portada; al tocar se embebe el reproductor.
    player.innerHTML = `
      <button type="button" class="video-facade">
        <span class="video-play">▶</span>
        <span class="video-label">Ver video</span>
      </button>`;
    player.querySelector("button").addEventListener("click", () => {
      player.innerHTML = ytEmbedHTML(id);
    });
  } else {
    // Otro sitio: no se embebe, solo botón que abre el link.
    const a = document.createElement("a");
    a.className = "video-link-btn";
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.innerHTML = `▶ Ver video <span class="video-link-hint">(abre en otra pestaña)</span>`;
    player.appendChild(a);
  }
  wrap.appendChild(player);

  // Fila de opciones
  const actions = document.createElement("div");
  actions.className = "video-actions";

  if (id) {
    const fs = document.createElement("button");
    fs.type = "button"; fs.className = "vaction";
    fs.innerHTML = "⤢ Pantalla completa";
    fs.addEventListener("click", () => openFullscreen(player, id));
    actions.appendChild(fs);
  }

  const yt = document.createElement("a");
  yt.className = "vaction"; yt.target = "_blank"; yt.rel = "noopener noreferrer";
  yt.href = id ? `https://www.youtube.com/watch?v=${id}` : url;
  yt.innerHTML = id ? "↗ YouTube" : "↗ Abrir link";
  actions.appendChild(yt);

  const ed = document.createElement("button");
  ed.type = "button"; ed.className = "vaction";
  ed.innerHTML = "✎ Editar link";
  ed.addEventListener("click", () => editVideo(ex, wrap));
  actions.appendChild(ed);

  wrap.appendChild(actions);
}

// Editar / agregar / quitar el link del video (se guarda en este teléfono).
function editVideo(ex, wrap) {
  const ov = DB.getVideoOverride(currentUser, ex.id);
  const actual = ov === null ? (ex.video || "") : ov;
  const nuevo = prompt(
    "Pegá el link del video (YouTube u otro sitio).\nDejalo vacío para quitar el video.",
    actual
  );
  if (nuevo === null) return; // canceló
  const val = nuevo.trim();
  DB.setVideoOverride(currentUser, ex.id, val);
  renderVideoInto(wrap, ex);
  toast(val ? "Video actualizado en este teléfono" : "Video quitado");
}

// Pantalla completa del reproductor.
function openFullscreen(player, id) {
  let frame = player.querySelector(".video-frame");
  if (!frame) {                       // si aún no se cargó, lo cargamos
    player.innerHTML = ytEmbedHTML(id);
    frame = player.querySelector(".video-frame");
  }
  const req = frame.requestFullscreen || frame.webkitRequestFullscreen;
  if (req) {
    try { req.call(frame); } catch { /* ignorar */ }
  } else {
    // iPhone no permite pantalla completa por código: se usa el botón del reproductor.
    toast("Tocá ▶ y usá el botón de pantalla completa del video");
  }
}

// Etiqueta/unidad de cada tipo de medida.
const MEDIDAS = { kg: "Kg", reps: "Reps", seg: "Seg" };
const UNIDAD = { kg: "kg", reps: "reps", seg: "seg" };

// ---------- Formulario de carga (compartido por tarjeta, popup y edición) ----------
const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };

// Genera el HTML de los campos (toggle + peso(s) + RIR + nota).
// En superseries muestra dos pesos (uno por movimiento) y un solo RIR.
function fieldsHTML(ids, ex, init) {
  const med = init.medida || ex.medida || "kg";
  const ss = ex.superset;
  const num = v => (v === null || v === undefined) ? "" : v;
  let h = "";
  if (!ss) {
    h += `<div class="metric-toggle" id="${ids.toggle}" data-medida="${med}">
      ${Object.keys(MEDIDAS).map(m =>
        `<button type="button" data-m="${m}" class="${m === med ? "on" : ""}">${MEDIDAS[m]}</button>`).join("")}
    </div>`;
  }
  // Campos numéricos: todos en un solo renglón. La nota va en el segundo.
  if (ss) {
    h += `<div class="input-row">
      <div class="field"><label>${ss[0]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val}" value="${num(init.val)}" placeholder="kg" /></div>
      <div class="field"><label>${ss[1]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val2}" value="${num(init.val2)}" placeholder="kg" /></div>
      <div class="field"><label>RIR</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.rir}" value="${num(init.rir)}" placeholder="1" /></div>
    </div>`;
  } else if (ex.repsVar) {
    // Peso + reps hechas + RIR, en un renglón. Reps solo aplica cuando la medida es peso.
    const showReps = med === "kg" ? "" : "display:none";
    h += `<div class="input-row">
      <div class="field"><label id="${ids.vlabel}">${MEDIDAS[med]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val}" value="${num(init.val)}" placeholder="—" /></div>
      <div class="field" id="${ids.repsField}" style="${showReps}"><label>Reps</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.reps}" value="${num(init.reps)}" placeholder="—" /></div>
      <div class="field"><label>RIR</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.rir}" value="${num(init.rir)}" placeholder="—" /></div>
    </div>`;
  } else {
    h += `<div class="input-row">
      <div class="field"><label id="${ids.vlabel}">${MEDIDAS[med]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val}" value="${num(init.val)}" placeholder="—" /></div>
      <div class="field"><label>RIR</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.rir}" value="${num(init.rir)}" placeholder="—" /></div>
    </div>`;
  }
  h += `<div class="field full"><label>Nota (opcional)</label>
    <textarea id="${ids.nota}" placeholder="Ej: subí 2.5 kg, buena técnica">${init.nota ? String(init.nota).replace(/</g, "&lt;") : ""}</textarea></div>`;
  return h;
}

// Conecta el toggle Kg/Reps/Seg (si existe) dentro de un contenedor.
function attachToggle(root, ids) {
  const toggleEl = root.querySelector(`#${ids.toggle}`);
  if (!toggleEl) return;
  toggleEl.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      const m = b.dataset.m;
      toggleEl.dataset.medida = m;
      toggleEl.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      const vl = root.querySelector(`#${ids.vlabel}`);
      if (vl) vl.textContent = MEDIDAS[m];
      // El campo "Reps hechas" solo aplica cuando la medida es peso (kg).
      const rf = root.querySelector(`#${ids.repsField}`);
      if (rf) rf.style.display = (m === "kg") ? "" : "none";
    });
  });
}

// Lee los valores de un conjunto de campos.
function readFields(ids, ex) {
  const ss = !!ex.superset;
  const toggleEl = document.getElementById(ids.toggle);
  const medida = ss ? (ex.medida || "kg") : (toggleEl?.dataset.medida || "kg");
  const g = id => (document.getElementById(id)?.value || "").trim();
  return {
    superset: ss,
    medida,
    val: g(ids.val),
    val2: ss ? g(ids.val2) : "",
    reps: (ex.repsVar && medida === "kg") ? g(ids.reps) : "",
    rir: g(ids.rir),
    nota: g(ids.nota),
  };
}

// Convierte lo leído a las columnas de la base.
function toDbFields(f) {
  return {
    medida: f.medida,
    kg: f.val === "" ? null : Number(f.val),
    kg2: f.superset ? (f.val2 === "" ? null : Number(f.val2)) : null,
    reps: f.reps !== "" ? Number(f.reps) : null,   // reps realmente hechas (rango)
    rir: f.rir !== "" ? Number(f.rir) : (f.superset ? 1 : null), // en superserie el RIR es 1 por defecto
    nota: f.nota || null,
  };
}

// Ids de los campos de la tarjeta de un ejercicio.
const cardIds = (i) => ({
  toggle: `toggle-${i}`, vlabel: `vlabel-${i}`,
  val: `val-${i}`, val2: `val2-${i}`, reps: `reps-${i}`, repsField: `repsfield-${i}`,
  rir: `rir-${i}`, nota: `nota-${i}`,
});

// ---------------- Navegación entre pantallas ----------------
function showScreen(name) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
  window.scrollTo(0, 0);
}

// ---------------- Toast / estado ----------------
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

let syncError = null;

function renderStatusBar() {
  const bar = $("#statusBar");
  const p = DB.pendingCount();
  bar.onclick = null;
  if (!navigator.onLine) {
    bar.className = "status-bar offline";
    bar.textContent = p > 0
      ? `Sin conexión · ${p} carga${p > 1 ? "s" : ""} se subir${p > 1 ? "án" : "á"} a Supabase al volver la señal`
      : "Sin conexión · lo que cargues se subirá a Supabase al volver la señal";
    bar.classList.remove("hidden");
  } else if (syncError) {
    bar.className = "status-bar error";
    bar.textContent = `⚠️ No se pudo subir a Supabase (${p} pendiente${p > 1 ? "s" : ""}). Tocá para ver el motivo.`;
    bar.onclick = () => alert(
      "Error al sincronizar con Supabase:\n\n" + syncError +
      "\n\nSi el mensaje menciona una columna que no existe " +
      "(por ejemplo \"kg2\" o \"reps\"), abrí Supabase → SQL Editor y corré:\n\n" +
      "alter table public.registros add column if not exists medida text not null default 'kg';\n" +
      "alter table public.registros add column if not exists kg2 numeric;\n" +
      "alter table public.registros add column if not exists reps numeric;"
    );
    bar.classList.remove("hidden");
  } else if (p > 0) {
    bar.className = "status-bar syncing";
    bar.textContent = `Guardando en Supabase… (${p})`;
    bar.classList.remove("hidden");
  } else if (!DB.configured()) {
    bar.className = "status-bar offline";
    bar.textContent = "Falta configurar Supabase (ver README). Por ahora se guarda solo en el teléfono.";
    bar.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
  }
}

DB.onStatus((state, detail) => {
  if (state === "error") syncError = (detail && detail.message) || "Error desconocido";
  else if (state === "idle") syncError = null;
  renderStatusBar();
});
window.addEventListener("online", renderStatusBar);
window.addEventListener("offline", renderStatusBar);

// Íconos SVG (línea, heredan el color con currentColor)
const ICONS = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
};

// ---------------- Elegir usuario ----------------
function selectUser(user) {
  currentUser = user;
  DB.setLastUser(user);
  document.body.dataset.user = user;
  $("#days-user-name").textContent = PLAN.usuarios[user]?.nombre || user;
  renderDays();
  showScreen("days");
  DB.refresh(); // trae el historial del servidor si hay internet
}

// ¿Cuántos días pasaron desde una fecha hasta hoy?
function daysAgoFrom(fecha) {
  const d1 = Date.parse(fecha + "T00:00:00Z");
  const d2 = Date.parse(hoyISO() + "T00:00:00Z");
  return Math.round((d2 - d1) / 86400000);
}
function fraseHace(n) {
  if (n <= 0) return "hoy";
  if (n === 1) return "ayer";
  return `hace ${n} días`;
}
function lastSessionDate(user, diaId) {
  const fechas = DB.all().filter(r => r.usuario === user && r.dia === diaId).map(r => r.fecha).sort();
  return fechas.length ? fechas[fechas.length - 1] : null;
}
// Día del plan que corresponde a hoy (según el día de la semana).
const WEEKDAY_ID = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
function todayDayId() { return WEEKDAY_ID[new Date().getDay()]; }

// ---------------- Menú de días ----------------
function renderDays() {
  const nombre = PLAN.usuarios[currentUser]?.nombre || currentUser || "";
  $("#greeting-name").textContent = nombre;
  $("#greeting-avatar").textContent = (nombre.charAt(0) || "?").toUpperCase();

  // Saludo: último registro general (de cualquier día).
  const todas = DB.all().filter(r => r.usuario === currentUser).map(r => r.fecha).sort();
  const sub = $(".greeting-sub");
  sub.textContent = todas.length
    ? `Último registro: ${fraseHace(daysAgoFrom(todas[todas.length - 1]))}`
    : "¡Arrancá tu primer entreno! 💪";

  const hoyId = todayDayId();
  const cont = $("#days-list");
  cont.innerHTML = "";
  PLAN.dias.forEach((dia, i) => {
    const tipo = dia.tipo || "entreno";
    const hoy = dia.id === hoyId;
    const card = document.createElement("button");
    card.className = `day-card day-${tipo}` + (hoy ? " day-due" : "");
    card.style.animationDelay = `${i * 60}ms`;
    let badge, linea, subTexto = dia.subtitulo || "";
    if (tipo === "entreno") {
      const last = lastSessionDate(currentUser, dia.id);
      badge = ICONS.dumbbell;
      linea = `${listaDe(dia, currentUser).length} ejercicios · ${last !== null ? "último " + fraseHace(daysAgoFrom(last)) : "sin registros"}`;
    } else if (tipo === "cardio") {
      const last = lastSessionDate(currentUser, dia.id);
      badge = "🚶";
      subTexto = opcionesDe(dia, currentUser).join(" o ");  // Gabi nunca ve "Fútbol"
      linea = last !== null ? "último " + fraseHace(daysAgoFrom(last)) : "sin marcar";
    } else {
      badge = "☾"; linea = "Descanso";
    }
    card.innerHTML = `
      <div class="day-badge">${badge}</div>
      <div class="day-body">
        <span class="day-name">${dia.nombre}${hoy ? `<span class="due-badge">Hoy</span>` : ""}</span>
        <span class="day-sub">${subTexto}</span>
        <span class="day-count">${linea}</span>
      </div>
      ${tipo === "entreno" ? `<div class="day-chevron">${ICONS.chevron}</div>` : ""}`;
    if (tipo === "entreno" && dia.caminataAlt) card.addEventListener("click", () => openEntrenoOActividad(dia));
    else if (tipo === "entreno") card.addEventListener("click", () => openDay(dia));
    else if (tipo === "cardio") card.addEventListener("click", () => openActividadChoice(dia));
    else card.addEventListener("click", () => toast("Día de descanso ☾"));
    cont.appendChild(card);
  });
}

// ---------------- Abrir un día ----------------
function openDay(dia) {
  currentDay = dia;
  exercises = listaDe(dia, currentUser).map(ex => resolveExercise(ex, currentUser));
  currentIndex = 0;
  $("#ex-day-name").textContent = `${dia.nombre} · ${dia.subtitulo || ""}`;
  renderBlockBanner();
  renderExercises();
  renderDots();
  renderUserSwitch();
  refreshDoneDots();
  showScreen("exercise");
  requestAnimationFrame(() => scrollToIndex(0, false));
  DB.refresh().then(ok => { if (ok) refreshVisibleHistories(); });
}

// Banner del bloque de 5 semanas (solo Tato).
function renderBlockBanner() {
  const el = $("#block-banner");
  if (!el) return;
  const b = bloqueActual();   // el bloque de 5 semanas aplica a los dos
  if (!b) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  el.innerHTML = `<span class="bb-week">S${b.n}</span><span class="bb-text">${b.texto}</span>`;
}

// ---------------- Cambiar de persona (mismo día y nº de ejercicio) ----------------
function renderUserSwitch() {
  const el = $("#user-switch");
  el.innerHTML = "";
  // Con login, solo el admin puede cambiar de persona.
  if (PROFILE && !PROFILE.es_admin) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  Object.keys(PLAN.usuarios).forEach(u => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "uswitch-btn" + (u === currentUser ? " on" : "");
    b.textContent = PLAN.usuarios[u].nombre;
    b.addEventListener("click", () => {
      if (u === currentUser) return;
      if (isDirty(currentIndex)) openSavePrompt(currentIndex, () => switchUserSameExercise(u));
      else switchUserSameExercise(u);
    });
    el.appendChild(b);
  });
}

function switchUserSameExercise(user) {
  const idx = currentIndex;
  currentUser = user;
  DB.setLastUser(user);
  document.body.dataset.user = user;
  $("#days-user-name").textContent = PLAN.usuarios[user]?.nombre || user;
  exercises = listaDe(currentDay, user).map(ex => resolveExercise(ex, user));
  currentIndex = Math.min(idx, exercises.length - 1);
  renderExercises();
  renderDots();
  renderUserSwitch();
  refreshDoneDots();
  requestAnimationFrame(() => scrollToIndex(currentIndex, false));
  toast(`Viendo a ${PLAN.usuarios[user]?.nombre || user}`);
}

// Marca como "hecho" los puntos de los ejercicios ya cargados hoy por este usuario.
function refreshDoneDots() {
  const fecha = hoyISO();
  const hechos = new Set(
    DB.all()
      .filter(r => r.usuario === currentUser && r.dia === currentDay.id && r.fecha === fecha)
      .map(r => r.ejercicio)
  );
  $$("#dots .dot").forEach((d, i) => d.classList.toggle("done", hechos.has(exercises[i]?.id)));
}

// Re-dibuja las líneas "Última carga" visibles (ej: después de bajar datos del server).
function refreshVisibleHistories() {
  exercises.forEach((ex, i) => refreshLastLine(i, ex));
  refreshDoneDots();
}

function renderExercises() {
  const track = $("#exercise-track");
  track.innerHTML = "";
  exercises.forEach((ex, i) => {
    const card = document.createElement("div");
    card.className = "exercise-card";
    card.dataset.index = i;
    card.appendChild(buildExerciseCard(ex, i));
    track.appendChild(card);
  });
  // Paso final: "Finalizar día"
  const fin = document.createElement("div");
  fin.className = "exercise-card finish-card";
  fin.dataset.index = exercises.length;
  fin.innerHTML = `<div id="finish-slot"></div>`;
  track.appendChild(fin);
  renderFinishCard();
  renderRestAll();
}

// Paso final del carrusel: checklist de lo cargado + botón "Finalizar día".
function renderFinishCard() {
  const slot = document.getElementById("finish-slot");
  if (!slot) return;
  const fecha = hoyISO();
  const hechos = new Set(
    DB.all()
      .filter(r => r.usuario === currentUser && r.dia === currentDay.id && r.fecha === fecha)
      .map(r => r.ejercicio)
  );
  const total = exercises.length;
  const done = exercises.filter(ex => hechos.has(ex.id)).length;
  const allDone = total > 0 && done === total;
  const list = exercises.map((ex, i) => {
    const ok = hechos.has(ex.id);
    const ultima = exHistory(currentUser, ex.id)[0]?.fecha || null;
    const cuando = ok ? "hoy" : (ultima ? fechaCorta(ultima) : "sin registro");
    return `<button type="button" class="finish-row ${ok ? "ok" : "pending"}" data-goto-ex="${i}">
      <span class="finish-check">${ok ? "✓" : "✗"}</span>
      <span class="finish-name">${ex.nombre}</span>
      <span class="finish-when">${cuando}</span>
    </button>`;
  }).join("");
  slot.innerHTML = `
    <div class="finish-head">
      <div class="finish-title">${allDone ? "¡Completaste el día!" : "Terminar entrenamiento"}</div>
      <div class="finish-sub">${done} de ${total} ejercicios cargados</div>
    </div>
    <div class="finish-list">${list}</div>
    <button class="btn-primary" id="btn-finish">Finalizar día${allDone ? " 🎉" : ""}</button>
    ${allDone ? "" : `<div class="finish-note">Tocá un ejercicio para ir a cargarlo. Podés finalizar igual: los que falten quedan como “sin cargar”.</div>`}`;
  slot.querySelector("#btn-finish").addEventListener("click", showSummary);
  // Cada ejercicio es un link: lleva a su tarjeta en el carrusel.
  slot.querySelectorAll("[data-goto-ex]").forEach(b =>
    b.addEventListener("click", () => guardedGoTo(Number(b.dataset.gotoEx)))
  );
}

// ==================== TIMER DE DESCANSO ====================
const REST = { total: 50, endAt: null, alarmed: false, tick: null };
let restOverlay = null;
let audioCtx = null;

function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* sin audio */ }
}
function beep() {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = 880;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.start(t); o.stop(t + 0.42);
  } catch { /* ignorar */ }
}
function restAlarm() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  beep(); setTimeout(beep, 220);
  toast("¡Descanso terminado! 💪");
}
function restRemaining() {
  if (REST.endAt === null) return null;
  return Math.max(0, Math.ceil((REST.endAt - performance.now()) / 1000));
}
function ringSVG(remFrac) {
  const r = 19, c = 2 * Math.PI * r, off = c * (1 - remFrac);
  return `<svg viewBox="0 0 44 44" class="ring">
    <circle cx="22" cy="22" r="${r}" class="ring-bg"/>
    <circle cx="22" cy="22" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
  </svg>`;
}
function renderRestInto(el) {
  const rem = restRemaining();
  if (rem === null) {
    el.className = "ex-chip rest-chip";
    el.innerHTML = `${ICONS.clock}<span>Descanso</span>`;
    el.onclick = startRest;
  } else if (rem === 0) {
    el.className = "ex-chip rest-chip done";
    el.innerHTML = `${ICONS.clock}<span>¡Listo!</span>`;
    el.onclick = stopRest;
  } else {
    el.className = "ex-chip rest-chip on";
    el.innerHTML = `${ICONS.clock}<span>${rem}s</span>`;
    el.onclick = stopRest;
  }
}
function renderRestAll() { $$(".rest-chip").forEach(renderRestInto); }

// ---- Overlay a pantalla completa con números inmensos ----
function restOverlayText(rem) {
  return rem === 0 ? "¡Listo!" : String(rem);
}
function showRestOverlay() {
  if (restOverlay) return;
  const ov = document.createElement("div");
  ov.className = "rest-overlay";
  ov.innerHTML = `<div class="rest-overlay-num">${restOverlayText(restRemaining() ?? REST.total)}</div>
    <div class="rest-overlay-hint">Tocá para minimizar</div>`;
  ov.addEventListener("click", dismissRestOverlay);
  document.body.appendChild(ov);
  restOverlay = ov;
  requestAnimationFrame(() => ov.classList.add("show")); // fade in
}
function updateRestOverlay() {
  if (!restOverlay) return;
  const rem = restRemaining();
  if (rem === null) { dismissRestOverlay(); return; }
  restOverlay.querySelector(".rest-overlay-num").textContent = restOverlayText(rem);
  if (rem === 0) restOverlay.classList.add("done");
}
function dismissRestOverlay() {
  if (!restOverlay) return;
  const ov = restOverlay;
  restOverlay = null;
  ov.classList.remove("show"); // fade out (número + overlay)
  ov.addEventListener("transitionend", () => ov.remove(), { once: true });
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 600); // respaldo
}

function startRest() {
  ensureAudio();
  REST.endAt = performance.now() + REST.total * 1000;
  REST.alarmed = false;
  if (!REST.tick) REST.tick = setInterval(tickRest, 200);
  showRestOverlay();
  renderRestAll();
}
function stopRest() {
  REST.endAt = null; REST.alarmed = false;
  if (REST.tick) { clearInterval(REST.tick); REST.tick = null; }
  dismissRestOverlay();
  renderRestAll();
}
function tickRest() {
  const rem = restRemaining();
  if (rem === 0 && !REST.alarmed) {
    REST.alarmed = true;
    restAlarm();
    if (REST.tick) { clearInterval(REST.tick); REST.tick = null; } // ya no hace falta seguir
    setTimeout(() => { if (REST.alarmed) stopRest(); }, 4000);     // vuelve a "Descanso" solo
  }
  updateRestOverlay();
  renderRestAll();
}

// Resumen corto de una carga (para la línea "Última").
function formatRecord(r) {
  const u = UNIDAD[r.medida] || "kg";
  let s = (r.kg2 ?? "") !== ""
    ? `${r.kg ?? "—"} + ${r.kg2} ${u}`
    : ((r.kg ?? "") !== "" ? `${r.kg} ${u}` : "—");
  if ((r.reps ?? "") !== "") s += ` × ${r.reps}`;
  if ((r.rir ?? "") !== "") s += ` · RIR ${r.rir}`;
  return s;
}
// Actualiza la línea "Última carga" de una tarjeta.
function refreshLastLine(index, ex, el) {
  el = el || document.getElementById(`last-${index}`);
  if (!el) return;
  const last = exHistory(currentUser, ex.id)[0];
  const ago = last ? daysAgoFrom(last.fecha) : null;
  const esHoy = ago !== null && ago <= 0;
  el.classList.toggle("today", esHoy); // verde si ya se hizo hoy
  el.innerHTML = last
    ? `<span class="ex-last-k">${fraseHace(ago)}</span><span class="ex-last-v">${formatRecord(last)}</span><span class="ex-last-m">Historial ›</span>`
    : `<span class="ex-last-k">Sin registros</span><span class="ex-last-v"></span><span class="ex-last-m">Historial ›</span>`;
  el.onclick = () => openHistorial(ex, index);
}

// Tarjeta de ejercicio compacta.
function buildExerciseCard(ex, index) {
  const frag = document.createElement("div");
  const ids = cardIds(index);
  const hasNota = !!ex.notaUsuario;
  frag.innerHTML = `
    <div class="ex-top">
      <h2 class="ex-name">${ex.nombre}</h2>
      ${ex.prescrito ? `<span class="ex-target">${objetivo(ex)}</span>` : ""}
    </div>
    <div class="ex-chips">
      <button class="ex-chip" id="chip-tec-${index}" type="button">${ICONS.info}<span>Técnica${hasNota ? " •" : ""}</span></button>
      <button class="ex-chip" id="chip-vid-${index}" type="button">${ICONS.play}<span>Video</span></button>
      <button class="ex-chip rest-chip" type="button"></button>
    </div>
    <button class="ex-last" id="last-${index}" type="button"></button>
    <div class="section-label">Cargar hoy</div>
    <div class="load-form">${fieldsHTML(ids, ex, {})}<button class="btn-save" id="save-${index}">Guardar</button></div>`;

  attachToggle(frag, ids);
  frag.querySelector(`#save-${index}`).addEventListener("click", () => saveExercise(index));
  frag.querySelector(`#chip-tec-${index}`).addEventListener("click", () => openTecnica(ex));
  frag.querySelector(`#chip-vid-${index}`).addEventListener("click", () => openVideoModal(ex));
  renderRestInto(frag.querySelector(".rest-chip"));
  refreshLastLine(index, ex, frag.querySelector(`#last-${index}`));
  return frag;
}

// Ventana genérica reutilizable.
function makeOverlay(html) {
  const o = document.createElement("div");
  o.className = "modal-overlay";
  o.innerHTML = html;
  document.body.appendChild(o);
  const close = () => o.remove();
  o.addEventListener("click", (e) => { if (e.target === o) close(); });
  o.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  return o;
}
function openTecnica(ex) {
  makeOverlay(`
    <div class="modal">
      <h3>${ex.nombre}</h3>
      ${ex.prescrito ? `<div class="modal-sub">${objetivo(ex)}</div>` : ""}
      <p class="tec-cue">${ex.indicacion || "Sin indicación técnica."}</p>
      ${ex.notaUsuario ? `<div class="ex-note">📌 ${ex.notaUsuario}</div>` : ""}
      <button class="btn-ghost" data-close style="margin-top:16px">Cerrar</button>
    </div>`);
}
function openVideoModal(ex) {
  const o = makeOverlay(`
    <div class="modal">
      <h3>Video · ${ex.nombre}</h3>
      <div class="vid-slot"></div>
      <button class="btn-ghost" data-close style="margin-top:14px">Cerrar</button>
    </div>`);
  o.querySelector(".vid-slot").appendChild(buildVideoBlock(ex));
}
function openHistorial(ex, index) {
  const o = makeOverlay(`
    <div class="modal">
      <h3>Historial · ${ex.nombre}</h3>
      <div class="modal-sub">Tocá una carga para editarla o eliminarla</div>
      <div class="history" id="hist-modal"></div>
      <button class="btn-ghost" data-close style="margin-top:14px">Cerrar</button>
    </div>`);
  const body = o.querySelector("#hist-modal");
  const rerender = () => { renderHistoryInto(body, ex.id, rerender); refreshLastLine(index, ex); refreshDoneDots(); };
  renderHistoryInto(body, ex.id, rerender);
}

function renderHistoryInto(el, exerciseId, onChange) {
  const rows = exHistory(currentUser, exerciseId).slice(0, 8);
  if (rows.length === 0) {
    el.innerHTML = `<div class="history-empty">Todavía no hay cargas. ¡Esta es la primera!</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const u = UNIDAD[r.medida] || "kg";
    let kg = (r.kg2 ?? "") !== ""
      ? `${r.kg ?? "—"} + ${r.kg2} ${u}`
      : ((r.kg ?? "") !== "" ? `${r.kg} ${u}` : "—");
    if ((r.reps ?? "") !== "") kg += ` × ${r.reps}`;
    const rir = (r.rir ?? "") !== "" ? `RIR ${r.rir}` : "";
    const nota = r.nota ? `<span class="hist-note">“${r.nota}”</span>` : "";
    const badge = r._pending ? `<span class="hist-badge">⏳</span>` : "";
    return `<div class="hist-row ${r._pending ? "pending" : ""}" data-id="${r.id}">
      <span class="hist-date">${fechaCorta(r.fecha)}${badge}</span>
      <span class="hist-main">${kg}</span>
      <span class="hist-rir">${rir}</span>
      <span class="hist-spacer"></span>
      ${nota}
      <span class="hist-edit">✎</span>
    </div>`;
  }).join("");

  // Tocar una fila abre el editor de esa carga.
  el.querySelectorAll(".hist-row").forEach(row => {
    row.addEventListener("click", () => {
      const rec = DB.all().find(r => r.id === row.dataset.id);
      if (rec) openEditModal(rec, onChange || (() => { renderHistoryInto(el, exerciseId, onChange); refreshDoneDots(); }));
    });
  });
}

// ---------------- Editar / eliminar una carga ----------------
function openEditModal(rec, onDone) {
  const ex = exercises.find(e => e.id === rec.ejercicio) || { superset: null, medida: rec.medida || "kg" };
  const mIds = { toggle: "m-toggle", vlabel: "m-vlabel", val: "m-val", val2: "m-val2", reps: "m-reps", repsField: "m-repsfield", rir: "m-rir", nota: "m-nota" };
  const init = { medida: rec.medida, val: rec.kg, val2: rec.kg2, reps: rec.reps, rir: rec.rir, nota: rec.nota };
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar carga</h3>
      <div class="modal-sub">${rec.ejercicio_nombre || ""} · ${fechaCorta(rec.fecha)}</div>
      ${fieldsHTML(mIds, ex, init)}
      <button class="btn-save" id="m-save">Guardar cambios</button>
      <div class="modal-row">
        <button class="btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn-danger" id="m-delete">Eliminar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  attachToggle(overlay, mIds);

  overlay.querySelector("#m-cancel").addEventListener("click", close);

  overlay.querySelector("#m-save").addEventListener("click", async () => {
    const f = readFields(mIds, ex);
    const err = validateForm(f);
    if (err) { toast(err); return; }
    await DB.update(rec.id, toDbFields(f));
    close();
    renderStatusBar();
    onDone && onDone();
    toast("Carga actualizada");
  });

  overlay.querySelector("#m-delete").addEventListener("click", async () => {
    if (!confirm("¿Eliminar esta carga? No se puede deshacer.")) return;
    await DB.remove(rec.id);
    close();
    renderStatusBar();
    onDone && onDone();
    toast("Carga eliminada");
  });
}

// ---------------- Guardar una carga ----------------
// Lee los campos del formulario de un ejercicio.
function readForm(index) {
  return readFields(cardIds(index), exercises[index]);
}

// ¿Hay datos escritos y sin guardar en este ejercicio?
function isDirty(index) {
  if (index < 0 || index >= exercises.length) return false; // paso "Finalizar": no es ejercicio
  const f = readForm(index);
  return f.val !== "" || f.val2 !== "" || f.reps !== "" || f.rir !== "" || f.nota !== "";
}

// Valida los campos. Carga y RIR obligatorios; en superserie, los dos pesos
// (el RIR es opcional y por defecto vale 1). El RIR no aplica a segundos.
function validateForm(f) {
  if (f.superset) {
    if (f.val === "" || f.val2 === "") return "Completá el peso de los dos movimientos";
    return null;
  }
  if (f.val === "") return `Falta la ${MEDIDAS[f.medida].toLowerCase()}`;
  if (f.medida !== "seg" && f.rir === "") return "Falta el RIR (carga y RIR son obligatorios)";
  return null;
}

function clearForm(index) {
  const ids = cardIds(index);
  [ids.val, ids.val2, ids.reps, ids.rir, ids.nota].forEach(id => setVal(id, ""));
}

// Guarda la carga de un ejercicio y refresca la UI de esa tarjeta.
async function commitLoad(index, f) {
  const ex = exercises[index];
  await DB.save({
    fecha: hoyISO(),
    usuario: currentUser,
    dia: currentDay.id,
    ejercicio: ex.id,
    ejercicio_nombre: ex.nombre,
    ...toDbFields(f),
  });
  clearForm(index);
  refreshLastLine(index, ex);
  markDotDone(index);
  renderStatusBar();
}

// Ejercicios ya cargados hoy por el usuario actual en este día.
function doneSetToday() {
  const fecha = hoyISO();
  return new Set(
    DB.all()
      .filter(r => r.usuario === currentUser && r.dia === currentDay.id && r.fecha === fecha)
      .map(r => r.ejercicio)
  );
}
// ¿Están TODOS los ejercicios del día completados? (sin importar el orden)
function allExercisesDone() {
  const hechos = doneSetToday();
  return exercises.length > 0 && exercises.every(ex => hechos.has(ex.id));
}

async function saveExercise(index) {
  const f = readForm(index);
  const err = validateForm(f);
  if (err) { toast(err); return; }

  await commitLoad(index, f);

  const btn = $(`#save-${index}`);
  btn.textContent = "✓ Guardado";
  btn.classList.add("saved");
  setTimeout(() => { btn.textContent = "Guardar"; btn.classList.remove("saved"); }, 1600);

  setTimeout(() => {
    // Si con esta carga quedaron TODOS completos (en cualquier orden), festejamos.
    // Si falta alguno, avanzamos al siguiente paso (tras el último viene "Finalizar día").
    if (allExercisesDone()) showSummary();
    else scrollToIndex(index + 1, true);
  }, 700);
}

// Popup al intentar salir de un ejercicio con datos sin guardar.
function openSavePrompt(index, proceed) {
  const ex = exercises[index];
  const init = readForm(index);
  const pIds = { toggle: "p-toggle", vlabel: "p-vlabel", val: "p-val", val2: "p-val2", reps: "p-reps", repsField: "p-repsfield", rir: "p-rir", nota: "p-nota" };
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>¿Guardar esta carga?</h3>
      <div class="modal-sub">${ex.nombre} · tenés datos sin guardar</div>
      ${fieldsHTML(pIds, ex, init)}
      <button class="btn-save" id="p-save">Guardar y continuar</button>
      <div class="modal-row">
        <button class="btn-ghost" id="p-back">Volver a completar</button>
        <button class="btn-danger" id="p-skip">Seguir sin guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  attachToggle(overlay, pIds);

  const readPopup = () => readFields(pIds, ex);

  // Refleja lo escrito en el popup de vuelta al formulario de la tarjeta.
  const syncBack = () => {
    const p = readPopup();
    const cIds = cardIds(index);
    if (!ex.superset) {
      const t = document.getElementById(cIds.toggle);
      if (t) {
        t.dataset.medida = p.medida;
        t.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.m === p.medida));
      }
      const vl = document.getElementById(cIds.vlabel); if (vl) vl.textContent = MEDIDAS[p.medida];
      const rf = document.getElementById(cIds.repsField); if (rf) rf.style.display = (p.medida === "kg") ? "" : "none";
    }
    setVal(cIds.val, p.val);
    if (ex.superset) setVal(cIds.val2, p.val2);
    if (ex.repsVar) setVal(cIds.reps, p.reps);
    setVal(cIds.rir, p.rir);
    setVal(cIds.nota, p.nota);
  };

  overlay.querySelector("#p-save").addEventListener("click", async () => {
    const p = readPopup();
    const err = validateForm(p);
    if (err) { toast(err); return; }
    await commitLoad(index, p);
    close();
    proceed && proceed();
  });
  overlay.querySelector("#p-skip").addEventListener("click", () => {
    clearForm(index);        // descartar lo escrito
    close();
    proceed && proceed();
  });
  overlay.querySelector("#p-back").addEventListener("click", () => {
    syncBack();              // conservar lo editado, quedarse en el ejercicio
    close();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { syncBack(); close(); } });
}

// Navega a un ejercicio, pidiendo guardar si el actual tiene datos sin guardar.
function guardedGoTo(target) {
  target = Math.max(0, Math.min(exercises.length, target)); // +1 por el paso "Finalizar"
  if (target === currentIndex) return;
  if (isDirty(currentIndex)) openSavePrompt(currentIndex, () => scrollToIndex(target, true));
  else scrollToIndex(target, true);
}

// ---------------- Carrusel: puntos y flechas ----------------
function renderDots() {
  const dots = $("#dots");
  dots.innerHTML = "";
  exercises.forEach((_, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === currentIndex ? " active" : "");
    d.dataset.index = i;
    d.addEventListener("click", () => guardedGoTo(i));
    dots.appendChild(d);
  });
  // Punto del paso "Finalizar día"
  const fin = document.createElement("div");
  const finIdx = exercises.length;
  fin.className = "dot dot-finish" + (finIdx === currentIndex ? " active" : "");
  fin.dataset.index = finIdx;
  fin.addEventListener("click", () => guardedGoTo(finIdx));
  dots.appendChild(fin);
  updateArrows();
}
function markDotDone(index) {
  const d = $(`#dots .dot[data-index="${index}"]`);
  if (d) d.classList.add("done");
}
function updateDots() {
  $$("#dots .dot").forEach((d, i) => d.classList.toggle("active", i === currentIndex));
  updateArrows();
}
function updateArrows() {
  $("#arrow-prev").disabled = currentIndex === 0;
  $("#arrow-next").disabled = currentIndex === exercises.length; // último = paso "Finalizar"
}

function scrollToIndex(i, smooth) {
  i = Math.max(0, Math.min(exercises.length, i)); // +1 por el paso "Finalizar"
  const vp = $("#exercise-viewport");
  vp.scrollTo({ left: vp.clientWidth * i, behavior: smooth ? "smooth" : "auto" });
  currentIndex = i;
  if (i === exercises.length) renderFinishCard(); // refresca el checklist al llegar
  updateDots();
}

// Deslizar (swipe): actualiza el punto activo en vivo y, al soltar, aplica la guardia.
let navLock = false;
(function attachScrollSync() {
  const vp = $("#exercise-viewport");
  let idle = null;
  vp.addEventListener("scroll", () => {
    const near = Math.round(vp.scrollLeft / vp.clientWidth);
    $$("#dots .dot").forEach((d, i) => d.classList.toggle("active", i === near)); // solo visual
    clearTimeout(idle);
    idle = setTimeout(onSwipeSettled, 140);
  });
})();

function onSwipeSettled() {
  const vp = $("#exercise-viewport");
  const settled = Math.round(vp.scrollLeft / vp.clientWidth);
  if (navLock || settled === currentIndex) return;
  const from = currentIndex;
  if (isDirty(from)) {
    // Volvemos al ejercicio con datos y preguntamos antes de pasar.
    navLock = true;
    scrollToIndex(from, true);
    setTimeout(() => { navLock = false; }, 400);
    openSavePrompt(from, () => scrollToIndex(settled, true));
  } else {
    currentIndex = settled;
    if (settled === exercises.length) renderFinishCard(); // refresca el checklist
    updateDots();
  }
}

$("#arrow-prev").addEventListener("click", () => guardedGoTo(currentIndex - 1));
$("#arrow-next").addEventListener("click", () => guardedGoTo(currentIndex + 1));

// ---------------- Resumen de la sesión ----------------
function showSummary() {
  const fecha = hoyISO();
  const registrosHoy = DB.all().filter(
    r => r.usuario === currentUser && r.dia === currentDay.id && r.fecha === fecha
  );
  const porEjercicio = {};
  registrosHoy.forEach(r => {
    // el más reciente de hoy por ejercicio
    if (!porEjercicio[r.ejercicio] ||
        (r.created_at || "") > (porEjercicio[r.ejercicio].created_at || "")) {
      porEjercicio[r.ejercicio] = r;
    }
  });

  const doneCount = exercises.filter(ex => porEjercicio[ex.id]).length;
  const allDone = exercises.length > 0 && doneCount === exercises.length;

  const cont = $("#summary-content");
  const nombreUser = PLAN.usuarios[currentUser]?.nombre || currentUser;
  let html = `<div class="sum-celebrate">${allDone ? "🎉 ¡Sesión terminada!" : "✅ Día finalizado"}</div>
    <h2>${currentDay.nombre} · ${currentDay.subtitulo || ""}</h2>
    <div class="sum-date">${nombreUser} · ${fechaCorta(fecha)}${allDone ? "" : ` · ${doneCount} de ${exercises.length} cargados`}</div>`;

  exercises.forEach(ex => {
    const r = porEjercicio[ex.id];
    if (r) {
      const u = UNIDAD[r.medida] || "kg";
      let kg = (r.kg2 ?? "") !== ""
        ? `${r.kg ?? "—"} + ${r.kg2} ${u}`
        : ((r.kg ?? "") !== "" ? `${r.kg} ${u}` : "");
      if ((r.reps ?? "") !== "") kg += ` × ${r.reps}`;
      const rir = (r.rir ?? "") !== "" ? ` · RIR ${r.rir}` : "";
      html += `<div class="sum-row">
        <span class="sum-name">${ex.nombre}</span>
        <span class="sum-val">${kg}${rir}</span>
      </div>`;
    } else {
      html += `<div class="sum-row skipped">
        <span class="sum-name">${ex.nombre}</span>
        <span class="sum-val">sin cargar</span>
      </div>`;
    }
  });
  // Progreso de la sesión (volumen de hoy vs. la vez pasada + récords)
  html += renderSummaryProgress(fecha, porEjercicio);

  cont.innerHTML = html;
  const mb = $("#sum-metrics");
  if (mb) mb.addEventListener("click", openMetrics);
  showScreen("summary");
  if (allDone) launchConfetti(); // festejo solo si cargaste todos
}

function renderSummaryProgress(fecha, porEjercicio) {
  const todayVol = Object.values(porEjercicio).reduce((s, r) => s + recordVolume(r), 0);
  if (todayVol <= 0) return "";
  let h = `<div class="section-label">Progreso</div>`;
  const prev = previousSession(currentUser, currentDay.id, fecha);
  if (prev && prev.vol > 0) {
    const diff = (todayVol - prev.vol) / prev.vol * 100;
    const up = todayVol >= prev.vol;
    h += `<div class="prog-card">
      <div class="prog-main"><b>${fmtVol(todayVol)}</b><small>Volumen de hoy</small></div>
      <div class="prog-delta ${up ? "up" : "down"}">
        <span>${up ? "▲" : "▼"} ${Math.abs(diff).toFixed(0)}%</span>
        <small>vs ${fechaCorta(prev.fecha)}</small>
      </div>
    </div>`;
  } else {
    h += `<div class="prog-card"><div class="prog-main"><b>${fmtVol(todayVol)}</b><small>Volumen de hoy · primera sesión de este día 💪</small></div></div>`;
  }
  const prs = countPRs(currentUser, currentDay.id, fecha, porEjercicio);
  if (prs > 0) h += `<div class="pr-chip">🏆 ${prs} récord${prs > 1 ? "s" : ""} de peso hoy</div>`;
  h += `<button class="btn-ghost" id="sum-metrics" style="margin-top:14px">📊 Ver métricas</button>`;
  return h;
}

// ==================== MÉTRICAS ====================
// ---- Cálculos ----
function fmtVol(v) { return Math.round(v).toLocaleString("es-AR"); }

function planLookup(exId, user) {
  for (const d of PLAN.dias) {
    const ex = listaDe(d, user).find(e => e.id === exId);
    if (ex) return resolveExercise(ex, user);
  }
  return null;
}
function repsMid(str) {
  const s = String(str || "");
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return (Number(m[1]) + Number(m[2])) / 2;
  const n = s.match(/\d+/);
  return n ? Number(n[0]) : 0;
}
// Volumen de una carga = peso × reps × series (adaptado a cada tipo).
function recordVolume(r) {
  const p = planLookup(r.ejercicio, r.usuario);
  const series = (p && p.series) || 1;
  const medida = r.medida || "kg";
  if (r.kg2 != null && r.kg2 !== "") {
    return (Number(r.kg || 0) + Number(r.kg2 || 0)) * repsMid(p && p.reps) * series;
  }
  if (medida === "kg") {
    const reps = (r.reps != null && r.reps !== "") ? Number(r.reps) : repsMid(p && p.reps);
    return Number(r.kg || 0) * reps * series;
  }
  return Number(r.kg || 0) * series; // reps o seg: el valor está en kg
}
// Valor principal para el gráfico por ejercicio.
function exercisePrimary(r) {
  const medida = r.medida || "kg";
  if (r.kg2 != null && r.kg2 !== "") return { value: recordVolume(r), unidad: "vol", label: "Volumen" };
  if (medida === "kg") return { value: Number(r.kg || 0), unidad: "kg", label: "Peso" };
  if (medida === "reps") return { value: Number(r.kg || 0), unidad: "reps", label: "Reps" };
  return { value: Number(r.kg || 0), unidad: "seg", label: "Tiempo" };
}
// Deja una carga por (fecha, ejercicio): la más reciente.
function dedupRecords(list) {
  const m = {};
  list.forEach(r => {
    const k = r.fecha + "|" + r.ejercicio;
    if (!m[k] || (r.created_at || "") > (m[k].created_at || "")) m[k] = r;
  });
  return Object.values(m);
}
function exerciseSeries(user, exId) {
  const ids = histIds(user, exId);
  return dedupRecords(DB.all().filter(r => r.usuario === user && ids.has(r.ejercicio)))
    .sort((a, b) => a.fecha < b.fecha ? -1 : 1);
}
function daySeries(user, diaId) {
  const recs = dedupRecords(DB.all().filter(r => r.usuario === user && r.dia === diaId));
  const byDate = {};
  recs.forEach(r => { (byDate[r.fecha] = byDate[r.fecha] || []).push(r); });
  return Object.keys(byDate).sort().map(fecha => ({
    label: fecha,
    value: byDate[fecha].reduce((s, r) => s + recordVolume(r), 0),
    n: byDate[fecha].length,
  }));
}
function previousSession(user, dia, beforeFecha) {
  const recs = dedupRecords(DB.all().filter(r => r.usuario === user && r.dia === dia && r.fecha < beforeFecha));
  const byDate = {};
  recs.forEach(r => { (byDate[r.fecha] = byDate[r.fecha] || []).push(r); });
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return null;
  const f = dates[dates.length - 1];
  return { fecha: f, vol: byDate[f].reduce((s, r) => s + recordVolume(r), 0) };
}
function countPRs(user, dia, fecha, todayMap) {
  let n = 0;
  Object.values(todayMap).forEach(r => {
    if ((r.medida || "kg") !== "kg" || r.kg == null) return;
    const ids = histIds(user, r.ejercicio);
    const prev = DB.all().filter(x => x.usuario === user && ids.has(x.ejercicio) &&
      x.fecha < fecha && (x.medida || "kg") === "kg" && x.kg != null).map(x => Number(x.kg));
    const prevMax = prev.length ? Math.max(...prev) : 0;
    if (prevMax > 0 && Number(r.kg) > prevMax) n++;
  });
  return n;
}
function weekKey(fecha) {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7; // lunes = 0
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}
function weekShort(k) { const [, m, d] = k.split("-"); return `${Number(d)}/${Number(m)}`; }
function generalWeekly(user) {
  const recs = dedupRecords(DB.all().filter(r => r.usuario === user && r.ejercicio !== "cardio"));
  const byWeek = {};
  recs.forEach(r => {
    const k = weekKey(r.fecha);
    byWeek[k] = byWeek[k] || { vol: 0, dates: new Set() };
    byWeek[k].vol += recordVolume(r);
    byWeek[k].dates.add(r.fecha);
  });
  return Object.keys(byWeek).sort().map(k => ({
    week: k, short: weekShort(k), volume: byWeek[k].vol, sessions: byWeek[k].dates.size,
  }));
}

// ---- Gráficos SVG (sin librerías) ----
const CHART_EMPTY = `<div class="chart-empty">Todavía no hay datos suficientes. Cargá algunas sesiones y volvé 💪</div>`;

function svgLine(series, opts = {}) {
  if (!series.length) return CHART_EMPTY;
  const W = 320, H = opts.height || 150, padL = 10, padR = 10, padT = 16, padB = 22;
  const vals = series.map(s => s.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { max = max + 1; min = Math.max(0, min - 1); }
  const iw = W - padL - padR, ih = H - padT - padB, n = series.length;
  const X = i => padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => padT + ih * (1 - (v - min) / (max - min));
  const pts = series.map((s, i) => [X(i), Y(s.value)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `M${pts[0][0].toFixed(1)} ${(H - padB).toFixed(1)} ` +
    pts.map(p => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") +
    ` L${pts[n - 1][0].toFixed(1)} ${(H - padB).toFixed(1)} Z`;
  const dots = pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === n - 1 ? 4.5 : 2.6}" class="${i === n - 1 ? "cdot-last" : "cdot"}"/>`).join("");
  const last = series[n - 1], first = series[0];
  const fmt = opts.format || (v => String(Math.round(v)));
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#cg)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <text x="${X(n - 1).toFixed(1)}" y="${(Y(last.value) - 8).toFixed(1)}" class="cval" text-anchor="end">${fmt(last.value)}</text>
  </svg>`;
}

function svgBars(items, opts = {}) {
  if (!items.length) return CHART_EMPTY;
  const W = 320, H = opts.height || 140, padL = 8, padR = 8, padT = 16, padB = 24;
  const max = Math.max(...items.map(i => i.value), 1);
  const iw = W - padL - padR, ih = H - padT - padB, n = items.length;
  const gap = iw / n, bw = Math.min(30, gap * 0.6);
  const bars = items.map((it, i) => {
    const bh = Math.max(2, ih * (it.value / max));
    const cx = padL + gap * i + gap / 2;
    const yTop = padT + ih - bh;
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="var(--accent)" opacity="${i === n - 1 ? 1 : 0.5}"/>
      ${it.value ? `<text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" class="cval" text-anchor="middle">${it.value}</text>` : ""}
      <text x="${cx.toFixed(1)}" y="${(H - 7).toFixed(1)}" class="cxlabel" text-anchor="middle">${it.short || ""}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${bars}</svg>`;
}

function sparkline(values) {
  if (values.length < 2) return "";
  const W = 80, H = 24;
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { max += 1; min -= 1; }
  const n = values.length;
  const pts = values.map((v, i) => [i * W / (n - 1), H - 2 - (H - 4) * (v - min) / (max - min)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const up = values[n - 1] >= values[0];
  return `<svg viewBox="0 0 ${W} ${H}" class="spark ${up ? "up" : "down"}"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ---- Render de la pantalla ----
let metricsTab = "general", metricsDay = null, metricsEx = null;

function openMetrics() {
  showScreen("metrics");
  renderMetrics();
  DB.refresh().then(ok => { if (ok) renderMetrics(); });
}

function syncMetricTabs() {
  $$("#metrics-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === metricsTab));
}

function renderMetrics() {
  syncMetricTabs();
  const body = $("#metrics-body");
  if (metricsTab === "general") body.innerHTML = renderGeneral();
  else if (metricsTab === "dia") body.innerHTML = renderPorDia();
  else body.innerHTML = renderPorEjercicio();
  wireMetricPickers();
}

function statTiles(tiles) {
  return `<div class="stat-tiles">${tiles.map(t => `<div class="stat-tile"><b>${t.v}</b><small>${t.l}</small></div>`).join("")}</div>`;
}

function renderGeneral() {
  const weeks = generalWeekly(currentUser).slice(-10);
  if (!weeks.length) return `<div class="metric-card">${CHART_EMPTY}</div>`;
  const totalSes = new Set(dedupRecords(DB.all().filter(r => r.usuario === currentUser && r.ejercicio !== "cardio")).map(r => r.fecha)).size;
  const totalVol = dedupRecords(DB.all().filter(r => r.usuario === currentUser && r.ejercicio !== "cardio")).reduce((s, r) => s + recordVolume(r), 0);
  const sesiones = weeks.map(w => ({ value: w.sessions, short: w.short }));
  const vol = weeks.map(w => ({ label: w.week, value: w.volume }));
  return `
    ${statTiles([{ v: totalSes, l: "Entrenamientos" }, { v: fmtVol(totalVol), l: "Volumen total" }])}
    <div class="metric-card">
      <div class="metric-title">Constancia · sesiones por semana</div>
      ${svgBars(sesiones)}
    </div>
    <div class="metric-card">
      <div class="metric-title">Volumen total por semana</div>
      ${svgLine(vol, { format: v => fmtVol(v) })}
    </div>`;
}

function renderPorDia() {
  const diasEntreno = PLAN.dias.filter(d => (d.tipo || "entreno") === "entreno");
  if (!metricsDay || !diasEntreno.some(d => d.id === metricsDay)) metricsDay = diasEntreno[0].id;
  const chips = diasEntreno.map(d =>
    `<button class="day-chip ${d.id === metricsDay ? "on" : ""}" data-dia="${d.id}">${d.nombre}</button>`).join("");
  const dia = PLAN.dias.find(d => d.id === metricsDay);
  const serie = daySeries(currentUser, metricsDay);
  const line = serie.map(s => ({ label: s.label, value: s.value }));
  let breakdown = "";
  if (serie.length) {
    breakdown = listaDe(dia, currentUser).map(exDef => {
      const ex = resolveExercise(exDef, currentUser);
      const s = exerciseSeries(currentUser, ex.id).map(r => exercisePrimary(r).value);
      const last = s.length ? s[s.length - 1] : null;
      const prim = exerciseSeries(currentUser, ex.id).slice(-1)[0];
      const u = prim ? exercisePrimary(prim).unidad : "";
      return `<div class="mini-row">
        <span class="mini-name">${ex.nombre}</span>
        ${sparkline(s)}
        <span class="mini-val">${last != null ? (u === "vol" ? fmtVol(last) : last + " " + u) : "—"}</span>
      </div>`;
    }).join("");
  }
  return `
    <div class="chips-row">${chips}</div>
    <div class="metric-card">
      <div class="metric-title">Volumen de la sesión · ${dia.nombre}</div>
      ${svgLine(line, { format: v => fmtVol(v) })}
      <div class="metric-sub">${serie.length} sesión${serie.length === 1 ? "" : "es"} registrada${serie.length === 1 ? "" : "s"}</div>
    </div>
    ${breakdown ? `<div class="metric-card"><div class="metric-title">Por ejercicio</div>${breakdown}</div>` : ""}`;
}

function renderPorEjercicio() {
  const options = PLAN.dias.filter(d => listaDe(d, currentUser).length).map(d =>
    `<optgroup label="${d.nombre}">` +
    listaDe(d, currentUser).map(exDef => {
      const ex = resolveExercise(exDef, currentUser);
      if (!metricsEx) metricsEx = ex.id;
      return `<option value="${ex.id}" ${ex.id === metricsEx ? "selected" : ""}>${ex.nombre}</option>`;
    }).join("") + `</optgroup>`).join("");
  const ex = planLookup(metricsEx, currentUser);
  const recs = exerciseSeries(currentUser, metricsEx);
  const serie = recs.map(r => ({ label: r.fecha, value: exercisePrimary(r).value }));
  const unidad = recs.length ? exercisePrimary(recs[recs.length - 1]).unidad : "kg";
  const fmt = unidad === "vol" ? (v => fmtVol(v)) : (v => String(Math.round(v)));
  // récords
  let recordsHtml = "";
  if (recs.length) {
    const pesos = recs.filter(r => (r.medida || "kg") === "kg" && r.kg != null).map(r => Number(r.kg));
    const bestKg = pesos.length ? Math.max(...pesos) : null;
    const bestVol = Math.max(...recs.map(r => recordVolume(r)));
    recordsHtml = statTiles([
      ...(bestKg != null ? [{ v: bestKg + " kg", l: "Mejor peso" }] : []),
      { v: fmtVol(bestVol), l: "Mejor volumen" },
      { v: recs.length, l: "Sesiones" },
    ]);
  }
  const lista = recs.slice(-6).reverse().map(r => {
    const p = exercisePrimary(r);
    const val = p.unidad === "vol" ? fmtVol(p.value) : `${p.value} ${p.unidad}`;
    const extra = (r.kg2 != null && r.kg2 !== "") ? `${r.kg}+${r.kg2} kg` :
      (r.reps != null && r.reps !== "" ? `${r.reps} reps` : "");
    const rir = (r.rir != null && r.rir !== "") ? `RIR ${r.rir}` : "";
    return `<div class="mini-row"><span class="mini-name">${fechaCorta(r.fecha)}</span>
      <span class="mini-extra">${extra} ${rir}</span>
      <span class="mini-val">${val}</span></div>`;
  }).join("");
  return `
    <div class="metric-select-wrap">
      <select id="metric-ex-select" class="metric-select">${options}</select>
    </div>
    ${recordsHtml}
    <div class="metric-card">
      <div class="metric-title">${ex ? ex.nombre : ""} · progresión</div>
      ${svgLine(serie, { format: fmt })}
    </div>
    ${lista ? `<div class="metric-card"><div class="metric-title">Últimas sesiones</div>${lista}</div>` : ""}`;
}

function wireMetricPickers() {
  const sel = $("#metric-ex-select");
  if (sel) sel.onchange = () => { metricsEx = sel.value; renderMetrics(); };
  $$("#metrics-body .day-chip").forEach(c => c.onclick = () => { metricsDay = c.dataset.dia; renderMetrics(); });
}

// ---------------- Confeti de festejo ----------------
function launchConfetti() {
  // Respetar a quien prefiere menos animaciones.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = () => window.innerWidth, H = () => window.innerHeight;
  canvas.width = W() * dpr; canvas.height = H() * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ["#FFFFFF", "#CFCFCF", "#5B7382", "#8A8A8D", "#3A3A3D"];
  const N = 160;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push({
      x: Math.random() * W(),
      y: -20 - Math.random() * H() * 0.4,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 2 + Math.random() * 4.5,
      size: 6 + Math.random() * 7,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      shape: Math.random() < 0.5 ? "rect" : "circle",
    });
  }

  const start = performance.now();
  const DURATION = 3500, FADE = 900;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W(), H());
    const alpha = t > DURATION - FADE ? Math.max(0, (DURATION - t) / FADE) : 1;
    for (const p of parts) {
      p.vy += 0.06;            // gravedad
      p.vx *= 0.995;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ---------------- Exportar respaldo ----------------
function descargarArchivo(contenido, nombre, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const data = DB.exportData();
  descargarArchivo(JSON.stringify(data, null, 2), `respaldo-gym-${hoyISO()}.json`, "application/json");
  toast("Respaldo descargado 📁");
}

// Escapa un valor para CSV (comillas, comas, saltos de línea).
function csvCampo(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Descarga el historial completo (cada carga con su fecha y todos sus datos).
function exportHistoryCSV() {
  const all = DB.all();
  if (!all.length) { toast("Todavía no hay historial cargado."); return; }
  const nombreUser = u => PLAN.usuarios[u]?.nombre || u;
  const nombreDia = d => PLAN.dias.find(x => x.id === d)?.nombre || d;
  const orden = all.slice().sort((a, b) => {
    if (a.usuario !== b.usuario) return a.usuario < b.usuario ? -1 : 1;
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
  });
  const headers = ["usuario","fecha","dia","dia_nombre","ejercicio_id","ejercicio","medida","valor","valor2","reps","rir","nota","guardado"];
  const filas = orden.map(r => [
    nombreUser(r.usuario), r.fecha, r.dia, nombreDia(r.dia),
    r.ejercicio, r.ejercicio_nombre || "", r.medida || "kg",
    r.kg ?? "", r.kg2 ?? "", r.reps ?? "", r.rir ?? "", r.nota || "", r.created_at || "",
  ].map(csvCampo).join(","));
  const csv = "﻿" + [headers.join(","), ...filas].join("\r\n") + "\r\n"; // BOM para Excel
  descargarArchivo(csv, `historial-gym-${hoyISO()}.csv`, "text/csv;charset=utf-8");
  toast(`Historial descargado (${all.length} cargas) 📁`);
}

// Exporta TODAS las métricas (de los dos usuarios): resumen general por
// persona + tabla por ejercicio (sesiones, PR de peso, mejor y total de
// volumen, progresión). Usa los mismos cálculos que la pantalla de métricas.
function exportMetricsCSV() {
  if (!DB.all().length) { toast("Todavía no hay datos para métricas."); return; }
  const users = Object.keys(PLAN.usuarios);
  // Mapa ejercicio -> día (para la tabla por ejercicio).
  const diaDeEx = {};
  PLAN.dias.forEach(d => d.ejercicios.forEach(ex => { diaDeEx[ex.id] = d; }));

  const lineas = [];
  // --- Bloque 1: resumen general por persona ---
  lineas.push("RESUMEN GENERAL");
  lineas.push(["usuario","entrenamientos","volumen_total","primera_sesion","ultima_sesion"].join(","));
  users.forEach(u => {
    const recs = dedupRecords(DB.all().filter(r => r.usuario === u));
    const fechas = [...new Set(recs.map(r => r.fecha))].sort();
    const volTotal = recs.reduce((s, r) => s + recordVolume(r), 0);
    lineas.push([
      PLAN.usuarios[u]?.nombre || u,
      fechas.length,
      Math.round(volTotal),
      fechas[0] || "",
      fechas[fechas.length - 1] || "",
    ].map(csvCampo).join(","));
  });

  lineas.push(""); // separador
  // --- Bloque 2: por ejercicio ---
  lineas.push("POR EJERCICIO");
  lineas.push(["usuario","dia","dia_nombre","ejercicio_id","ejercicio","unidad","sesiones",
    "primera_fecha","primer_valor","ultima_fecha","ultimo_valor",
    "mejor_peso_kg","mejor_volumen","volumen_total","progresion","progresion_pct"].join(","));
  users.forEach(u => {
    PLAN.dias.forEach(d => d.ejercicios.forEach(exDef => {
      const ex = resolveExercise(exDef, u);
      const recs = exerciseSeries(u, ex.id); // deduplicado por fecha, orden ascendente
      if (!recs.length) return; // sin datos: no es una métrica
      const primero = recs[0], ultimo = recs[recs.length - 1];
      const unidad = exercisePrimary(ultimo).unidad;
      const pv = exercisePrimary(primero).value;
      const uv = exercisePrimary(ultimo).value;
      const pesos = recs.filter(r => (r.medida || "kg") === "kg" && r.kg != null).map(r => Number(r.kg));
      const mejorPeso = pesos.length ? Math.max(...pesos) : "";
      const mejorVol = Math.round(Math.max(...recs.map(r => recordVolume(r))));
      const volTotal = Math.round(recs.reduce((s, r) => s + recordVolume(r), 0));
      const prog = uv - pv;
      const progPct = pv > 0 ? Math.round(prog / pv * 100) : "";
      lineas.push([
        PLAN.usuarios[u]?.nombre || u, d.id, d.nombre, ex.id, ex.nombre, unidad, recs.length,
        primero.fecha, round1(pv), ultimo.fecha, round1(uv),
        mejorPeso, mejorVol, volTotal, round1(prog), progPct === "" ? "" : progPct + "%",
      ].map(csvCampo).join(","));
    }));
  });

  const csv = "﻿" + lineas.join("\r\n") + "\r\n"; // BOM para Excel
  descargarArchivo(csv, `metricas-gym-${hoyISO()}.csv`, "text/csv;charset=utf-8");
  toast("Métricas descargadas 📊");
}
function round1(v) { return Math.round(Number(v) * 10) / 10; }

// Menú del botón ⤓: elegir qué descargar.
function openExportMenu() {
  const o = makeOverlay(`
    <div class="modal">
      <h3>Descargar</h3>
      <div class="modal-sub">Elegí qué querés bajar</div>
      <button class="btn-primary" id="exp-metrics">Métricas (CSV)</button>
      <button class="btn-ghost" id="exp-csv" style="margin-top:10px">Historial (CSV)</button>
      <div class="modal-row">
        <button class="btn-ghost" id="exp-json">Respaldo (JSON)</button>
        <button class="btn-ghost" data-close>Cerrar</button>
      </div>
    </div>`);
  o.querySelector("#exp-metrics").addEventListener("click", () => { o.remove(); exportMetricsCSV(); });
  o.querySelector("#exp-csv").addEventListener("click", () => { o.remove(); exportHistoryCSV(); });
  o.querySelector("#exp-json").addEventListener("click", () => { o.remove(); exportBackup(); });
}
// ================== REGISTRO CORPORAL (peso / cintura / sueño) ==================
function openCorporal() {
  renderCorporal();
  showScreen("corporal");
  DB.corpRefresh().then(ok => { if (ok) renderCorporal(); });
}
// Gráfico con varias líneas (cintura + cadera) en escala de fechas compartida.
function svgMultiLine(series, opts = {}) {
  const all = series.flatMap(s => s.puntos);
  if (!all.length) return CHART_EMPTY;
  const W = 320, H = opts.height || 150, padL = 10, padR = 10, padT = 20, padB = 24;
  const vals = all.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { max += 1; min = Math.max(0, min - 1); }
  const fechas = all.map(p => p.fecha).sort();
  const minF = fechas[0], maxF = fechas[fechas.length - 1];
  const tmin = Date.parse(minF + "T00:00:00"), tmax = Date.parse(maxF + "T00:00:00");
  const iw = W - padL - padR, ih = H - padT - padB;
  const X = iso => padL + (tmax === tmin ? iw / 2 : iw * (Date.parse(iso + "T00:00:00") - tmin) / (tmax - tmin));
  const Y = v => padT + ih * (1 - (v - min) / (max - min));
  const fmt = opts.format || (v => String(Math.round(v)));
  let g = "";
  series.forEach(s => {
    const ps = s.puntos.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1);
    if (!ps.length) return;
    const pts = ps.map(p => [X(p.fecha), Y(p.value)]);
    g += `<path d="${pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    g += pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.8" fill="${s.color}"/>`).join("");
    const lp = pts[pts.length - 1];
    g += `<text x="${lp[0].toFixed(1)}" y="${(lp[1] - 7).toFixed(1)}" class="cval" text-anchor="end" fill="${s.color}">${fmt(ps[ps.length - 1].value)}</text>`;
  });
  const leg = series.map((s, i) => `<g transform="translate(${padL + i * 96}, 10)"><rect x="0" y="-7" width="11" height="4" rx="2" fill="${s.color}"/><text x="15" y="-3" class="cxlabel" fill="${s.color}">${s.nombre}</text></g>`).join("");
  const dates = `<text x="${padL}" y="${H - 3}" class="cxlabel">${fechaCorta(minF)}</text><text x="${(W - padR).toFixed(0)}" y="${H - 3}" class="cxlabel" text-anchor="end">${fechaCorta(maxF)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}${leg}${dates}</svg>`;
}
// Días desde la última medición de cintura o cadera (Infinity si nunca).
function diasDesdeMedida(user) {
  const h = DB.corpHistory(user).filter(r => r.cintura != null || r.cadera != null);
  return h.length ? daysAgoFrom(h[0].fecha) : Infinity;
}
function corpRow(r) {
  const partes = [];
  if (r.peso != null) partes.push(`${r.peso} kg`);
  if (r.cintura != null) partes.push(`${r.cintura} cm cint.`);
  if (r.cadera != null) partes.push(`${r.cadera} cm cad.`);
  if (r.sueno != null) partes.push(`😴 ${r.sueno}`);
  return `<button class="hist-row" data-corp-edit="${r.id}" type="button">
    <span class="hist-date">${fechaCorta(r.fecha)}</span>
    <span class="hist-main">${partes.join(" · ") || "—"}</span>
    <span class="hist-spacer"></span>
    <span class="hist-edit">✎</span></button>`;
}
function renderCorporal() {
  const body = $("#corp-body");
  const hist = DB.corpHistory(currentUser);
  const asc = hist.slice().reverse();
  const pesoSerie = asc.filter(r => r.peso != null).map(r => ({ label: r.fecha, value: Number(r.peso) }));
  const cintPts = asc.filter(r => r.cintura != null).map(r => ({ fecha: r.fecha, value: Number(r.cintura) }));
  const cadPts = asc.filter(r => r.cadera != null).map(r => ({ fecha: r.fecha, value: Number(r.cadera) }));
  const fmt1 = v => (Math.round(v * 10) / 10).toString();
  const aviso = diasDesdeMedida(currentUser) > 14 ? `<div class="corp-aviso">📏 Toca medir cintura y cadera</div>` : "";
  const chartCC = (cintPts.length + cadPts.length) >= 2 ? `<div class="metric-card"><div class="metric-title">Evolución de cintura y cadera (cm)</div>${svgMultiLine([
    { nombre: "Cintura", color: "var(--accent)", puntos: cintPts },
    { nombre: "Cadera", color: "var(--text-dim)", puntos: cadPts },
  ], { format: fmt1 })}</div>` : "";
  body.innerHTML = `
    ${aviso}
    <div class="corp-form">
      <div class="input-row">
        <div class="field full"><label>Fecha</label>
          <input type="date" id="corp-fecha" value="${hoyISO()}"></div>
      </div>
      <div class="input-row">
        <div class="field"><label>Peso (kg)</label>
          <input type="number" inputmode="decimal" step="0.1" id="corp-peso" placeholder="—"></div>
        <div class="field"><label>Sueño (1-10)</label>
          <input type="number" inputmode="numeric" step="1" min="1" max="10" id="corp-sueno" placeholder="—"></div>
      </div>
      <div class="input-row">
        <div class="field"><label>Cintura (cm)</label>
          <input type="number" inputmode="decimal" step="0.1" id="corp-cintura" placeholder="—">
          <span class="field-hint">a la altura del ombligo</span></div>
        <div class="field"><label>Cadera (cm)</label>
          <input type="number" inputmode="decimal" step="0.1" id="corp-cadera" placeholder="—">
          <span class="field-hint">en la parte más ancha</span></div>
      </div>
      <button class="btn-save" id="corp-save">Guardar</button>
    </div>
    ${pesoSerie.length >= 2 ? `<div class="metric-card"><div class="metric-title">Evolución del peso (kg)</div>${svgLine(pesoSerie, { format: fmt1 })}</div>` : ""}
    ${chartCC}
    <div class="section-label">Historial</div>
    ${hist.length ? `<div class="corp-list">${hist.map(corpRow).join("")}</div>` : `<div class="history-empty">Todavía no cargaste nada. 💪</div>`}`;
  $("#corp-save").onclick = saveCorporal;
  body.querySelectorAll("[data-corp-edit]").forEach(b => b.onclick = () => openCorpEdit(b.dataset.corpEdit));
}
function readCorpForm(prefix) {
  const g = id => (document.getElementById(id)?.value || "").trim();
  const n = v => v === "" ? null : Number(v);
  return { fecha: g(prefix + "fecha") || hoyISO(), peso: n(g(prefix + "peso")), cintura: n(g(prefix + "cintura")), cadera: n(g(prefix + "cadera")), sueno: n(g(prefix + "sueno")) };
}
async function saveCorporal() {
  const f = readCorpForm("corp-");
  if (f.peso == null && f.cintura == null && f.cadera == null && f.sueno == null) { toast("Cargá al menos un dato."); return; }
  await DB.corpSave({ usuario: currentUser, ...f });
  toast("Guardado 📏");
  renderCorporal();
}
function openCorpEdit(id) {
  const r = DB.corpHistory(currentUser).find(x => x.id === id);
  if (!r) return;
  const o = makeOverlay(`
    <div class="modal">
      <h3>Editar registro</h3>
      <div class="modal-sub">${fechaCorta(r.fecha)}</div>
      <div class="input-row"><div class="field full"><label>Fecha</label>
        <input type="date" id="ce-fecha" value="${r.fecha}"></div></div>
      <div class="input-row">
        <div class="field"><label>Peso (kg)</label><input type="number" step="0.1" id="ce-peso" value="${r.peso ?? ""}"></div>
        <div class="field"><label>Sueño</label><input type="number" step="1" min="1" max="10" id="ce-sueno" value="${r.sueno ?? ""}"></div>
      </div>
      <div class="input-row">
        <div class="field"><label>Cintura (cm)</label><input type="number" step="0.1" id="ce-cintura" value="${r.cintura ?? ""}"></div>
        <div class="field"><label>Cadera (cm)</label><input type="number" step="0.1" id="ce-cadera" value="${r.cadera ?? ""}"></div>
      </div>
      <button class="btn-save" id="ce-save">Guardar cambios</button>
      <div class="modal-row">
        <button class="btn-ghost" data-close>Cancelar</button>
        <button class="btn-danger" id="ce-del">Eliminar</button>
      </div>
    </div>`);
  o.querySelector("#ce-save").onclick = async () => { await DB.corpUpdate(id, readCorpForm("ce-")); o.remove(); renderCorporal(); toast("Actualizado"); };
  o.querySelector("#ce-del").onclick = async () => { if (!confirm("¿Eliminar este registro?")) return; await DB.corpRemove(id); o.remove(); renderCorporal(); toast("Eliminado"); };
}

// Guarda un marcador de actividad (caminata / fútbol) para un día.
async function marcarActividad(dia, nombre) {
  await DB.save({ fecha: hoyISO(), usuario: currentUser, dia: dia.id, ejercicio: "cardio",
    ejercicio_nombre: nombre, medida: "kg", kg: null, kg2: null, reps: null, rir: null, nota: "" });
  renderDays(); toast(`¡Anotado! ${nombre}`);
}
// Opciones de actividad de un día para un usuario (el fútbol es solo de Tato).
function opcionesDe(dia, user) {
  return (dia.opciones || ["Caminata"]).filter(op => op !== "Fútbol" || user === "tato");
}
function actividadesDe(dia, user) {
  return (dia.actividades || ["Caminata"]).filter(op => op !== "Fútbol" || user === "tato");
}
// Día con opciones de actividad (ej. Fútbol o caminata).
function openActividadChoice(dia) {
  const hoy = hoyISO();
  const yaHoy = DB.all().find(r => r.usuario === currentUser && r.fecha === hoy && r.dia === dia.id && r.ejercicio === "cardio");
  const ops = opcionesDe(dia, currentUser);
  const o = makeOverlay(`
    <div class="modal">
      <h3>${dia.nombre}</h3>
      <div class="modal-sub">${yaHoy ? `Hoy marcaste: ${yaHoy.ejercicio_nombre} ✅` : "¿Qué hiciste hoy?"}</div>
      ${ops.map((op, i) => `<button class="${i === 0 ? "btn-primary" : "btn-ghost"}" data-op="${op}" ${i ? 'style="margin-top:10px"' : ""}>${op}</button>`).join("")}
      <div class="modal-row"><button class="btn-ghost" data-close>Cerrar</button></div>
    </div>`);
  o.querySelectorAll("[data-op]").forEach(b => b.onclick = async () => { await marcarActividad(dia, b.dataset.op); o.remove(); });
}
// Día de entreno que también permite otra actividad (ej. Calistenia o caminata/fútbol).
function openEntrenoOActividad(dia) {
  const acts = actividadesDe(dia, currentUser);
  const entrenoLbl = (dia.subtitulo && dia.subtitulo.split(" ")[0]) || "Entrenar";
  const o = makeOverlay(`
    <div class="modal">
      <h3>${dia.nombre}</h3>
      <div class="modal-sub">¿Qué vas a hacer hoy?</div>
      <button class="btn-primary" id="opt-entreno">${entrenoLbl}</button>
      ${acts.map(a => `<button class="btn-ghost" data-op="${a}" style="margin-top:10px">${a}</button>`).join("")}
      <div class="modal-row"><button class="btn-ghost" data-close>Cerrar</button></div>
    </div>`);
  o.querySelector("#opt-entreno").onclick = () => { o.remove(); openDay(dia); };
  o.querySelectorAll("[data-op]").forEach(b => b.onclick = async () => { await marcarActividad(dia, b.dataset.op); o.remove(); });
}

// ================== PASO 5 — SUGERENCIA NUTRICIONAL (sin IA) ==================
// Datos físicos fijos (altura en cm, edad en años).
const PERFIL_FISICO = {
  tato: { sexo: "h", altura: 191, edad: 38, objetivo: "Recomposición", factorCal: 0.97, prot: 2.0, grasa: 0.9, legumbres: true },
  gabi: { sexo: "m", altura: 175, edad: 38, objetivo: "Marcar", marcar: true, factorCal: 1.00, prot: 1.7, grasa: 0.8, legumbres: false },
};
// "Recorte chico" de Gabi: resta 150 kcal al mantenimiento. Siempre manual, nunca automático.
const LS_RECORTE_GABI = "gym_recorte_gabi";
function recorteGabiOn() { try { return localStorage.getItem(LS_RECORTE_GABI) === "1"; } catch (e) { return false; } }
function setRecorteGabi(on) { try { localStorage.setItem(LS_RECORTE_GABI, on ? "1" : "0"); } catch (e) {} }
const COMIDAS = [
  { n: "Pechuga de pollo (150 g)", p: 33 },
  { n: "Carne magra — nalga/cuadrada (150 g)", p: 30 },
  { n: "Bife o asado magro (150 g)", p: 29 },
  { n: "Pescado — merluza (150 g)", p: 28 },
  { n: "Atún al natural (1 lata)", p: 26 },
  { n: "3 huevos", p: 18 },
  { n: "Yogur griego o natural (1 pote)", p: 15 },
  { n: "Queso magro (50 g)", p: 12 },
  { n: "Lentejas o garbanzos (1 plato)", p: 15, legumbre: true },
];
function isoMinusDays(iso, d) {
  const dt = new Date(Date.parse(iso + "T00:00:00") - d * 86400000);
  const mm = String(dt.getMonth() + 1).padStart(2, "0"), dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
// Ajuste quincenal según la tendencia de peso y cintura (~2 semanas).
function ajusteQuincenal(user) {
  const pes = DB.corpHistory(user).filter(r => r.peso != null); // desc por fecha
  if (pes.length < 2) return { kcal: 0, motivo: "Cargá al menos 2 pesadas (separadas ~2 semanas) para ajustar." };
  const latest = pes[0];
  const cutoff = isoMinusDays(latest.fecha, 14);
  let earlier = pes.find(r => r.fecha <= cutoff) || pes[pes.length - 1];
  if (earlier.id === latest.id) return { kcal: 0, motivo: "Todavía no hay ~2 semanas entre pesadas para ajustar." };
  const dPeso = latest.peso - earlier.peso;
  const cin = DB.corpHistory(user).filter(r => r.cintura != null);
  let dCint = null;
  if (cin.length >= 2) {
    const ec = cin.find(r => r.fecha <= cutoff) || cin[cin.length - 1];
    if (ec.id !== cin[0].id) dCint = cin[0].cintura - ec.cintura;
  }
  if (dCint != null && dCint > 0 && dPeso > 0)
    return { kcal: -150, motivo: `Subió la cintura (+${dCint.toFixed(1)} cm) y el peso (+${dPeso.toFixed(1)} kg) en ~2 semanas → bajar 150 kcal.` };
  if (dPeso < -1 && (dCint == null || dCint >= 0))
    return { kcal: 150, motivo: `Bajaste ${Math.abs(dPeso).toFixed(1)} kg sin bajar cintura → subir 150 kcal.` };
  return { kcal: 0, motivo: "Tendencia estable → mantener." };
}
function calcNutricion(user) {
  const pf = PERFIL_FISICO[user];
  if (!pf) return null;
  const ultima = DB.corpHistory(user).find(r => r.peso != null);
  if (!ultima) return { sinPeso: true };
  const peso = Number(ultima.peso);
  const bmr = 10 * peso + 6.25 * pf.altura - 5 * pf.edad + (pf.sexo === "h" ? 5 : -161);
  const tdee = bmr * 1.55;
  const r10 = x => Math.round(x / 10) * 10;
  const protG = Math.round(pf.prot * peso), grasaG = Math.round(pf.grasa * peso);
  const base = {
    pf, peso, fecha: ultima.fecha, tdee: r10(tdee),
    protG, grasaG, protKcal: protG * 4, grasaKcal: grasaG * 9,
    aguaBaja: (35 * peso / 1000).toFixed(1), aguaAlta: (45 * peso / 1000).toFixed(1),
  };

  // --- Rama Gabi (objetivo "marcar"): mantenimiento, nunca superávit. Recorte chico opcional y manual (-150). ---
  if (pf.marcar) {
    const recorte = recorteGabiOn();
    const final = recorte ? tdee - 150 : tdee;        // como máximo -150, nunca por encima del mantenimiento
    const carbKcal = Math.max(0, final - protG * 4 - grasaG * 9);
    return { ...base, marcar: true, recorte, calorias: r10(final), efectivo: recorte ? -150 : 0,
      carbG: Math.round(carbKcal / 4), carbKcal: Math.round(carbKcal) };
  }

  // --- Rama Tato (sin cambios): factor + ajuste quincenal automático. ---
  const baseCal = tdee * pf.factorCal;
  const aj = ajusteQuincenal(user);
  const final = baseCal + aj.kcal;
  const carbKcal = Math.max(0, final - protG * 4 - grasaG * 9);
  const efectivo = Math.round((final - baseCal) / 10) * 10; // ajuste real aplicado
  return { ...base, calorias: r10(final), efectivo,
    carbG: Math.round(carbKcal / 4), carbKcal: Math.round(carbKcal), ajuste: aj };
}
function openNutricion() { renderNutricion(); showScreen("nutricion"); DB.corpRefresh().then(ok => { if (ok) renderNutricion(); }); }
function renderNutricion() {
  const body = $("#nut-body");
  const d = calcNutricion(currentUser);
  const nombre = PLAN.usuarios[currentUser]?.nombre || currentUser;
  if (!d) { body.innerHTML = ""; return; }
  if (d.sinPeso) {
    body.innerHTML = `<div class="metric-card"><div class="chart-empty">Cargá tu peso en <b>Registro corporal</b> para ver tu sugerencia nutricional. 📏</div></div>`;
    return;
  }
  const comidas = COMIDAS.filter(c => !c.legumbre || d.pf.legumbres);
  const proteCard = `
    <div class="section-label">Para llegar a ~${d.protG} g de proteína</div>
    <div class="metric-card">
      <div class="nut-sub">Combiná 3-4 de estas opciones en el día:</div>
      ${comidas.map(c => `<div class="mini-row"><span class="mini-name">${c.n}</span><span class="mini-val">${c.p} g</span></div>`).join("")}
    </div>`;

  // --- Gabi: objetivo "marcar", con interruptor manual "Recorte chico". ---
  if (d.marcar) {
    body.innerHTML = `
      <div class="metric-card">
        <div class="metric-title">${nombre} · Marcar</div>
        <div class="metric-sub" style="text-align:left;margin-top:0">Peso usado: ${d.peso} kg (${fechaCorta(d.fecha)}) · Mantenimiento ≈ ${d.tdee} kcal</div>
      </div>
      <div class="metric-card">
        <div class="nut-note"><b>Objetivo: marcar.</b> Comer lo que gastás, proteína alta.</div>
      </div>
      ${statTiles([{ v: d.calorias, l: "kcal / día" }, { v: d.protG + " g", l: "Proteína" }])}
      ${statTiles([{ v: d.grasaG + " g", l: "Grasas" }, { v: d.carbG + " g", l: "Carbohidratos" }])}
      <div class="metric-card">
        <div class="metric-title">Agua</div>
        <div class="metric-sub" style="text-align:left;margin-top:0">${d.aguaBaja} – ${d.aguaAlta} litros por día</div>
      </div>
      <div class="metric-card">
        <div class="nut-note">💡 En los días de gimnasio, priorizá los carbohidratos: te dan energía para entrenar.</div>
      </div>
      <div class="metric-card">
        <label class="toggle-row" for="nut-recorte">
          <span><b>Recorte chico</b><br><span class="field-hint">Resta 150 kcal al mantenimiento. Se activa a mano, nunca solo.</span></span>
          <input type="checkbox" id="nut-recorte" ${d.recorte ? "checked" : ""}>
        </label>
        <div class="metric-sub" style="text-align:left;margin-top:8px">${d.recorte ? "Activado: −150 kcal sobre el mantenimiento." : "Desactivado: comés tu mantenimiento completo."}</div>
      </div>
      ${proteCard}`;
    const chk = $("#nut-recorte");
    if (chk) chk.onchange = (e) => { setRecorteGabi(e.target.checked); renderNutricion(); };
    return;
  }

  const signo = d.efectivo > 0 ? "+" : "";
  body.innerHTML = `
    <div class="metric-card">
      <div class="metric-title">${nombre} · ${d.pf.objetivo}</div>
      <div class="metric-sub" style="text-align:left;margin-top:0">Peso usado: ${d.peso} kg (${fechaCorta(d.fecha)}) · Mantenimiento ≈ ${d.tdee} kcal</div>
    </div>
    ${statTiles([{ v: d.calorias, l: "kcal / día" }, { v: d.protG + " g", l: "Proteína" }])}
    ${statTiles([{ v: d.grasaG + " g", l: "Grasas" }, { v: d.carbG + " g", l: "Carbohidratos" }])}
    <div class="metric-card">
      <div class="metric-title">Agua</div>
      <div class="metric-sub" style="text-align:left;margin-top:0">${d.aguaBaja} – ${d.aguaAlta} litros por día</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Ajuste quincenal ${d.efectivo !== 0 ? `(${signo}${d.efectivo} kcal)` : "(sin cambios)"}</div>
      <div class="metric-sub" style="text-align:left;margin-top:0">${d.ajuste.motivo}</div>
    </div>
    <div class="section-label">Para llegar a ~${d.protG} g de proteína</div>
    <div class="metric-card">
      <div class="nut-sub">Combiná 3-4 de estas opciones en el día:</div>
      ${comidas.map(c => `<div class="mini-row"><span class="mini-name">${c.n}</span><span class="mini-val">${c.p} g</span></div>`).join("")}
    </div>`;
}

// ---------------- Botones de navegación generales ----------------
function doGoto(target) {
  if (target === "user") { showScreen("user"); }
  else if (target === "days") { renderDays(); showScreen("days"); }
}$$("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.goto;
    // Si salimos de un ejercicio con datos sin guardar, preguntamos primero.
    if ($("#screen-exercise").classList.contains("active") && isDirty(currentIndex)) {
      openSavePrompt(currentIndex, () => doGoto(target));
      return;
    }
    doGoto(target);
  });
});
$("#btn-export").addEventListener("click", openExportMenu);
$("#btn-metrics").addEventListener("click", openMetrics);
$("#btn-corporal").addEventListener("click", openCorporal);
$("#btn-nutricion").addEventListener("click", openNutricion);
$$("#metrics-tabs button").forEach(b => b.addEventListener("click", () => { metricsTab = b.dataset.tab; renderMetrics(); }));
$$(".btn-user").forEach(b => b.addEventListener("click", () => selectUser(b.dataset.user)));

// ================== AUTENTICACIÓN (login por usuario) ==================
function authMsg(sel, msg, ok) {
  const el = $(sel);
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.toggle("ok", !!ok);
}
function authBusy(sel, busy, labelBusy) {
  const b = $(sel);
  if (busy && !b.dataset.idle) b.dataset.idle = b.textContent;
  b.disabled = busy;
  b.textContent = busy ? labelBusy : (b.dataset.idle || b.textContent);
  if (!busy) delete b.dataset.idle;
}
function showLogin(msg) {
  showScreen("login");
  if (msg) authMsg("#login-error", msg); else $("#login-error").classList.add("hidden");
}

// Entra a la app ya con sesión, según el rol del perfil.
function enterAuthedApp(profile) {
  PROFILE = profile;
  $("#btn-logout").classList.remove("hidden");
  if (profile.es_admin) {
    // Admin: puede ver a los dos → mantiene el selector de persona.
    $("#btn-days-back").classList.remove("hidden");
    const last = DB.getLastUser();
    if (last && PLAN.usuarios[last]) { document.body.dataset.user = last; selectUser(last); }
    else showScreen("user");
  } else {
    // Usuario normal: directo a SUS días, sin selector ni cambio de persona.
    $("#btn-days-back").classList.add("hidden");
    if (!profile.slug || !PLAN.usuarios[profile.slug]) {
      showLogin("Tu usuario no está enlazado a un perfil del plan. Avisale al administrador.");
      return;
    }
    selectUser(profile.slug);
  }
}

function wireAuthUI() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    authBusy("#login-submit", true, "Entrando…");
    const res = await DB.signIn($("#login-email").value, $("#login-pass").value);
    authBusy("#login-submit", false);
    if (res.error) { authMsg("#login-error", res.error); return; }
    if (res.profile?.sinPerfil) {
      await DB.signOut();
      authMsg("#login-error", "Tu usuario todavía no tiene perfil asignado. Avisale al administrador.");
      return;
    }
    $("#login-pass").value = "";
    enterAuthedApp(res.profile);
  });

  $("#login-forgot").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    if (!email) { authMsg("#login-error", "Escribí tu mail arriba y volvé a tocar el enlace."); return; }
    const res = await DB.sendRecovery(email);
    if (res.error) { authMsg("#login-error", res.error); return; }
    authMsg("#login-error", "Te enviamos un mail para recuperar tu contraseña.", true);
  });

  $("#setpass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("#setpass-p1").value, p2 = $("#setpass-p2").value;
    if (p1.length < 6) { authMsg("#setpass-error", "La contraseña debe tener al menos 6 caracteres."); return; }
    if (p1 !== p2) { authMsg("#setpass-error", "Las dos contraseñas no coinciden."); return; }
    authBusy("#setpass-submit", true, "Guardando…");
    const res = await DB.updatePassword(p1);
    authBusy("#setpass-submit", false);
    if (res.error) { authMsg("#setpass-error", res.error); return; }
    history.replaceState(null, "", window.location.pathname + window.location.search); // limpia el hash del link
    if (res.profile?.sinPerfil) {
      authMsg("#setpass-error", "Contraseña guardada, pero tu usuario no tiene perfil. Avisale al administrador.");
      return;
    }
    enterAuthedApp(res.profile);
  });

  $("#btn-logout").addEventListener("click", async () => {
    if (!confirm("¿Cerrar sesión?")) return;
    await DB.signOut();
    PROFILE = null;
    document.body.removeAttribute("data-user");
    $("#btn-logout").classList.add("hidden");
    showLogin();
  });
}

async function initAuthFlow() {
  wireAuthUI();
  // Si llega un evento de recuperación, mostramos "poner contraseña".
  DB.onAuth((event) => { if (event === "PASSWORD_RECOVERY") showScreen("setpass"); });

  const { session, profile } = await DB.initAuth();

  // ¿Viene de un link de invitación / recuperación por mail?
  if (AUTH_HASH === "invite" || AUTH_HASH === "signup" || AUTH_HASH === "recovery") {
    $("#setpass-sub").textContent = AUTH_HASH === "recovery"
      ? "Elegí una nueva contraseña" : "Creá tu contraseña para entrar";
    showScreen("setpass");
    return;
  }

  if (session && profile && !profile.sinPerfil) {
    enterAuthedApp(profile);
  } else if (session && profile && profile.sinPerfil) {
    await DB.signOut();
    showLogin("Tu usuario todavía no tiene perfil asignado. Avisale al administrador.");
  } else {
    showLogin();
  }
}

// Arranque sin login (comportamiento anterior: elegir Tato/Gabi).
function bootNoAuth() {
  const last = DB.getLastUser();
  if (last && PLAN.usuarios[last]) { document.body.dataset.user = last; selectUser(last); }
  else showScreen("user");
}

// ---------------- Arranque ----------------
async function init() {
  try {
    const res = await fetch("./plan.json", { cache: "no-cache" });
    PLAN = await res.json();
  } catch (e) {
    document.body.innerHTML = "<p style='padding:24px'>No se pudo cargar el plan (plan.json).</p>";
    return;
  }

  renderStatusBar();

  if (DB.authEnabled()) {
    await initAuthFlow();
  } else {
    bootNoAuth();
  }
}

init();
