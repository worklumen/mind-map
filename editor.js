/* ==========================================================================
 *  Mind Map — editor: rich-text editing, format bar, images, tables
 *
 *  7. Rich-text editing (formatting, images, table model & cell selection)
 * ========================================================================== */
"use strict";

const side = $("#side"), sideTitle = $("#side-title"), sideBody = $("#side-body");
let syncTimer = 0;
let extendArmed = false;       // touch-friendly "Select" mode: the next cell tap extends the cell selection
const sideSize = { w: 380, h: 0 }; // widget width (desktop) / height (phone); h 0 = automatic

function applySideSize() {
  const root = document.documentElement.style;
  root.setProperty("--side-w", sideSize.w + "px");
  if (sideSize.h) root.setProperty("--side-h", sideSize.h + "px"); else root.removeProperty("--side-h");
}

(function sideResize() {
  const grip = $("#side-grip");
  grip.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const desk = innerWidth >= 720, sx = e.clientX, sy = e.clientY, w0 = side.offsetWidth, h0 = side.offsetHeight;
    try { grip.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
    const move = (ev) => {
      if (desk) sideSize.w = clamp(Math.round(w0 + sx - ev.clientX), 300, Math.round(innerWidth * 0.7));
      else sideSize.h = clamp(Math.round(h0 + sy - ev.clientY), 180, Math.round((window.visualViewport?.height || innerHeight) - 64));
      applySideSize();
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      markDirty();
      revealEditing();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => { sideSize.w = 380; sideSize.h = 0; applySideSize(); markDirty(); revealEditing(); });
})();

/** A table can't be the first or last thing in the body, or the caret couldn't leave it. */
function ensureEdges() {
  const el = editing?.el;
  if (!el) return;
  const pad = () => Object.assign(document.createElement("div"), { innerHTML: "<br>" });
  if (el.lastChild?.nodeName === "TABLE") el.appendChild(pad());
  if (el.firstChild?.nodeName === "TABLE") el.prepend(pad());
}

function toggleHeader(table) {
  const row = table.rows[0];
  if (!row) return;
  const toTh = ![...row.cells].every((c) => c.tagName === "TH");
  [...row.cells].forEach((c) => {
    const n = document.createElement(toTh ? "th" : "td");
    [...c.attributes].forEach((a) => n.setAttribute(a.name, a.value));
    n.innerHTML = c.innerHTML;
    c.replaceWith(n);
  });
}

/** Rename: the root uses a small dialog (it names the map); every other node uses the side widget. */
function startRename(id) {
  const n = doc.nodes[id];
  if (!n) return;
  if (id !== doc.rootId) { startEditBody(id, "title"); return; }
  openModal({
    title: "Rename map", input: { value: n.title }, okText: "Rename",
    onOk: (name) => { n.title = name; doc.title = name; renderAll(); markDirty(); },
  });
}

/** Open the side widget for a node. The root node is not editable. */
function startEditBody(id, focus = "auto") {
  const n = doc.nodes[id];
  if (!n || id === doc.rootId) return;
  stopEditing();
  hideCtxMenu();
  hideColorPanel();
  if (selectedId !== id) select(id);
  sideBody.contentEditable = "true";
  sideBody.innerHTML = n.html || "";
  sideTitle.value = n.title;
  editing = { nodeId: id, el: sideBody };
  lastRange = null;
  side.hidden = false;
  document.body.classList.add("is-editing");
  try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch { /* unsupported */ }
  $("#fb-text-color").value = rgbToHex(getComputedStyle(sideBody).color);
  updateTableOps();
  positionSide();
  if (focus === "title" || (focus === "auto" && !n.html)) { sideTitle.focus(); sideTitle.select(); }
  else { sideBody.focus(); placeCaretEnd(sideBody); }
  requestAnimationFrame(revealEditing);
}

/** Copy the widget's fields into the node and refresh the canvas. */
function syncEdit() {
  if (!editing) return;
  const n = doc.nodes[editing.nodeId];
  if (!n) return;
  const t = sideTitle.value.replace(/\s+/g, " ").trim();
  if (t) n.title = t;
  const h = sanitizeHtml(editing.el.innerHTML);
  n.html = !/<(img|table|hr)/i.test(h) && !h.replace(/<[^>]*>|&nbsp;|\s/g, "") ? "" : h;
  if (n.el) n.el._html = null;
  renderAll();
}
const queueSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => { ensureEdges(); syncEdit(); markDirty(); }, 150); };
sideTitle.addEventListener("input", queueSync);
sideTitle.addEventListener("focus", () => updateTableOps());
sideBody.addEventListener("input", queueSync);
sideTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sideBody.focus(); placeCaretEnd(sideBody); }
});

function stopEditing() {
  if (!editing) return;
  clearTimeout(syncTimer);
  clearCellSel();
  syncEdit();
  cellDrag = null;
  cellAnchor = null;
  extendArmed = false;
  editing = null;
  lastRange = null;
  sideBody.contentEditable = "false";
  sideBody.innerHTML = "";
  side.hidden = true;
  tableGrid.hidden = true;
  $("#table-ops").hidden = true;
  document.body.classList.remove("is-editing");
  renderAll();
  markDirty();
}

function placeCaretEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = document.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/** Keep the widget above the on-screen keyboard (phones). */
function positionSide() {
  const vv = window.visualViewport;
  if (!vv || side.hidden) return;
  const kb = innerWidth >= 720 ? 0 : Math.max(0, innerHeight - vv.height - vv.offsetTop);
  side.style.bottom = kb + "px";
  side.style.setProperty("--vvh", vv.height + "px");
}

/** Pan the canvas so the node being edited stays visible beside / above the widget. */
function revealEditing() {
  if (!editing || side.hidden) return;
  const n = doc.nodes[editing.nodeId];
  if (!n?.el) return;
  const r = n.el.getBoundingClientRect(), s = side.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (innerWidth >= 720) {
    const right = s.left - 16;
    if (r.right > right) dx = right - r.right;
    if (r.left + dx < 16) dx = 16 - r.left;
  } else {
    const bottom = s.top - 12;
    if (r.bottom > bottom) dy = bottom - r.bottom;
    if (r.top + dy < 64) dy = 64 - r.top;
  }
  if (dx || dy) { view.x += dx; view.y += dy; applyView(); }
}
const onViewportChange = () => { positionSide(); revealEditing(); };
window.visualViewport?.addEventListener("resize", onViewportChange);
window.visualViewport?.addEventListener("scroll", positionSide);
window.addEventListener("resize", onViewportChange);

/* ---------- Selection helpers (selection is lost when a toolbar control takes focus) ---------- */
document.addEventListener("selectionchange", () => {
  if (!editing) return;
  const s = document.getSelection();
  if (s.rangeCount && editing.el.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange();
  updateTableOps();
});

function restoreSelection() {
  editing.el.focus();
  if (!lastRange) { placeCaretEnd(editing.el); return; }
  const s = document.getSelection();
  s.removeAllRanges();
  s.addRange(lastRange);
}

const TOGGLE_COMMANDS = new Set(["bold", "italic", "underline", "strikeThrough"]);
const CELL_RANGE_COMMANDS = new Set([...TOGGLE_COMMANDS, "foreColor", "removeFormat", "formatBlock", "insertUnorderedList", "insertOrderedList"]);

function selectContents(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = document.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/** Run an editing command. With several table cells selected, styling commands apply to every cell. */
function exec(command, value = null) {
  if (!editing) return;
  const sel = selRect();
  if (sel && CELL_RANGE_COMMANDS.has(command)) {
    editing.el.focus();
    let want = null;
    cellsInRect(sel.map, sel).forEach((cell, i) => {
      selectContents(cell);
      if (TOGGLE_COMMANDS.has(command)) {
        if (i === 0) want = !document.queryCommandState(command);
        if (document.queryCommandState(command) === want) return; // already in the target state
      }
      document.execCommand(command, false, value);
    });
    document.getSelection().removeAllRanges();
    renderCellSel();
    return;
  }
  if (sel) collapseCellSelToCaret(); // other commands need a caret
  restoreSelection();
  document.execCommand(command, false, value);
}

/* ---------- Format bar ---------- */
fmtBar.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".fb-color")) e.preventDefault(); // keep the text selection
});

fmtBar.querySelectorAll("button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.val;
    exec(btn.dataset.cmd, val ? `<${val}>` : null);
  });
});

$("#fb-text-color").addEventListener("input", (e) => {
  $("#fb-color-label").style.setProperty("--tc", e.target.value);
  exec("foreColor", e.target.value);
});
$("#fb-code").addEventListener("click", () => exec("insertHTML", "<code>code</code>&nbsp;"));
$("#fb-clear").addEventListener("click", () => exec("removeFormat"));
$("#fb-done").addEventListener("click", stopEditing);

/* Soft keyboards have no Tab key, so the bar offers the same actions. */
function tabFromButton(back) {
  if (!editing) return;
  if (selRect()) collapseCellSelToCaret();
  else restoreSelection();
  tabAction(back);
}
$("#fb-indent").addEventListener("click", () => tabFromButton(false));
$("#fb-outdent").addEventListener("click", () => tabFromButton(true));

/* ---------- Images ---------- */
function readImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => exec("insertHTML", `<img src="${reader.result}" alt="">`);
  reader.readAsDataURL(file);
}

$("#fb-image").addEventListener("click", () => {
  if (!editing) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => readImageFile(input.files[0]);
  input.click();
});

/** Does clipboard HTML carry real content, or is it just an <img> wrapper around a copied picture? */
function htmlHasText(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  return d.body.textContent.trim().length > 0;
}

document.addEventListener("paste", (e) => {
  if (!editing || !editing.el.contains(e.target)) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const html = cd.getData("text/html");
  const file = [...(cd.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();

  if (file && !(html && htmlHasText(html))) { // screenshots, copied images
    e.preventDefault();
    readImageFile(file);
  } else if (html) {                           // rich text, tables from sheets and web pages
    e.preventDefault();
    exec("insertHTML", sanitizeHtml(html));
  }                                            // plain text: let the browser paste it (keeps line breaks)
});

document.addEventListener("dragover", (e) => { if (editing) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!editing) return;
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    readImageFile(file);
  }
});

/* ---------- Tables ---------- */
(function buildTableGrid() {
  for (let r = 1; r <= 6; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r;
      cell.dataset.c = c;
      tableGrid.appendChild(cell);
    }
  }
})();

function highlightGrid(r, c) {
  tableGrid.querySelectorAll(".cell").forEach((cell) =>
  cell.classList.toggle("on", +cell.dataset.r <= r && +cell.dataset.c <= c));
}
tableGrid.addEventListener("pointerover", (e) => {
  const cell = e.target.closest(".cell");
  if (cell) highlightGrid(+cell.dataset.r, +cell.dataset.c);
});
tableGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (cell) insertTable(+cell.dataset.r, +cell.dataset.c);
});
$("#fb-table").addEventListener("click", (e) => {
  e.stopPropagation();
  tableGrid.hidden = !tableGrid.hidden;
  if (!tableGrid.hidden) highlightGrid(0, 0);
});

function insertTable(rows, cols) {
  if (!editing) return;
  tableGrid.hidden = true;
  restoreSelection();
  if (currentTableCell()) { alertDialog("Table", "Tables can’t be nested. Move the caret outside the table first."); return; }
  const row = `<tr>${"<td>&nbsp;</td>".repeat(cols)}</tr>`;
  exec("insertHTML", `<table><tbody>${row.repeat(rows)}</tbody></table><br>`);
  ensureEdges();
  updateTableOps();
}

function currentTableCell() {
  if (!editing) return null;
  const sel = document.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== editing.el) {
    if (node.nodeName === "TD" || node.nodeName === "TH") return node;
    node = node.parentNode;
  }
  return null;
}

/* ---------- Table model: a grid map that understands merged cells ---------- */
const spanOf = (cell, attr) => Math.max(1, parseInt(cell.getAttribute(attr) || "1", 10) || 1);

function newCell() {
  const td = document.createElement("td");
  td.innerHTML = "&nbsp;";
  return td;
}

function setSpan(cell, rowspan, colspan) {
  if (rowspan > 1) cell.setAttribute("rowspan", rowspan); else cell.removeAttribute("rowspan");
  if (colspan > 1) cell.setAttribute("colspan", colspan); else cell.removeAttribute("colspan");
}

/** map[row][col] -> the cell covering that slot (merged cells appear in every slot they cover). */
function tableMap(table) {
  const rows = [...table.rows];
  const map = [];
  rows.forEach((tr, r) => {
    map[r] = map[r] || [];
    let c = 0;
    [...tr.cells].forEach((cell) => {
      while (map[r][c]) c++;
      const rs = Math.min(spanOf(cell, "rowspan"), rows.length - r);
      const cs = spanOf(cell, "colspan");
      for (let i = 0; i < rs; i++) {
        map[r + i] = map[r + i] || [];
        for (let j = 0; j < cs; j++) map[r + i][c + j] = cell;
      }
      c += cs;
    });
  });
  return map;
}

const tableWidth = (map) => map.reduce((w, row) => Math.max(w, row ? row.length : 0), 0);

function cellPos(map, cell) {
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < (map[r]?.length || 0); c++) {
      if (map[r][c] === cell) {
        return { r, c, rs: Math.min(spanOf(cell, "rowspan"), map.length - r), cs: spanOf(cell, "colspan") };
      }
    }
  }
  return null;
}

/** Smallest rectangle containing both cells that doesn't cut through a merged cell. */
function rectOf(map, a, b) {
  const pa = cellPos(map, a), pb = cellPos(map, b);
  if (!pa || !pb) return null;
  let r1 = Math.min(pa.r, pb.r), c1 = Math.min(pa.c, pb.c);
  let r2 = Math.max(pa.r + pa.rs - 1, pb.r + pb.rs - 1), c2 = Math.max(pa.c + pa.cs - 1, pb.c + pb.cs - 1);
  for (let changed = true; changed;) {
    changed = false;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = map[r]?.[c];
        const p = cell && cellPos(map, cell);
        if (!p) continue;
        if (p.r < r1) { r1 = p.r; changed = true; }
        if (p.c < c1) { c1 = p.c; changed = true; }
        if (p.r + p.rs - 1 > r2) { r2 = p.r + p.rs - 1; changed = true; }
        if (p.c + p.cs - 1 > c2) { c2 = p.c + p.cs - 1; changed = true; }
      }
    }
  }
  return { r1, c1, r2, c2 };
}

function cellsInRect(map, { r1, c1, r2, c2 }) {
  const out = new Set();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (map[r]?.[c]) out.add(map[r][c]);
  return [...out];
}

const isCellEmpty = (cell) => !cell.querySelector("img, table") && cell.textContent.replace(/[\s\u00a0]/g, "") === "";

/* ---------- Cell selection (drag across cells, or Shift+click) ---------- */
function selRect() {
  if (!cellSel || !cellSel.table.isConnected) return null;
  const map = tableMap(cellSel.table);
  const rect = rectOf(map, cellSel.a, cellSel.b);
  return rect ? { ...rect, map, table: cellSel.table } : null;
}

function renderCellSel() {
  if (!editing) return;
  editing.el.querySelectorAll(".cell-selected").forEach((c) => c.classList.remove("cell-selected"));
  const s = selRect();
  if (s) cellsInRect(s.map, s).forEach((c) => c.classList.add("cell-selected"));
  updateTableOps();
}

function setCellSel(table, a, b) {
  cellSel = { table, a, b };
  renderCellSel();
}

function clearCellSel() {
  cellSel = null;
  editing?.el.querySelectorAll(".cell-selected").forEach((c) => c.classList.remove("cell-selected"));
  editing?.el.classList.remove("cell-selecting");
}

function placeCaretIn(el) {
  editing.el.focus();
  placeCaretEnd(el);
  const s = document.getSelection();
  if (s.rangeCount) lastRange = s.getRangeAt(0).cloneRange();
}

/** Turn a cell selection back into a normal caret in its first cell. */
function collapseCellSelToCaret() {
  const s = selRect();
  clearCellSel();
  if (s) placeCaretIn(s.map[s.r1][s.c1]);
}

const clearNativeSelection = () => document.getSelection().removeAllRanges();

document.addEventListener("mousedown", (e) => {
  // Shift+click would otherwise extend the browser's own text selection across cells.
  if (!editing || (!e.shiftKey && !extendArmed) || !cellAnchor) return;
  const cell = e.target.closest?.("td, th");
  if (cell && cell.closest("table") === cellAnchor.table) e.preventDefault();
});

document.addEventListener("pointerdown", (e) => {
  if (!editing || !editing.el.contains(e.target)) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const cell = e.target.closest("td, th");
  const table = cell?.closest("table");
  if (!cell || !editing.el.contains(table)) {
    clearCellSel();
    cellAnchor = null;
    updateTableOps();
    return;
  }
  if ((e.shiftKey || extendArmed) && cellAnchor && cellAnchor.table === table) {
    e.preventDefault();
    setCellSel(table, cellAnchor.cell, cell);
    clearNativeSelection();
    extendArmed = false;
    $('[data-top="select"]').setAttribute("aria-pressed", "false");
    return;
  }
  clearCellSel();
  cellAnchor = { table, cell };
  cellDrag = { pointerId: e.pointerId, table, anchor: cell, active: false };
});

window.addEventListener("pointermove", (e) => {
  if (!cellDrag || e.pointerId !== cellDrag.pointerId || !editing) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest("td, th");
  if (!cell || cell.closest("table") !== cellDrag.table) return;
  if (cell === cellDrag.anchor && !cellDrag.active) return;
  cellDrag.active = true;
  editing.el.classList.add("cell-selecting");
  setCellSel(cellDrag.table, cellDrag.anchor, cell);
  clearNativeSelection();
});

const endCellDrag = (e) => {
  if (!cellDrag || e.pointerId !== cellDrag.pointerId) return;
  cellDrag = null;
  editing?.el.classList.remove("cell-selecting");
};
window.addEventListener("pointerup", endCellDrag);
window.addEventListener("pointercancel", endCellDrag);
document.addEventListener("selectstart", (e) => { if (cellDrag?.active) e.preventDefault(); });

/* ---------- Table operations (all merge-aware) ---------- */
function addRowAfter(table, map, rEnd) {
  const rows = [...table.rows];
  const tr = document.createElement("tr");
  const seen = new Set();
  for (let c = 0; c < tableWidth(map); c++) {
    const above = map[rEnd]?.[c], below = map[rEnd + 1]?.[c];
    if (above && above === below) { // a merged cell spans the new row: stretch it
      if (!seen.has(above)) { seen.add(above); setSpan(above, spanOf(above, "rowspan") + 1, spanOf(above, "colspan")); }
    } else tr.appendChild(newCell());
  }
  rows[rEnd].after(tr);
}

function addColAfter(table, map, cEnd) {
  const seen = new Set();
  [...table.rows].forEach((tr, r) => {
    const here = map[r]?.[cEnd], next = map[r]?.[cEnd + 1];
    if (here && here === next) {
      if (!seen.has(here)) { seen.add(here); setSpan(here, spanOf(here, "rowspan"), spanOf(here, "colspan") + 1); }
      return;
    }
    let ref = null;
    for (let cc = cEnd + 1; cc < (map[r]?.length || 0); cc++) {
      const x = map[r][cc];
      if (x && x.parentElement === tr) { ref = x; break; }
    }
    tr.insertBefore(newCell(), ref);
  });
}

function deleteRow(table, r) {
  const rows = [...table.rows];
  if (rows.length <= 1) return;
  const map = tableMap(table);
  const seen = new Set();
  (map[r] || []).forEach((cell, c) => {
    if (!cell || seen.has(cell)) return;
    seen.add(cell);
    const rs = spanOf(cell, "rowspan");
    if (cell.parentElement !== rows[r]) setSpan(cell, rs - 1, spanOf(cell, "colspan")); // started above: shrink
    else if (rs > 1) {                                                                    // starts here: move down
      setSpan(cell, rs - 1, spanOf(cell, "colspan"));
      let ref = null;
      for (let cc = c + spanOf(cell, "colspan"); cc < (map[r + 1]?.length || 0); cc++) {
        const x = map[r + 1][cc];
        if (x && x.parentElement === rows[r + 1]) { ref = x; break; }
      }
      rows[r + 1].insertBefore(cell, ref);
    }
  });
  rows[r].remove();
}

function deleteCol(table, c) {
  const map = tableMap(table);
  if (tableWidth(map) <= 1) return;
  const seen = new Set();
  map.forEach((row) => {
    const cell = row?.[c];
    if (!cell || seen.has(cell)) return;
    seen.add(cell);
    const cs = spanOf(cell, "colspan");
    if (cs > 1) setSpan(cell, spanOf(cell, "rowspan"), cs - 1);
    else cell.remove();
  });
}

function mergeCells(ctx) {
  const cells = cellsInRect(ctx.map, ctx);
  if (cells.length < 2) return;
  const target = ctx.map[ctx.r1][ctx.c1];
  const parts = [];
  cells.forEach((cell) => { if (cell !== target && !isCellEmpty(cell)) parts.push(cell.innerHTML); });
  if (parts.length) {
    const base = isCellEmpty(target) ? "" : target.innerHTML;
    target.innerHTML = [base, ...parts].filter(Boolean).join("<br>");
  } else if (isCellEmpty(target)) target.innerHTML = "&nbsp;";
  cells.forEach((cell) => { if (cell !== target) cell.remove(); });
  setSpan(target, ctx.r2 - ctx.r1 + 1, ctx.c2 - ctx.c1 + 1);
}

function unmergeCell(table, cell) {
  const map = tableMap(table);
  const pos = cellPos(map, cell);
  if (!pos || (pos.rs === 1 && pos.cs === 1)) return;
  const rows = [...table.rows];
  setSpan(cell, 1, 1);
  for (let r = pos.r; r < pos.r + pos.rs; r++) {
    for (let c = pos.c; c < pos.c + pos.cs; c++) {
      if (r === pos.r && c === pos.c) continue;
      let ref = null;
      for (let cc = c + 1; cc < (map[r]?.length || 0); cc++) {
        const x = map[r][cc];
        if (x && x !== cell && x.parentElement === rows[r]) { ref = x; break; }
      }
      rows[r].insertBefore(newCell(), ref);
    }
  }
}

/** The rectangle table operations act on: the cell selection, or the cell holding the caret. */
function opContext() {
  const s = selRect();
  if (s) return s;
  const cell = currentTableCell();
  const table = cell?.closest("table");
  if (!table) return null;
  const map = tableMap(table);
  const pos = cellPos(map, cell);
  return pos ? { table, map, r1: pos.r, c1: pos.c, r2: pos.r + pos.rs - 1, c2: pos.c + pos.cs - 1 } : null;
}

/** The table cell containing a saved range (the live selection can vanish when a toolbar button is tapped). */
function cellFromRange(r) {
  let n = r?.startContainer;
  while (n && n !== editing?.el) {
    if (n.nodeName === "TD" || n.nodeName === "TH") return n;
    n = n.parentNode;
  }
  return null;
}

function updateTableOps() {
  const ops = $("#table-ops");
  const hasTable = !!editing && !!editing.el.querySelector("table");
  doc?.nodes[editing?.nodeId]?.el?.classList.toggle("wide", hasTable);
  const cell = editing ? currentTableCell() || (document.activeElement !== sideTitle ? cellFromRange(lastRange) : null) : null;
  const has = hasTable && (!!selRect() || !!cell);
  ops.hidden = !has;
  if (!has) return;
  const s = selRect();
  const cells = s ? cellsInRect(s.map, s) : [cell].filter(Boolean);
  $('[data-top="merge"]').disabled = cells.length < 2;
  $('[data-top="unmerge"]').disabled = !cells.some((c) => spanOf(c, "colspan") > 1 || spanOf(c, "rowspan") > 1);
}

$("#table-ops").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-top]");
  if (!btn || btn.disabled || !editing) return;
  if (btn.dataset.top === "select") {
    extendArmed = !extendArmed;
    if (extendArmed && !cellAnchor) {
      const c = currentTableCell();
      if (c) cellAnchor = { table: c.closest("table"), cell: c };
    }
    btn.setAttribute("aria-pressed", String(extendArmed));
    return;
  }
  if (!selRect()) restoreSelection();
  const ctx = opContext();
  if (!ctx) return;
  const { table, map, r1, c1, r2, c2 } = ctx;
  switch (btn.dataset.top) {
    case "addRow": addRowAfter(table, map, r2); break;
    case "addCol": addColAfter(table, map, c2); break;
    case "delRow": for (let r = r2; r >= r1; r--) deleteRow(table, r); break;
    case "delCol": for (let c = c2; c >= c1; c--) deleteCol(table, c); break;
    case "merge": mergeCells(ctx); break;
    case "unmerge": cellsInRect(map, ctx).forEach((cell) => unmergeCell(table, cell)); break;
    case "header": toggleHeader(table); break;
    case "delTable": table.remove(); break;
  }
  clearCellSel();
  cellAnchor = null;
  extendArmed = false;
  $('[data-top="select"]').setAttribute("aria-pressed", "false");
  ensureEdges();
  if (table.isConnected) { // put the caret back in a sensible cell
    const m = tableMap(table);
    const row = m[Math.min(r1, m.length - 1)] || [];
    const cell = row[Math.min(c1, row.length - 1)] || row.find(Boolean);
    if (cell) placeCaretIn(cell);
  } else { editing.el.focus(); placeCaretEnd(editing.el); }
  updateTableOps();
  queueSync();
});

/* ---------- Keys while editing: Tab, cell selection shortcuts ---------- */
function moveToCell(cell, forward) {
  const table = cell.closest("table");
  const listOf = () => {
    const seen = new Set();
    tableMap(table).forEach((row) => row?.forEach((c) => c && seen.add(c)));
    return [...seen];
  };
  let list = listOf();
  let i = list.indexOf(cell) + (forward ? 1 : -1);
  if (i >= list.length) { // Tab from the last cell adds a row, like a word processor
    const map = tableMap(table);
    addRowAfter(table, map, map.length - 1);
    list = listOf();
    i = list.indexOf(cell) + 1;
  }
  if (list[i]) placeCaretIn(list[i]);
}

function insertTab() {
  if (document.execCommand("insertText", false, "\t")) return;
  const sel = document.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const t = document.createTextNode("\t");
  r.insertNode(t);
  r.setStartAfter(t);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function removeTabBefore() {
  const sel = document.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  try {
    sel.modify("extend", "backward", "character");
    if (sel.toString() === "\t") document.execCommand("delete");
    else sel.collapseToEnd();
  } catch { /* Selection.modify unavailable */ }
}

function inListItem() {
  const sel = document.getSelection();
  let n = sel.anchorNode;
  if (n && n.nodeType !== 1) n = n.parentElement;
  const li = n?.closest?.("li");
  return !!li && editing.el.contains(li);
}

/** Tab: next cell in a table, indent in a list, otherwise a tab character. Shift reverses each. */
function tabAction(back) {
  const cell = currentTableCell();
  if (cell) moveToCell(cell, !back);
  else if (inListItem()) exec(back ? "outdent" : "indent");
  else if (back) removeTabBefore();
  else insertTab();
}

function handleEditKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || !editing.el.contains(e.target)) return;
  if (e.key === "Tab") {
    e.preventDefault();
    if (selRect()) collapseCellSelToCaret();
    tabAction(e.shiftKey);
    return;
  }
  const s = selRect();
  if (!s) return;
  if (e.key === "Delete" || e.key === "Backspace") { // clear every selected cell
    e.preventDefault();
    cellsInRect(s.map, s).forEach((c) => { c.innerHTML = "&nbsp;"; });
  } else if (e.key.startsWith("Arrow") || e.key === "Enter" || e.key.length === 1) {
    collapseCellSelToCaret(); // the key then acts at the caret
  }
}
