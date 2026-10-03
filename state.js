/* ==========================================================================
 *  Mind Map — state: config, shared state, DOM refs, utilities, viewport
 *  Classic script: top-level declarations are shared with the other chunks
 *  (nodes.js, editor.js, main.js), which load after this one.
 *
 *  Sections
 *  1. Config & state          3. Utilities
 *  2. DOM references          4. Viewport (pan / zoom)
 * ========================================================================== */
"use strict";

/* ==========================================================================
 * 1. Config & state
 * ========================================================================== */
const PALETTE = [
  { name: "Indigo", value: "#4a5bdc" },
{ name: "Teal",   value: "#0e9f8e" },
{ name: "Amber",  value: "#d9910a" },
{ name: "Rose",   value: "#d94677" },
{ name: "Violet", value: "#8f5bd9" },
{ name: "Sky",    value: "#1d90d6" },
{ name: "Green",  value: "#5aa02c" },
{ name: "Coral",  value: "#e2653f" },
];
const DEFAULT_COLOR = PALETTE[0].value;
const DEFAULT_FS = 15;
const FONTS = {
  sans:  { label: "Sans",  css: "" },
  serif: { label: "Serif", css: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
  round: { label: "Round", css: 'ui-rounded, "SF Pro Rounded", "Varela Round", Nunito, system-ui, sans-serif' },
  mono:  { label: "Mono",  css: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace' },
  hand:  { label: "Hand",  css: '"Bradley Hand", "Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive' },
};

const Z_MIN = 0.1;
const Z_MAX = 3;
const GRID = 28;
const NODE_W = 180;
const NODE_H = 60;
const CHILD_GAP = 60;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 320;
const FILE_VERSION = 2;
const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "FONT", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "I", "IMG", "LI", "OL", "P", "PRE", "S", "SPAN", "STRIKE", "STRONG", "TABLE", "TBODY", "TD",
  "TH", "THEAD", "TR", "U", "UL",
]);

/** @type {{title:string, rootId:string, nodes:Object<string, any>}|null} */
let doc = null;
let selectedId = null;
let editing = null;          // { nodeId, el } while editing a node body
let lastRange = null;        // last caret/selection inside the edited body
let cellSel = null;          // { table, a, b } rectangular table-cell selection
let cellAnchor = null;       // { table, cell } where a cell selection started
let cellDrag = null;         // active drag across table cells
let dirty = false;
const view = { x: 0, y: 0, z: 1 };

// Interaction state
const pointers = new Map();  // active canvas pointers (pan / pinch)
let gesture = null;          // current pan or pinch
let press = null;            // current node press / drag
let lastTap = null;          // for touch double-tap
let ctxOpenedAt = 0;
let edgeFrame = 0;

/* ==========================================================================
 * 2. DOM references
 * ========================================================================== */
const $ = (selector) => document.querySelector(selector);

const viewport   = $("#viewport");
const world      = $("#world");
const edgesSvg   = $("#edges");
const nodesLayer = $("#nodes-layer");
const fmtBar     = $("#fmt-bar");
const ctxMenu    = $("#ctx-menu");
const modal      = $("#modal");
const helpDialog = $("#help");
const colorPanel = $("#color-picker");
const colorBtn   = $("#btn-color");
const tableGrid  = $("#table-grid");

/* ==========================================================================
 * 3. Utilities
 * ========================================================================== */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "n" + Math.random().toString(36).slice(2) + Date.now());
const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const isHexColor = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function setDirty(value) {
  dirty = value;
  $("#save-state").dataset.dirty = String(value);
  $("#save-label").textContent = value ? "Unsaved changes" : "Saved";
}
const markDirty = () => setDirty(true);
const markClean = () => setDirty(false);

function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#000000";
  return "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("");
}

/** Keep only a small set of safe inline style declarations. */
function cleanStyle(value) {
  const allowed = new Set(["color", "background-color", "font-weight", "font-style", "text-decoration", "text-decoration-line", "text-align"]);
  return String(value)
  .split(";")
  .map((d) => d.trim())
  .filter((d) => {
    const [prop, ...rest] = d.split(":");
    const val = rest.join(":");
    return allowed.has(prop.trim().toLowerCase()) && !/url\(|expression|javascript:/i.test(val);
  })
    .join("; ");
}

/**
 * Sanitize rich-text HTML using an inert document (nothing loads or runs),
 * with a tag and attribute allowlist.
 */
function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html), "text/html");
  [...parsed.body.querySelectorAll("*")].forEach((el) => {
    if (!el.isConnected) return;
    if (!ALLOWED_TAGS.has(el.tagName)) {
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|NOSCRIPT|TEMPLATE|SVG|MATH|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(el.tagName)) el.remove();
      else el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      let keep = false;
      if (name === "style") {
        const cleaned = cleanStyle(value);
        if (cleaned) { el.setAttribute("style", cleaned); keep = true; }
      } else if (el.tagName === "A" && name === "href") keep = /^(https?:|mailto:)/i.test(value.trim());
      else if (el.tagName === "IMG" && name === "src") keep = /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value.trim());
      else if (el.tagName === "IMG" && name === "alt") keep = true;
      else if (el.tagName === "FONT" && name === "color") keep = /^#?[\w(),.\s%]+$/.test(value);
      else if ((el.tagName === "TD" || el.tagName === "TH") && (name === "colspan" || name === "rowspan")) keep = /^\d{1,2}$/.test(value);
      if (!keep) el.removeAttribute(attr.name);
    });
      if (el.tagName === "IMG" && !el.getAttribute("src")) { el.remove(); return; }
      if (el.tagName === "A") { el.setAttribute("rel", "noopener noreferrer"); el.setAttribute("target", "_blank"); }
  });
  // Source-code whitespace between block elements would show as blank lines (bodies preserve whitespace).
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const blanks = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (/^\s*$/.test(t.data) && /[\r\n]/.test(t.data)) blanks.push(t);
  }
  blanks.forEach((t) => {
    if (/^(BODY|DIV|TABLE|TBODY|THEAD|TR|UL|OL|BLOCKQUOTE)$/.test(t.parentNode.nodeName)) t.remove();
    else t.data = " ";
  });
    return parsed.body.innerHTML;
}

function descendants(id) {
  const out = [];
  const walk = (nid) => (doc.nodes[nid]?.children || []).forEach((c) => { out.push(c); walk(c); });
  walk(id);
  return out;
}

/** Is `a` an ancestor of (or the same as) `b`? */
function isAncestor(a, b) {
  let cur = b;
  while (cur) {
    if (cur === a) return true;
    cur = doc.nodes[cur]?.parentId;
  }
  return false;
}

const isInteractive = (el) => !!el?.closest?.("input, textarea, [contenteditable='true'], dialog");

/* ==========================================================================
 * 4. Viewport (pan / zoom)
 * ========================================================================== */
function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  let grid = GRID * view.z;
  while (grid < 14) grid *= 2; // keep the dot grid readable when zoomed far out
  viewport.style.backgroundSize = `${grid}px ${grid}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $("#zoom-label").textContent = Math.round(view.z * 100) + "%";
}

function zoomAt(mx, my, factor) {
  const z2 = clamp(view.z * factor, Z_MIN, Z_MAX);
  view.x = mx - (mx - view.x) * (z2 / view.z);
  view.y = my - (my - view.y) * (z2 / view.z);
  view.z = z2;
  applyView();
}

const zoomCenter = (factor) => zoomAt(innerWidth / 2, innerHeight / 2, factor);

function screenToWorld(cx, cy) {
  return { x: (cx - view.x) / view.z, y: (cy - view.y) / view.z };
}

function centerOn(id) {
  const n = doc?.nodes[id];
  if (!n) return;
  const w = (n.el?.offsetWidth || n.w || NODE_W) * (n.sc || 1);
  const h = (n.el?.offsetHeight || n.h || NODE_H) * (n.sc || 1);
  view.x = innerWidth / 2 - (n.x + w / 2) * view.z;
  view.y = innerHeight / 2 - (n.y + h / 2) * view.z;
  applyView();
}

viewport.addEventListener("wheel", (e) => {
  const sb = e.target.closest?.(".node.sized .node-body"); // let resized nodes scroll their own content
  if (sb && !e.ctrlKey && sb.scrollHeight > sb.clientHeight) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : 1;
  const sensitivity = e.ctrlKey ? 0.01 : 0.0012;
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * sensitivity));
}, { passive: false });

/* ---------- Canvas pointers: pan with one, pinch-zoom with two ---------- */
function beginGesture() {
  const pts = [...pointers.values()];
  if (pts.length >= 2) {
    const [a, b] = pts;
    gesture = {
      type: "pinch",
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
          vx: view.x, vy: view.y, vz: view.z,
    };
  } else if (pts.length === 1) {
    gesture = { type: "pan", sx: pts[0].x, sy: pts[0].y, vx: view.x, vy: view.y };
  } else {
    gesture = null;
  }
}

function updateGesture() {
  if (!gesture) return;
  const pts = [...pointers.values()];
  if (gesture.type === "pinch" && pts.length >= 2) {
    const [a, b] = pts;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z2 = clamp(gesture.vz * (d / gesture.d), Z_MIN, Z_MAX);
    const wx = (gesture.mx - gesture.vx) / gesture.vz;
    const wy = (gesture.my - gesture.vy) / gesture.vz;
    view.z = z2;
    view.x = mx - wx * z2;
    view.y = my - wy * z2;
    applyView();
  } else if (gesture.type === "pan" && pts.length === 1) {
    view.x = gesture.vx + (pts[0].x - gesture.sx);
    view.y = gesture.vy + (pts[0].y - gesture.sy);
    applyView();
  }
}

viewport.addEventListener("pointerdown", (e) => {
  if (press) return; // a node is being pressed or dragged
  if (e.target.closest(".node") && pointers.size === 0) return; // handled by the node
  if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
  if (e.button === 1) e.preventDefault();
  if (pointers.size === 0) {
    // First touch on empty canvas: dismiss transient UI and deselect.
    hideCtxMenu();
    hideColorPanel();
    stopEditing();
    select(null);
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { viewport.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  beginGesture();
  viewport.classList.add("panning");
});

window.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updateGesture();
  }
  if (press && e.pointerId === press.pointerId) movePress(e);
});

function onPointerEnd(e) {
  if (pointers.delete(e.pointerId)) {
    if (pointers.size === 0) {
      gesture = null;
      viewport.classList.remove("panning");
    } else {
      beginGesture(); // e.g. lifted one finger of a pinch: continue as a pan
    }
  }
  if (press && e.pointerId === press.pointerId) endPress(e.type === "pointercancel");
}
window.addEventListener("pointerup", onPointerEnd);
window.addEventListener("pointercancel", onPointerEnd);

viewport.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(".node")) e.preventDefault();
});
