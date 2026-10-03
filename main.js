/* ==========================================================================
 *  Mind Map — main: colors, context menu, dialogs, export / import, boot
 *
 *  8. Colors             11. Export / import
 *  9. Context menu       12. Wiring & boot
 * 10. Dialogs
 * ========================================================================== */
"use strict";

/* ==========================================================================
 * 8. Colors
 * ========================================================================== */
(function buildSwatches() {
  PALETTE.forEach(({ name, value }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.color = value;
    b.style.setProperty("--sw", value);
    b.title = name;
    b.setAttribute("aria-label", name);
    b.setAttribute("aria-pressed", "false");
    $("#swatches").appendChild(b);
  });
})();

colorPanel.addEventListener("click", (e) => {
  const sw = e.target.closest(".swatch");
  const n = doc.nodes[selectedId];
  if (!sw || !n) return;
  n.color = sw.dataset.color;
  descendants(n.id).forEach((d) => { doc.nodes[d].color = n.color; }); // keep the branch cohesive
  renderAll();
  markDirty();
});

function renderColorState() {
  const n = doc.nodes[selectedId];
  colorBtn.style.setProperty("--cur", n ? n.color : DEFAULT_COLOR);
  renderStyleState(n);
  colorPanel.querySelectorAll(".swatch").forEach((sw) =>
  sw.setAttribute("aria-pressed", String(!!n && n.color.toLowerCase() === sw.dataset.color)));
}

function hideColorPanel() {
  colorPanel.hidden = true;
  colorBtn.setAttribute("aria-expanded", "false");
}
colorBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  hideCtxMenu();
  colorPanel.hidden = !colorPanel.hidden;
  colorBtn.setAttribute("aria-expanded", String(!colorPanel.hidden));
  if (!colorPanel.hidden) requestAnimationFrame(revealAboveDock);
});

/* ---------- Node style: size, font, bold / italic / underline ---------- */
(function buildStylePanel() {
  const row = $("#ff-row");
  Object.entries(FONTS).forEach(([key, f]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sp-chip";
    b.dataset.ff = key;
    b.textContent = f.label;
    b.style.fontFamily = f.css;
    row.appendChild(b);
  });
})();

function renderStyleState(n) {
  const fs = n ? n.fs || DEFAULT_FS : DEFAULT_FS;
  $("#fs-range").value = fs;
  $("#fs-val").textContent = fs + "px";
  $("#sc-val").textContent = $("#side-sc-val").textContent = Math.round((n?.sc || 1) * 100) + "%";
  colorPanel.querySelectorAll("[data-fs]").forEach((c) => c.setAttribute("aria-pressed", String(+c.dataset.fs === fs)));
  colorPanel.querySelectorAll("[data-ff]").forEach((c) => c.setAttribute("aria-pressed", String(!!n && (n.ff || "sans") === c.dataset.ff)));
  colorPanel.querySelectorAll("[data-tg]").forEach((c) => c.setAttribute("aria-pressed", String(!!n && !!n[c.dataset.tg])));
}

function setStyle(patch, branch = false) {
  const n = doc.nodes[selectedId];
  if (!n) return;
  [n.id, ...(branch ? descendants(n.id) : [])].forEach((id) => Object.assign(doc.nodes[id], patch));
  renderAll();
  scheduleEdges();
  markDirty();
}

colorPanel.addEventListener("click", (e) => {
  const n = doc.nodes[selectedId];
  const t = e.target.closest("[data-fs], [data-ff], [data-tg], [data-sc], #sp-branch, #sp-reset");
  if (!t || !n) return;
  if (t.dataset.sc) scaleBy(t.dataset.sc === "reset" ? 0 : +t.dataset.sc);
  else if (t.dataset.fs) setStyle({ fs: +t.dataset.fs });
  else if (t.dataset.ff) setStyle({ ff: t.dataset.ff });
  else if (t.dataset.tg) setStyle({ [t.dataset.tg]: !n[t.dataset.tg] });
  else if (t.id === "sp-branch") setStyle({ fs: n.fs, ff: n.ff, b: n.b, i: n.i, u: n.u }, true);
  else if (t.id === "sp-reset") setStyle({ fs: DEFAULT_FS, ff: "sans", b: false, i: false, u: false, sc: 1 });
  requestAnimationFrame(revealAboveDock);
});
$("#side .side-scale").addEventListener("click", (e) => {
  const t = e.target.closest("[data-sc]");
  if (t) scaleBy(t.dataset.sc === "reset" ? 0 : +t.dataset.sc);
});
$("#fs-range").addEventListener("input", (e) => setStyle({ fs: +e.target.value }));

/** Scale a whole node (text, padding, images, tables). delta 0 resets to 100%. */
function scaleBy(delta) {
  const n = doc.nodes[selectedId];
  if (!n) return;
  setStyle({ sc: delta ? +clamp((n.sc || 1) + delta, 0.5, 3).toFixed(2) : 1 });
}

/** Keep the selected node visible above the open style panel (important on phones). */
function revealAboveDock() {
  const n = doc.nodes[selectedId];
  if (!n?.el || colorPanel.hidden) return;
  const r = n.el.getBoundingClientRect();
  const dy = r.bottom - (colorPanel.getBoundingClientRect().top - 12);
  if (dy > 0) { view.y -= Math.min(dy, Math.max(0, r.top - 70)); applyView(); }
}

/* ==========================================================================
 * 9. Context menu
 * ========================================================================== */
function showCtxMenu(x, y) {
  const n = doc.nodes[selectedId];
  if (!n) return;
  hideColorPanel();
  const items = [
    { label: "Add child", icon: "child", fn: () => addChild(n.id) },
    ...(n.parentId ? [{ label: "Add sibling", icon: "sibling", fn: () => addSibling(n.id) }] : []),
    { sep: true },
    { label: "Rename", icon: "pencil", fn: () => startRename(n.id) },
    ...(n.parentId ? [{ label: "Edit", icon: "note", fn: () => startEditBody(n.id) }] : []),
    ...(n.children.length ? [{ label: n.collapsed ? "Expand branch" : "Collapse branch", icon: n.collapsed ? "unfold" : "fold", fn: () => toggleCollapse(n.id) }] : []),
    { sep: true },
    { label: "Delete", icon: "trash", fn: () => deleteNode(n.id), danger: true },
  ];
  ctxMenu.replaceChildren();
  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "ctx-sep";
      s.setAttribute("role", "separator");
      ctxMenu.appendChild(s);
      return;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ctx-item" + (it.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.innerHTML = `${icon(it.icon)}<span></span>`;
    b.querySelector("span").textContent = it.label;
    b.addEventListener("click", () => { hideCtxMenu(); it.fn(); });
    ctxMenu.appendChild(b);
  });
  ctxMenu.hidden = false;
  ctxOpenedAt = performance.now();
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  ctxMenu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}

function hideCtxMenu() { ctxMenu.hidden = true; }

/* ==========================================================================
 * 10. Dialogs
 * ========================================================================== */
function openModal({ title, text, input, okText = "OK", danger = false, hideCancel = false, onOk }) {
  const okBtn = $("#modal-ok");
  const cancelBtn = $("#modal-cancel");
  const inp = $("#modal-input");

  $("#modal-title").textContent = title;
  $("#modal-text").textContent = text || "";
  $("#modal-text").hidden = !text;
  inp.hidden = !input;
  if (input) inp.value = input.value || "";
  okBtn.textContent = okText;
  okBtn.className = "btn " + (danger ? "danger" : "primary");
  cancelBtn.hidden = hideCancel;

  let settled = false;
  const unbind = () => {
    okBtn.removeEventListener("click", onOkClick);
    cancelBtn.removeEventListener("click", onCancel);
    inp.removeEventListener("keydown", onKey);
    modal.removeEventListener("close", onCancel);
  };
  const settle = (confirmed, value) => {
    if (settled) return;
    settled = true;
    unbind();
    if (modal.open) modal.close();
    if (confirmed) onOk?.(value);
  };
    function onOkClick() {
      const val = input ? inp.value.trim() : null;
      if (input && !val) { inp.focus(); return; }
      settle(true, val);
    }
    function onCancel() { settle(false); }
    function onKey(e) { if (e.key === "Enter") { e.preventDefault(); onOkClick(); } }

    okBtn.addEventListener("click", onOkClick);
    cancelBtn.addEventListener("click", onCancel);
    inp.addEventListener("keydown", onKey);
    modal.addEventListener("close", onCancel);
    modal.showModal();
    if (input) requestAnimationFrame(() => { inp.focus(); inp.select(); });
    else okBtn.focus();
}

const confirmDialog = ({ title, text, okText = "Delete", onOk }) =>
openModal({ title, text, okText, danger: true, onOk });

const alertDialog = (title, text) =>
openModal({ title, text, okText: "OK", hideCancel: true });

helpDialog.addEventListener("click", (e) => {
  // Click on the backdrop (the dialog element itself, outside its box) closes help.
  const r = helpDialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (e.target === helpDialog && !inside) helpDialog.close();
});

/* ==========================================================================
 * 11. Export / import
 * ========================================================================== */
function exportDoc() {
  if (editing) { clearTimeout(syncTimer); syncEdit(); } // flush a pending edit first
  const payload = {
    app: "mind-map",
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    title: doc.title,
    rootId: doc.rootId,
    ui: { view: { x: Math.round(view.x), y: Math.round(view.y), z: +view.z.toFixed(3) }, selectedId, canvasBg: doc.bg || null, side: { w: sideSize.w, h: sideSize.h } },
    nodes: Object.fromEntries(
      Object.entries(doc.nodes).map(([id, n]) => {
        const { el, ...rest } = n;
        return [id, rest];
      })
    ),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const base = doc.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "mindmap";
  a.href = URL.createObjectURL(blob);
  a.download = `${base}.mindmap.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markClean();
}

function validateDoc(data) {
  if (!data || typeof data !== "object") return "This isn’t a mind map file.";
  if (!data.nodes || typeof data.nodes !== "object") return "The file has no nodes.";
  if (typeof data.rootId !== "string" || !data.nodes[data.rootId]) return "The root node is missing.";
  const seen = new Set();
  const stack = [data.rootId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) return "The node tree contains a cycle or a duplicate link.";
    seen.add(id);
    const n = data.nodes[id];
    if (!n || typeof n !== "object") return `Node “${id}” is malformed.`;
    if (!Array.isArray(n.children)) return `Node “${id}” has no children list.`;
    if (n.children.some((c) => !data.nodes[c])) return `Node “${id}” links to a missing child.`;
    n.children.forEach((c) => stack.push(c));
  }
  if (seen.size !== Object.keys(data.nodes).length) return "The file contains nodes that aren’t connected to the root.";
  return null;
}

function loadDoc(data) {
  Object.values(doc?.nodes || {}).forEach(disposeNodeEl);
  const nodes = {};
  const finite = (v) => (Number.isFinite(+v) ? +v : 0);
  Object.entries(data.nodes).forEach(([id, n]) => {
    nodes[id] = {
      id,
      parentId: null, // rebuilt below from the child lists
      title: String(n.title ?? ""),
                                     html: sanitizeHtml(String(n.html ?? "")),
                                     collapsed: !!n.collapsed,
                                     children: n.children.map(String),
                                     color: isHexColor(n.color) ? n.color : DEFAULT_COLOR,
                                     x: finite(n.x), y: finite(n.y),
                                     fs: clamp(finite(n.fs) || DEFAULT_FS, 10, 56),
                                     ff: FONTS[n.ff] ? n.ff : "sans",
                                     b: !!n.b, i: !!n.i, u: !!n.u,
                                     sc: clamp(finite(n.sc) || 1, 0.5, 3),
                                     rw: +n.rw > 0 ? clamp(+n.rw, 100, 1200) : null,
                                     rh: +n.rh > 0 ? clamp(+n.rh, 44, 1600) : null,
                                     w: finite(n.w) || NODE_W, h: finite(n.h) || NODE_H,
    };
  });
  Object.values(nodes).forEach((n) => n.children.forEach((c) => { nodes[c].parentId = n.id; }));
  doc = { title: String(data.title || "Imported map"), rootId: data.rootId, nodes, bg: isHexColor(data.ui?.canvasBg) ? data.ui.canvasBg : null };
  stopEditingSilently();
  const ui = data.ui || {}, v = ui.view || {};
  selectedId = nodes[ui.selectedId] ? ui.selectedId : doc.rootId;
  const sd = ui.side || {};
  sideSize.w = clamp(+sd.w || 380, 300, 1600);
  sideSize.h = +sd.h > 0 ? clamp(+sd.h, 180, 2000) : 0;
  applySideSize();
  applyBg();
  renderAll();
  if ([v.x, v.y, v.z].every((k) => k != null && Number.isFinite(+k))) { // restore saved pan / zoom
    view.x = +v.x; view.y = +v.y; view.z = clamp(+v.z, Z_MIN, Z_MAX);
    applyView();
  } else { view.z = 1; centerOn(doc.rootId); }
}

function stopEditingSilently() {
  cellSel = null;
  cellAnchor = null;
  cellDrag = null;
  editing = null;
  $("#side").hidden = true;
  document.body.classList.remove("is-editing");
}

$("#file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { alertDialog("Import failed", "The file isn’t valid JSON."); return; }
    const err = validateDoc(data);
    if (err) { alertDialog("Import failed", err); return; }
    const load = () => { loadDoc(data); markClean(); };
    if (dirty) {
      confirmDialog({ title: "Replace current map", text: "You have unsaved changes. Import this file and discard them?", okText: "Discard and import", onOk: load });
    } else load();
  };
    reader.onerror = () => alertDialog("Import failed", "The file couldn’t be read.");
    reader.readAsText(file);
});

/* ==========================================================================
 * 12. Wiring & boot
 * ========================================================================== */
function initDoc(rootName, { prompt = true, dirty: startDirty = false } = {}) {
  Object.values(doc?.nodes || {}).forEach(disposeNodeEl);
  const rootId = uid();
  doc = { title: rootName, rootId, nodes: {} };
  doc.nodes[rootId] = {
    id: rootId, parentId: null, title: rootName, html: "",
    collapsed: false, children: [], color: DEFAULT_COLOR,
    x: -NODE_W / 2, y: -NODE_H / 2, w: NODE_W, h: NODE_H,
    fs: DEFAULT_FS, ff: "sans", b: false, i: false, u: false,
  };
  selectedId = rootId;
  applyBg();
  view.z = 1;
  renderAll();
  centerOn(rootId);
  setDirty(startDirty);

  if (prompt) {
    setTimeout(() => {
      openModal({
        title: "New mind map",
        text: "Name your root idea to get started.",
        input: { value: rootName },
        okText: "Create",
        onOk: (name) => {
          doc.title = name;
          doc.nodes[doc.rootId].title = name;
          renderAll();
          if (name !== rootName) markDirty();
        },
      });
    }, 200);
  }
}

/* ---------- Canvas background ---------- */
const BG_PRESETS = [
  { name: "Default", value: "" }, { name: "White", value: "#ffffff" }, { name: "Paper", value: "#f6f1e7" },
{ name: "Sky", value: "#eaf2ff" }, { name: "Mint", value: "#e8f5ec" }, { name: "Blush", value: "#fdeef0" },
{ name: "Slate", value: "#1b1f2a" }, { name: "Black", value: "#000000" },
];
(function buildBgPanel() {
  BG_PRESETS.forEach(({ name, value }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.bg = value;
    b.title = name;
    b.setAttribute("aria-label", "Canvas " + name);
    b.setAttribute("aria-pressed", "false");
    b.style.setProperty("--sw", value || "#8d9cff");
    b.style.background = value || "linear-gradient(135deg, #eceeeb 50%, #0e1116 50%)";
    b.style.boxShadow = "inset 0 0 0 1px var(--line-strong)";
    $("#bg-swatches").appendChild(b);
  });
})();

function applyBg() {
  const bg = doc?.bg;
  if (isHexColor(bg)) {
    const [r, g, b] = bg.slice(1).match(/../g).map((h) => parseInt(h, 16));
    const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
    viewport.style.setProperty("--canvas", bg);
    viewport.style.setProperty("--dot", dark ? "rgba(255,255,255,0.1)" : "rgba(23,26,33,0.13)");
  } else {
    viewport.style.removeProperty("--canvas");
    viewport.style.removeProperty("--dot");
  }
  $("#bg-custom").value = isHexColor(bg) ? bg : "#eceeeb";
  $("#bg-swatches").querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String((s.dataset.bg || "") === (isHexColor(bg) ? bg.toLowerCase() : ""))));
}
function setBg(value) { doc.bg = value || null; applyBg(); markDirty(); }
$("#bg-swatches").addEventListener("click", (e) => { const s = e.target.closest(".swatch"); if (s) setBg(s.dataset.bg); });
$("#bg-custom").addEventListener("input", (e) => setBg(e.target.value));
$("#btn-bg").addEventListener("click", (e) => {
  e.stopPropagation();
  hideCtxMenu();
  hideColorPanel();
  $("#bg-panel").hidden = !$("#bg-panel").hidden;
});

/* ---------- Buttons ---------- */
$("#btn-add-child").addEventListener("click", () => selectedId && addChild(selectedId));
$("#btn-add-sibling").addEventListener("click", () => selectedId && addSibling(selectedId));
$("#btn-delete").addEventListener("click", () => selectedId && deleteNode(selectedId));
$("#btn-collapse").addEventListener("click", () => selectedId && toggleCollapse(selectedId));
$("#btn-rename").addEventListener("click", () => selectedId && startRename(selectedId));
$("#btn-edit").addEventListener("click", () => selectedId && startEditBody(selectedId));
$("#btn-export").addEventListener("click", exportDoc);
$("#btn-import").addEventListener("click", () => $("#file-input").click());
$("#btn-help").addEventListener("click", () => helpDialog.showModal());
$("#help-close").addEventListener("click", () => helpDialog.close());
$("#btn-zoom-in").addEventListener("click", () => zoomCenter(1.25));
$("#btn-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.25));
$("#btn-zoom-reset").addEventListener("click", () => { view.z = 1; applyView(); });
$("#btn-fit").addEventListener("click", () => { view.z = 1; centerOn(doc.rootId); });

/* ---------- Dismiss popovers ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest(".ctx-menu") && performance.now() - ctxOpenedAt > 450) hideCtxMenu();
  if (!e.target.closest("#color-picker, #btn-color")) hideColorPanel();
  if (!e.target.closest("#bg-panel, #btn-bg")) $("#bg-panel").hidden = true;
  if (!e.target.closest("#fb-table, .table-grid")) tableGrid.hidden = true;
});

/* ---------- Keyboard ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideCtxMenu();
    hideColorPanel();
    tableGrid.hidden = true;
    if (editing) { e.preventDefault(); stopEditing(); }
    return;
  }
  if (editing) { handleEditKey(e); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isInteractive(e.target) || document.querySelector("dialog[open]")) return;
  if (e.key === "?") { helpDialog.showModal(); return; }

  const onButton = !!e.target.closest?.("button");
  switch (e.key) {
    case "Tab":
      if (!selectedId) return;
      e.preventDefault();
    addChild(selectedId);
    break;
    case "Enter":
      if (!selectedId || onButton) return;
      e.preventDefault();
    addSibling(selectedId);
    break;
    case "Delete":
    case "Backspace":
      if (!selectedId) return;
      e.preventDefault();
    deleteNode(selectedId);
    break;
    case "c":
    case "C":
      if (selectedId) toggleCollapse(selectedId);
      break;
    case "F2":
      if (!selectedId) return;
      e.preventDefault();
    startRename(selectedId);
    break;
    case "]":
      scaleBy(0.1);
      break;
    case "[":
      scaleBy(-0.1);
      break;
    case "+":
    case "=":
      zoomCenter(1.2);
      break;
    case "-":
      zoomCenter(1 / 1.2);
      break;
  }
});

/* ---------- Warn before leaving with unsaved changes ---------- */
window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- Boot ---------- */
applyView();
initDoc("My Mind Map");
