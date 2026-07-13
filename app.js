// ============================================================
//  app.js  —  Lógica de la aplicación
// ============================================================
import { DB } from "./db.js";

let PLAN = null;
let currentUser = null;     // 'tato' | 'gabi'
let currentDay = null;      // objeto del día
let exercises = [];         // ejercicios resueltos del día para el usuario
let currentIndex = 0;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

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

// Resuelve un ejercicio del plan para un usuario (aplica variantes y notas).
function resolveExercise(ex, user) {
  let base = ex;
  if (ex.variantes && ex.variantes[user]) {
    base = { ...ex, ...ex.variantes[user] };
  }
  const nota = ex.notas && ex.notas[user] ? ex.notas[user] : null;
  return {
    id: ex.id,
    nombre: base.nombre,
    series: base.series,
    reps: base.reps,
    indicacion: base.indicacion,
    notaUsuario: nota,
    medida: base.medida || "kg",   // 'kg' | 'reps' | 'seg' (posición inicial del toggle)
    video: base.video || null,     // URL del video (YouTube = embebido; otro sitio = botón)
    superset: Array.isArray(base.superset) && base.superset.length === 2 ? base.superset : null,
    // Reps variables: el objetivo es un rango (ej. "10-12") -> campo para anotar las reps hechas.
    repsVar: !base.superset && /\d\s*-\s*\d/.test(String(base.reps || "")),
  };
}
function objetivo(ex) {
  return `${ex.series} × ${ex.reps}`;
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
  if (ss) {
    h += `<div class="input-row">
      <div class="field"><label>${ss[0]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val}" value="${num(init.val)}" placeholder="kg" /></div>
      <div class="field"><label>${ss[1]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val2}" value="${num(init.val2)}" placeholder="kg" /></div>
    </div>
    <div class="input-row">
      <div class="field"><label>RIR</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.rir}" value="${num(init.rir)}" placeholder="1" /></div>
      <div class="field" aria-hidden="true" style="visibility:hidden"></div>
    </div>`;
  } else if (ex.repsVar) {
    // Ejercicio con rango de reps: peso + reps hechas (fila 1) y RIR (fila 2).
    // El campo Reps solo aplica cuando la medida es peso (kg).
    const showReps = med === "kg" ? "" : "display:none";
    h += `<div class="input-row">
      <div class="field"><label id="${ids.vlabel}">${MEDIDAS[med]}</label>
        <input type="number" inputmode="decimal" step="0.5" id="${ids.val}" value="${num(init.val)}" placeholder="—" /></div>
      <div class="field" id="${ids.repsField}" style="${showReps}"><label>Reps</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.reps}" value="${num(init.reps)}" placeholder="—" /></div>
    </div>
    <div class="input-row">
      <div class="field"><label>RIR</label>
        <input type="number" inputmode="numeric" step="1" id="${ids.rir}" value="${num(init.rir)}" placeholder="—" /></div>
      <div class="field" aria-hidden="true" style="visibility:hidden"></div>
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

function renderStatusBar() {
  const bar = $("#statusBar");
  const p = DB.pendingCount();
  if (!navigator.onLine) {
    bar.className = "status-bar offline";
    bar.textContent = p > 0
      ? `Sin conexión · ${p} carga${p > 1 ? "s" : ""} se subir${p > 1 ? "án" : "á"} a Supabase al volver la señal`
      : "Sin conexión · lo que cargues se subirá a Supabase al volver la señal";
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

DB.onStatus(() => renderStatusBar());
window.addEventListener("online", renderStatusBar);
window.addEventListener("offline", renderStatusBar);

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

// ---------------- Menú de días ----------------
function renderDays() {
  const cont = $("#days-list");
  cont.innerHTML = "";
  PLAN.dias.forEach(dia => {
    const n = dia.ejercicios.length;
    const card = document.createElement("button");
    card.className = "day-card";
    card.innerHTML = `
      <span class="day-name">${dia.nombre}</span>
      <span class="day-sub">${dia.subtitulo || ""}</span>
      <span class="day-count">${n} ejercicios</span>`;
    card.addEventListener("click", () => openDay(dia));
    cont.appendChild(card);
  });
}

// ---------------- Abrir un día ----------------
function openDay(dia) {
  currentDay = dia;
  exercises = dia.ejercicios.map(ex => resolveExercise(ex, currentUser));
  currentIndex = 0;
  $("#ex-day-name").textContent = `${dia.nombre} · ${dia.subtitulo || ""}`;
  renderExercises();
  renderDots();
  renderUserSwitch();
  refreshDoneDots();
  showScreen("exercise");
  requestAnimationFrame(() => scrollToIndex(0, false));
  DB.refresh().then(ok => { if (ok) refreshVisibleHistories(); });
}

// ---------------- Cambiar de persona (mismo día y nº de ejercicio) ----------------
function renderUserSwitch() {
  const el = $("#user-switch");
  el.innerHTML = "";
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
  exercises = currentDay.ejercicios.map(ex => resolveExercise(ex, user));
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

// Re-dibuja los historiales visibles (ej: después de bajar datos del server).
function refreshVisibleHistories() {
  exercises.forEach((ex, i) => {
    const el = $(`#hist-${i}`);
    if (el) renderHistoryInto(el, ex.id);
  });
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
}

function buildExerciseCard(ex, index) {
  const frag = document.createElement("div");

  // Encabezado
  const header = document.createElement("div");
  header.className = "ex-header";
  header.innerHTML = `
    <h2 class="ex-name">${ex.nombre}</h2>
    <span class="ex-target">${objetivo(ex)}</span>
    <p class="ex-cue">${ex.indicacion || ""}</p>
    ${ex.notaUsuario ? `<div class="ex-note">📌 ${ex.notaUsuario}</div>` : ""}`;
  frag.appendChild(header);

  // Video (reproductor + opciones; o botón para agregar si no hay)
  frag.appendChild(buildVideoBlock(ex));

  // Historial
  const histLabel = document.createElement("div");
  histLabel.className = "section-label";
  histLabel.textContent = "Historial";
  frag.appendChild(histLabel);

  const hist = document.createElement("div");
  hist.className = "history";
  hist.id = `hist-${index}`;
  frag.appendChild(hist);
  renderHistoryInto(hist, ex.id);

  // Formulario de carga
  const formLabel = document.createElement("div");
  formLabel.className = "section-label";
  formLabel.textContent = "Cargar hoy";
  frag.appendChild(formLabel);

  const form = document.createElement("div");
  form.className = "load-form";
  const ids = cardIds(index);
  form.innerHTML = fieldsHTML(ids, ex, {}) +
    `<button class="btn-save" id="save-${index}">Guardar</button>`;
  frag.appendChild(form);

  attachToggle(form, ids);
  form.querySelector(`#save-${index}`).addEventListener("click", () => saveExercise(index));
  return frag;
}

function renderHistoryInto(el, exerciseId) {
  const rows = DB.history(currentUser, exerciseId).slice(0, 8);
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
      if (rec) openEditModal(rec, () => { renderHistoryInto(el, exerciseId); refreshDoneDots(); });
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
  renderHistoryInto($(`#hist-${index}`), ex.id);
  markDotDone(index);
  renderStatusBar();
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

  if (index === exercises.length - 1) {
    setTimeout(() => showSummary(), 700);
  } else {
    setTimeout(() => scrollToIndex(index + 1, true), 700);
  }
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
  target = Math.max(0, Math.min(exercises.length - 1, target));
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
  $("#arrow-next").disabled = currentIndex === exercises.length - 1;
}

function scrollToIndex(i, smooth) {
  i = Math.max(0, Math.min(exercises.length - 1, i));
  const vp = $("#exercise-viewport");
  vp.scrollTo({ left: vp.clientWidth * i, behavior: smooth ? "smooth" : "auto" });
  currentIndex = i;
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

  const cont = $("#summary-content");
  const nombreUser = PLAN.usuarios[currentUser]?.nombre || currentUser;
  let html = `<div class="sum-celebrate">🎉 ¡Sesión terminada!</div>
    <h2>${currentDay.nombre} · ${currentDay.subtitulo || ""}</h2>
    <div class="sum-date">${nombreUser} · ${fechaCorta(fecha)}</div>`;

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
  cont.innerHTML = html;
  showScreen("summary");
  launchConfetti();
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

  const colors = ["#3B82F6", "#EC4899", "#f59e0b", "#22c55e", "#a855f7", "#f5f5f5"];
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
function exportBackup() {
  const data = DB.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fecha = hoyISO();
  a.href = url;
  a.download = `respaldo-gym-${fecha}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Respaldo descargado 📁");
}

// ---------------- Botones de navegación generales ----------------
function doGoto(target) {
  if (target === "user") { showScreen("user"); }
  else if (target === "days") { renderDays(); showScreen("days"); }
}
$$("[data-goto]").forEach(btn => {
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
$("#btn-export").addEventListener("click", exportBackup);
$$(".btn-user").forEach(b => b.addEventListener("click", () => selectUser(b.dataset.user)));

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

  const last = DB.getLastUser();
  if (last && PLAN.usuarios[last]) {
    // Recuerda el último usuario, pero igual mostramos la pantalla inicial
    // con ese usuario ya resaltado por si querés cambiar.
    document.body.dataset.user = last;
  }
  // Si hay un último usuario, entramos directo a sus días.
  if (last && PLAN.usuarios[last]) {
    selectUser(last);
  } else {
    showScreen("user");
  }
}

init();
