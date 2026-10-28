/*
 * Access Card (FR)
 * Carte Home Assistant pour les accès (portail, garage…) : caméra en direct, déblocage avec cadenas animé et
 * compte à rebours de re-verrouillage automatique, boutons d'ouverture visibles uniquement une fois débloqué,
 * avec double appui de confirmation. Style verre, thème clair/sombre automatique, éditeur visuel, textes en français.
 */
const CARD_VERSION = "1.0.0";

/* === NUANCE COMMUNE v2 (cartes Johan854) ===
 * Bloc identique dans toutes les cartes. Options : nuance, nuance_perso, intensite.
 * nuance "theme" (par défaut) : suit la variable carte-nuance du thème Home Assistant ;
 * si elle n'existe pas, la carte garde ses couleurs d'origine. Intensité : 0 = neutre, 1 = normal, 2 = très coloré. */
const GV_NUANCES = [["braise", "Braise (rouge)", "#e0524f"], ["ocean", "Océan (bleu)", "#2f8fd8"], ["lagon", "Lagon (turquoise)", "#1fb5a8"], ["foret", "Forêt (vert)", "#3fae5a"], ["lavande", "Lavande (violet)", "#8a63d8"], ["framboise", "Framboise (rose)", "#e05597"], ["ambre", "Ambre (orange)", "#e8902c"], ["ardoise", "Ardoise (neutre)", "#7d8595"]];
const GV_DEFAULTS = { nuance: "theme", intensite: 1 };
const gvAccent = (c) => {
  const p = c && c.nuance_perso;
  if (c && c.nuance === "perso") {
    if (Array.isArray(p) && p.length === 3) return "#" + p.map((v) => Math.max(0, Math.min(255, Math.round(+v || 0))).toString(16).padStart(2, "0")).join("");
    if (typeof p === "string" && /^#?[0-9a-f]{6}$/i.test(p.trim())) return "#" + p.trim().replace("#", "");
  }
  const n = GV_NUANCES.find((x) => x[0] === (c && c.nuance));
  return n ? n[2] : "var(--carte-nuance)";
};
/* Variables posées sur <ha-card> : --g-bg-x (fond dégradé teinté) et --acc-ui-x (couleur d'accent).
 * Sans nuance (thème sans carte-nuance), elles sont invalides : chaque carte retombe alors sur ses couleurs d'origine. */
const gvStyle = (c, dark) => {
  const i = Number(c && c.intensite), ai = Number.isFinite(i) ? Math.max(0, Math.min(2, i)) : 1;
  const m = (pct, base) => `color-mix(in srgb,var(--acc-ui) ${+(pct * ai).toFixed(1)}%,${base})`;
  const bg = dark ? `linear-gradient(160deg,${m(5, "#1b1e32")} 0%,${m(11, "#1f1b2c")} 55%,${m(22, "#1c1620")} 100%)`
    : `linear-gradient(160deg,${m(2, "#f8f9fd")} 0%,${m(5, "#eef1f8")} 55%,${m(11, "#f8f8fa")} 100%)`;
  return `--acc-ui:${gvAccent(c)};--g-bg-x:${bg};--acc-ui-x:color-mix(in srgb,var(--acc-ui) ${dark ? "80%,#fff" : "82%,#000"})`;
};
const GV_FIELDS = [
  { name: "nuance", selector: { select: { mode: "dropdown", options: [{ value: "theme", label: "Selon le thème (couleurs d'origine)" }, ...GV_NUANCES.map((n) => ({ value: n[0], label: n[1] })), { value: "perso", label: "Personnalisée" }] } } },
  { name: "nuance_perso", selector: { color_rgb: {} } },
  { name: "intensite", selector: { number: { min: 0, max: 2, step: 0.1, mode: "slider" } } }];
const GV_LABELS = { nuance: "Nuance de couleur", nuance_perso: "Couleur personnalisée (nuance « Personnalisée »)", intensite: "Intensité de la nuance" };
/* === FIN NUANCE COMMUNE === */
const DEFAULTS = { title: "Accès", theme: "auto", ...GV_DEFAULTS, accesses: [] };
const ACC_DEFAULTS = { name: "Portail", icon: "mdi:gate", camera_entity: "", unlock_entity: "", state_entity: "", relock_minutes: 5, confirm: true, buttons: [] };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gone = (st) => !st || st.state === "unavailable" || st.state === "unknown";
const CIRC = 2 * Math.PI * 22;
const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const normAcc = (a) => ({ ...ACC_DEFAULTS, ...a, buttons: (a.buttons || []).map((b) => (typeof b === "string" ? { entity: b } : { ...b })) });

class AccessCard extends HTMLElement {
  static getConfigElement() { return document.createElement("access-card-editor"); }
  static getStubConfig() {
    return { ...DEFAULTS, accesses: [{ name: "Portail", icon: "mdi:gate", unlock_entity: "", relock_minutes: 5, buttons: [{ entity: "", name: "Piéton", icon: "mdi:walk" }] }] };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = ""; this._cams = {}; this._armed = null; this._fired = {}; this._relocked = {};
  }

  setConfig(config) {
    if (!config) throw new Error("Configuration invalide");
    this._config = { ...DEFAULTS, ...config, accesses: (config.accesses || []).map(normAcc) };
    this._cams = {}; this._sig = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const sig = this._ids().map((e) => { const s = hass.states[e]; return s ? s.state + "|" + s.last_changed : "x"; }).join(";") + (this._isDark() ? "d" : "l") + "|" + this._armed + "|" + Object.keys(this._fired).join();
    if (sig !== this._sig) { this._sig = sig; this._render(); }
    Object.values(this._cams).forEach((c) => { if (c.el) c.el.hass = hass; });
  }

  connectedCallback() { this._timer = setInterval(() => this._tick(), 1000); }
  disconnectedCallback() { clearInterval(this._timer); }
  getCardSize() { return 3 + this._config.accesses.length * 3; }

  _ids() {
    const out = [];
    (this._config.accesses || []).forEach((a) => { [a.camera_entity, a.unlock_entity, a.state_entity, ...a.buttons.map((b) => b.entity)].forEach((e) => e && out.push(e)); });
    return out;
  }

  _isDark() {
    const t = this._config && this._config.theme;
    if (t === "dark") return true;
    if (t === "light") return false;
    const dm = this._hass && this._hass.themes && this._hass.themes.darkMode;
    return typeof dm === "boolean" ? dm : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  _more(id) { if (id) this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: id } })); }

  _unlocked(a) {
    if (!a.unlock_entity) return true;
    const st = this._hass.states[a.unlock_entity];
    return !!st && st.state === "on";
  }

  _remaining(a) {
    const st = this._hass.states[a.unlock_entity];
    const min = Number(a.relock_minutes);
    if (!st || st.state !== "on" || !(min > 0)) return null;
    const t0 = Date.parse(st.last_changed);
    return isFinite(t0) ? t0 + min * 60000 - Date.now() : null;
  }

  _tick() {
    const h = this._hass, c = this._config;
    if (!h || !c) return;
    c.accesses.forEach((a, i) => {
      const rem = this._remaining(a);
      if (rem === null) return;
      const root = this.shadowRoot, total = Number(a.relock_minutes) * 60000;
      const cd = root.querySelector(`[data-cd="${i}"]`);
      if (cd) cd.textContent = mmss(rem);
      const ring = root.querySelector(`[data-ring="${i}"]`);
      if (ring) { ring.style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, rem / total)))); ring.parentNode.parentNode.classList.toggle("soon", rem < 60000); }
      if (rem <= 0) {
        const st = h.states[a.unlock_entity], key = st.last_changed, last = this._relocked[a.unlock_entity];
        if (!last || last.key !== key || Date.now() - last.at > 30000) {
          this._relocked[a.unlock_entity] = { key, at: Date.now() };
          h.callService("homeassistant", "turn_off", { entity_id: a.unlock_entity });
        }
      }
    });
  }

  _toggleLock(i) {
    const a = this._config.accesses[i];
    if (!a || !a.unlock_entity) return;
    this._hass.callService("homeassistant", this._unlocked(a) ? "turn_off" : "turn_on", { entity_id: a.unlock_entity });
  }

  _press(i, j) {
    const a = this._config.accesses[i], b = a && a.buttons[j];
    if (!b || !b.entity) return;
    const key = `${i}:${j}`;
    if (a.confirm !== false && this._armed !== key) {
      this._armed = key; this._sig = ""; this._render();
      clearTimeout(this._armT);
      this._armT = setTimeout(() => { if (this._armed === key) { this._armed = null; this._sig = ""; this._render(); } }, 3500);
      return;
    }
    clearTimeout(this._armT); this._armed = null;
    const dom = b.entity.split(".")[0];
    if (dom === "button") this._hass.callService("button", "press", { entity_id: b.entity });
    else if (dom === "script") this._hass.callService("script", "turn_on", { entity_id: b.entity });
    else this._hass.callService("homeassistant", "toggle", { entity_id: b.entity });
    this._fired[key] = Date.now();
    this._sig = ""; this._render();
    setTimeout(() => { delete this._fired[key]; this._sig = ""; this._render(); }, 2800);
  }

  async _mountCam(i, host) {
    const a = this._config.accesses[i];
    let slot = this._cams[i];
    if (!slot) { slot = this._cams[i] = { el: null, ready: false }; }
    if (slot.el) { host.appendChild(slot.el); return; }
    if (slot.pending) return;
    slot.pending = true;
    let el = null;
    try {
      const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      if (helpers) {
        el = await helpers.createCardElement({ type: "picture-entity", entity: a.camera_entity, camera_image: a.camera_entity, camera_view: "live", show_name: false, show_state: false, fit_mode: "cover" });
        el.style.cssText = "display:block;--ha-card-border-width:0;--ha-card-box-shadow:none;--ha-card-border-radius:0;";
      }
    } catch (e) { el = null; }
    if (!el) {
      el = document.createElement("img"); el.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
      const upd = () => { const st = this._hass && this._hass.states[a.camera_entity]; if (st && st.attributes.entity_picture) el.src = this._hass.hassUrl ? this._hass.hassUrl(st.attributes.entity_picture) : st.attributes.entity_picture; };
      upd(); el._int = setInterval(upd, 10000);
    }
    slot.el = el; slot.pending = false;
    if (this._hass && "hass" in el) el.hass = this._hass;
    const h = this.shadowRoot.querySelector(`[data-cam="${i}"]`);
    if (h) h.appendChild(el);
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const dark = this._isDark();
    const sections = c.accesses.map((a, i) => {
      const unlocked = this._unlocked(a);
      const hasLock = !!a.unlock_entity;
      const rem = hasLock ? this._remaining(a) : null;
      const st = a.state_entity ? h.states[a.state_entity] : null;
      let chip = "";
      if (st) {
        const dc = st.attributes.device_class, doorLike = ["door", "garage_door", "opening", "window", "gate"].includes(dc) || a.state_entity.startsWith("cover.");
        const open = st.state === "on" || st.state === "open" || st.state === "opening";
        const txt = gone(st) ? "Inconnu" : doorLike ? (open ? "Ouvert" : "Fermé") : st.state;
        chip = `<button class="chip ${gone(st) ? "na" : doorLike && open ? "open" : "ok"}" data-more="${esc(a.state_entity)}"><ha-icon icon="${doorLike && open ? "mdi:lock-open-variant-outline" : "mdi:check-circle-outline"}"></ha-icon>${esc(txt)}</button>`;
      }
      const lockUi = hasLock ? `<button class="lockbtn ${unlocked ? "open" : ""}" data-toggle="${i}" aria-label="${unlocked ? "Verrouiller" : "Débloquer"}">
          <svg viewBox="0 0 48 48"><circle class="rbg" cx="24" cy="24" r="22"/><circle class="ring" data-ring="${i}" cx="24" cy="24" r="22" transform="rotate(-90 24 24)" style="stroke-dasharray:${CIRC.toFixed(2)};stroke-dashoffset:${unlocked && rem !== null ? (CIRC * (1 - Math.max(0, Math.min(1, rem / (Number(a.relock_minutes) * 60000))))).toFixed(2) : unlocked ? "0" : "0"}"/>
          <g class="pad"><path class="shackle" d="M17 22v-5a7 7 0 0 1 14 0v5"/><rect class="pbody" x="13" y="22" width="22" height="15" rx="3.5"/><circle class="pkey" cx="24" cy="29.2" r="2"/></g></svg></button>` : `<span class="lockbtn free"><ha-icon icon="${esc(a.icon || "mdi:gate")}"></ha-icon></span>`;
      const sub = !hasLock ? "Toujours actif" : unlocked ? (rem !== null ? `Débloqué · re-verrouillage dans <b data-cd="${i}">${mmss(rem)}</b>` : "Débloqué") : "Verrouillé";
      const pill = hasLock ? `<button class="pill ${unlocked ? "lock" : "unlock"}" data-toggle="${i}"><ha-icon icon="${unlocked ? "mdi:lock-outline" : "mdi:lock-open-variant-outline"}"></ha-icon>${unlocked ? "Verrouiller" : "Débloquer"}</button>` : "";
      const btns = a.buttons.map((b, j) => {
        const key = `${i}:${j}`, armed = this._armed === key, fired = !!this._fired[key];
        const stt = b.entity ? h.states[b.entity] : null;
        const label = b.name || (stt && stt.attributes.friendly_name) || b.entity;
        const ico = fired ? "mdi:check" : armed ? "mdi:gesture-tap" : b.icon || (stt && stt.attributes.icon) || "mdi:gesture-tap-button";
        return `<button class="act ${armed ? "armed" : ""} ${fired ? "fired" : ""}" data-act="${key}"><ha-icon icon="${esc(ico)}"></ha-icon><span>${fired ? "Envoyé" : armed ? "Confirmer ?" : esc(label)}</span></button>`;
      }).join("");
      const body = unlocked && a.buttons.length ? `<div class="btns n${Math.min(a.buttons.length, 4)}">${btns}</div>` : "";
      return `<section class="acc glass ${unlocked ? "open" : "locked"}">
        ${a.camera_entity ? `<div class="cam" data-cam="${i}"><span class="live"><i></i>En direct</span></div>` : ""}
        <div class="row">${lockUi}<div class="txt"><b>${esc(a.name)}</b><span class="sub">${sub}</span></div>${chip}${pill}</div>${body}</section>`;
    }).join("");

    this.shadowRoot.innerHTML = `<style>
      * { box-sizing:border-box; }
      ha-card.dark { --ac-text:#f4f6fb; --ac-muted:#a9afc0; --ac-bg:var(--g-bg-x,linear-gradient(160deg,#1b1e32 0%,#241a2a 55%,#2d1519 100%)); --ac-border:rgba(255,255,255,.14); --ac-shadow:0 .6em 2em rgba(0,0,0,.35);
        --ac-glass:rgba(255,255,255,.07); --ac-glass-b:rgba(255,255,255,.13); --ac-fill:rgba(255,255,255,.09); --ac-fill-b:rgba(255,255,255,.16); --ac-ok:#3ddc84; --ac-warn:#ffb86b; --ac-err:#ff5a5f; --ac-track:rgba(255,255,255,.14); }
      ha-card.light { --ac-text:#1c2030; --ac-muted:#5d6477; --ac-bg:var(--g-bg-x,linear-gradient(160deg,#f8f9fd 0%,#eef1f8 55%,#f8eff0 100%)); --ac-border:rgba(20,24,40,.12); --ac-shadow:0 .4em 1.4em rgba(20,24,40,.12);
        --ac-glass:rgba(255,255,255,.7); --ac-glass-b:rgba(20,24,40,.1); --ac-fill:rgba(20,24,40,.06); --ac-fill-b:rgba(20,24,40,.14); --ac-ok:#1a9d55; --ac-warn:#c77a14; --ac-err:#d32f35; --ac-track:rgba(20,24,40,.12); }
      ha-card { container-type:inline-size; display:flex; flex-direction:column; gap:12px; padding:16px; color:var(--ac-text); border-radius:24px; border:1px solid var(--ac-border); background:var(--ac-bg); box-shadow:var(--ac-shadow); overflow:hidden; }
      ha-icon { --mdc-icon-size:1.3em; flex:none; }
      button { font:inherit; color:inherit; background:none; border:0; padding:0; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent; touch-action:manipulation; }
      .t { font-weight:700; font-size:1.05em; }
      .glass { background:var(--ac-glass); border:1px solid var(--ac-glass-b); -webkit-backdrop-filter:blur(18px) saturate(140%); backdrop-filter:blur(18px) saturate(140%); }
      .acc { border-radius:20px; overflow:hidden; display:flex; flex-direction:column; }
      .cam { position:relative; aspect-ratio:16/9; background:#0b0d14; overflow:hidden; } .cam > :not(.live) { position:absolute; inset:0; width:100%; height:100%; }
      .live { position:absolute; z-index:2; top:.6em; left:.6em; display:flex; align-items:center; gap:.4em; font-size:.72em; font-weight:700; padding:.25em .6em; border-radius:2em; background:rgba(0,0,0,.55); color:#fff; backdrop-filter:blur(6px); }
      .live i { width:.55em; height:.55em; border-radius:50%; background:#ff5a5f; animation:ac-p 1.6s ease-in-out infinite; }
      .row { display:flex; align-items:center; gap:.8em; padding:12px 14px; flex-wrap:wrap; }
      .txt { flex:1; min-width:8em; display:flex; flex-direction:column; gap:.15em; } .txt b { font-size:1.05em; } .sub { font-size:.82em; color:var(--ac-muted); font-variant-numeric:tabular-nums; } .sub b { color:var(--ac-text); font-size:1em; }
      .lockbtn { position:relative; width:3.4em; height:3.4em; flex:none; display:grid; place-items:center; border-radius:50%; }
      .lockbtn.free { background:var(--ac-fill); border:1px solid var(--ac-fill-b); color:var(--ac-ok); }
      .lockbtn svg { width:100%; height:100%; overflow:visible; }
      .rbg { fill:none; stroke:var(--ac-track); stroke-width:3; } .ring { fill:none; stroke:var(--ac-err); stroke-width:3; stroke-linecap:round; transition:stroke-dashoffset 1s linear, stroke .3s; }
      .lockbtn.open .ring { stroke:var(--ac-ok); } .lockbtn.open.soon .ring { stroke:var(--ac-warn); }
      .shackle { fill:none; stroke:var(--ac-err); stroke-width:3.2; stroke-linecap:round; transform-box:fill-box; transform-origin:100% 100%; transition:transform .35s cubic-bezier(.3,1.4,.5,1), stroke .3s; }
      .pbody { fill:var(--ac-err); transition:fill .3s; } .pkey { fill:rgba(255,255,255,.85); }
      .lockbtn.open .shackle { stroke:var(--ac-ok); transform:translateY(-3px) rotate(-22deg); } .lockbtn.open .pbody { fill:var(--ac-ok); }
      .lockbtn.open.soon .shackle { stroke:var(--ac-warn); } .lockbtn.open.soon .pbody { fill:var(--ac-warn); }
      .chip { display:inline-flex; align-items:center; gap:.35em; font-size:.8em; font-weight:600; padding:.3em .7em; border-radius:2em; background:var(--ac-fill); border:1px solid var(--ac-fill-b); }
      .chip.ok { color:var(--ac-ok); } .chip.open { color:var(--ac-warn); } .chip.na { color:var(--ac-muted); }
      .pill { display:inline-flex; align-items:center; gap:.4em; font-weight:700; font-size:.9em; padding:.55em 1em; border-radius:2em; border:1px solid var(--ac-fill-b); background:var(--ac-fill); }
      .pill.unlock { background:color-mix(in srgb, var(--ac-ok) 18%, transparent); border-color:var(--ac-ok); color:var(--ac-ok); } .pill.lock { color:var(--ac-err); border-color:var(--ac-err); }
      .btns { display:grid; gap:.6em; padding:0 14px 14px; grid-template-columns:repeat(auto-fit,minmax(7em,1fr)); }
      .act { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.35em; padding:.9em .5em; min-height:4.6em; border-radius:1em; text-align:center; font-weight:700; font-size:.9em; background:var(--ac-fill); border:1px solid var(--ac-fill-b); transition:background .2s, transform .1s; }
      .act ha-icon { --mdc-icon-size:1.7em; } .act:active { transform:scale(.97); }
      .act.armed { background:color-mix(in srgb, var(--ac-warn) 25%, transparent); border-color:var(--ac-warn); animation:ac-p 1s ease-in-out infinite; }
      .act.fired { background:color-mix(in srgb, var(--ac-ok) 25%, transparent); border-color:var(--ac-ok); color:var(--ac-ok); }
      .empty { text-align:center; color:var(--ac-muted); padding:1.2em; font-size:.9em; }
      @keyframes ac-p { 50% { opacity:.55; } }
      @media (prefers-reduced-motion: reduce) { .live i, .act.armed { animation:none; } .ring, .shackle { transition:none; } }
    </style>
    <ha-card class="${dark ? "dark" : "light"}" style="${gvStyle(c, dark)}">
      ${c.title ? `<div class="t">${esc(c.title)}</div>` : ""}
      ${sections || `<div class="empty">Ajoute un accès (portail, garage…) dans l'éditeur.</div>`}
    </ha-card>`;
    const root = this.shadowRoot;
    root.querySelectorAll("[data-toggle]").forEach((el) => el.addEventListener("click", () => this._toggleLock(Number(el.dataset.toggle))));
    root.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", () => { const [i, j] = el.dataset.act.split(":").map(Number); this._press(i, j); }));
    root.querySelectorAll("[data-more]").forEach((el) => el.addEventListener("click", () => this._more(el.dataset.more)));
    root.querySelectorAll("[data-cam]").forEach((el) => this._mountCam(Number(el.dataset.cam), el));
  }
}

/* ---------- Éditeur visuel ---------- */
const LABELS = { ...GV_LABELS, title: "Titre de la carte", theme: "Thème", name: "Nom de l'accès", icon: "Icône (sans cadenas)", camera_entity: "Caméra (facultatif)",
  unlock_entity: "Interrupteur de déblocage (input_boolean)", state_entity: "Capteur ouvert / fermé (facultatif)", relock_minutes: "Re-verrouillage après (minutes, 0 = jamais)",
  confirm: "Demander une confirmation (double appui)", entity: "Entité à actionner" };
const TOP = [
  { type: "grid", name: "", schema: [{ name: "title", selector: { text: {} } },
    { name: "theme", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Automatique" }, { value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }] } } }] },
  { type: "expandable", name: "", title: "Nuance de couleur", schema: GV_FIELDS },
];
const ACC = [
  { type: "grid", name: "", schema: [{ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }] },
  { name: "camera_entity", selector: { entity: { domain: "camera" } } },
  { name: "unlock_entity", selector: { entity: { domain: ["input_boolean", "switch"] } } },
  { name: "state_entity", selector: { entity: {} } },
  { type: "grid", name: "", schema: [{ name: "relock_minutes", selector: { number: { min: 0, max: 120, mode: "box" } } }, { name: "confirm", selector: { boolean: {} } }] },
];
const BTN = [{ name: "entity", selector: { entity: {} } }, { type: "grid", name: "", schema: [{ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }] }];

class AccessCardEditor extends HTMLElement {
  _sigOf(cfg) { return cfg.accesses.map((a) => a.buttons.length).join(",") + "/" + cfg.accesses.length; }
  setConfig(config) {
    const next = { ...DEFAULTS, ...config, accesses: (config.accesses || []).map(normAcc) };
    const same = this._built && this._config && this._sigOf(next) === this._sigOf(this._config);
    this._config = next;
    if (!same) return this._build();
    this._forms.forEach((f) => { f.el.data = f.get(this._config); });
  }
  set hass(h) { this._hass = h; (this._forms || []).forEach((f) => (f.el.hass = h)); }
  _emit() {
    const cfg = { ...this._config };
    cfg.accesses = cfg.accesses.map((a) => {
      const o = { ...a };
      ["icon", "camera_entity", "unlock_entity", "state_entity"].forEach((k) => { if (o[k] === "" || o[k] == null) delete o[k]; });
      o.buttons = (a.buttons || []).filter((b) => b && b.entity).map((b) => { const x = { entity: b.entity }; if (b.name) x.name = b.name; if (b.icon) x.icon = b.icon; return x; });
      return o;
    });
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
  }
  _form(schema, get, set, parent, labels) {
    const el = document.createElement("ha-form");
    el.hass = this._hass; el.data = get(this._config); el.schema = schema;
    el.computeLabel = (s) => (labels && labels[s.name]) || LABELS[s.name] || s.name;
    el.addEventListener("value-changed", (ev) => { ev.stopPropagation(); set(this._config, ev.detail.value); this._emit(); });
    this._forms.push({ el, get }); parent.appendChild(el);
  }
  _build() {
    this._built = true; this._forms = []; this.innerHTML = "";
    const st = document.createElement("style");
    st.textContent = `.bx{border:1px solid var(--divider-color);border-radius:12px;padding:10px;margin:10px 0}.sub{margin:8px 0 0 10px;padding-left:10px;border-left:2px solid var(--divider-color)}.h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600}
      button{cursor:pointer;border:1px solid var(--divider-color);background:var(--secondary-background-color);color:var(--primary-text-color);border-radius:8px;padding:6px 10px}.add{width:100%;margin:4px 0}`;
    this.appendChild(st);
    this._form(TOP, (c) => c, (c, v) => { const keep = c.accesses; Object.assign(c, v); c.accesses = keep; }, this);
    const t = document.createElement("h3"); t.textContent = "Accès"; this.appendChild(t);
    this._config.accesses.forEach((a, i) => {
      const box = document.createElement("div"); box.className = "bx";
      box.innerHTML = `<div class="h"><span>Accès ${i + 1}</span><span><button data-a="up" data-i="${i}">↑</button> <button data-a="down" data-i="${i}">↓</button> <button data-a="del" data-i="${i}">✕</button></span></div>`;
      this._form(ACC, (c) => c.accesses[i], (c, v) => { const keep = c.accesses[i].buttons; c.accesses[i] = { ...v, buttons: keep }; }, box);
      const sub = document.createElement("div"); sub.className = "sub"; sub.innerHTML = `<div class="h"><span>Boutons d'ouverture</span></div>`;
      a.buttons.forEach((b, j) => {
        const bb = document.createElement("div"); bb.className = "bx";
        bb.innerHTML = `<div class="h"><span>Bouton ${j + 1}</span><span><button data-a="bup" data-i="${i}" data-j="${j}">↑</button> <button data-a="bdown" data-i="${i}" data-j="${j}">↓</button> <button data-a="bdel" data-i="${i}" data-j="${j}">✕</button></span></div>`;
        this._form(BTN, (c) => c.accesses[i].buttons[j], (c, v) => { c.accesses[i].buttons[j] = { ...v }; }, bb);
        sub.appendChild(bb);
      });
      const addb = document.createElement("button"); addb.className = "add"; addb.textContent = "+ Ajouter un bouton"; addb.dataset.a = "badd"; addb.dataset.i = i; sub.appendChild(addb);
      box.appendChild(sub); this.appendChild(box);
    });
    const add = document.createElement("button"); add.className = "add"; add.textContent = "+ Ajouter un accès"; add.dataset.a = "add"; this.appendChild(add);
    this.querySelectorAll("button[data-a]").forEach((b) => b.addEventListener("click", () => this._click(b)));
  }
  _click(b) {
    const d = b.dataset, A = this._config.accesses, i = Number(d.i), j = Number(d.j);
    const move = (arr, k, dir) => { const m = k + dir; if (m >= 0 && m < arr.length) [arr[k], arr[m]] = [arr[m], arr[k]]; };
    if (d.a === "add") A.push(normAcc({ name: "Nouvel accès", icon: "mdi:gate" }));
    else if (d.a === "del") A.splice(i, 1);
    else if (d.a === "up" || d.a === "down") move(A, i, d.a === "up" ? -1 : 1);
    else if (d.a === "badd") A[i].buttons.push({ entity: "" });
    else if (d.a === "bdel") A[i].buttons.splice(j, 1);
    else move(A[i].buttons, j, d.a === "bup" ? -1 : 1);
    this._emit(); this._build();
  }
}

customElements.define("access-card", AccessCard);
customElements.define("access-card-editor", AccessCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: "access-card", name: "Access Card (FR)", description: "Accès (portail, garage) : caméra, déblocage avec re-verrouillage automatique, boutons d'ouverture avec confirmation.", preview: true });
console.info(`%c ACCESS-CARD %c v${CARD_VERSION} `, "color:#fff;background:#2f8fd8;font-weight:700;border-radius:3px 0 0 3px;padding:2px 4px", "color:#2f8fd8;background:#fff;font-weight:700;border-radius:0 3px 3px 0;padding:2px 4px");
