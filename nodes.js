/* ==========================================================================
 *  Mind Map — nodes: document model (add / delete / collapse / re-parent)
 *  and rendering & input (node cards, edges, selection, drag & drop)
 *
 *  5. Document model     6. Rendering & input
 * ========================================================================== */
"use strict";

/* ==========================================================================
 * 5. Document model
 * ========================================================================== */
function createNode(parentId, x, y, title = "New idea") {
  const id = uid();
  doc.nodes[id] = {
    id, parentId, title, html: "",
    collapsed: false, children: [],
    color: parentId ? doc.nodes[parentId].color : DEFAULT_COLOR,
    x, y, w: NODE_W, h: NODE_H,
    fs: parentId ? doc.nodes[parentId].fs : DEFAULT_FS,
    ff: parentId ? doc.nodes[parentId].ff : "sans",
    b: false, i: false, u: false, rw: null, rh: null, sc: 1,
  };
  if (parentId) doc.nodes[parentId].children.push(id);
  return id;
}

/** Choose a free spot around the parent for a new child. */
function placeChild(parent) {
  const siblings = parent.children.map((c) => doc.nodes[c]).filter(Boolean);
  const right = siblings.filter((s) => s.x >= parent.x).length;
  const left = siblings.length - right;
  const side = right <= left ? 1 : -1;
  const angle = siblings.length * 0.7;
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = angle + attempt * 0.55;
    const dx = Math.cos(a) * (NODE_W + CHILD_GAP) * side;
    const dy = Math.sin(a) * (NODE_H + siblings.length * 30 + CHILD_GAP);
    const x = parent.x + (Math.abs(dx) < 140 ? 160 * side : dx);
    const y = parent.y + dy;
    const clash = Object.values(doc.nodes).some(
      (n) => n.id !== parent.id && Math.abs(n.x - x) < NODE_W && Math.abs(n.y - y) < NODE_H
    );
    if (!clash) return { x, y };
  }
  return { x: parent.x + 180 * side, y: parent.y + siblings.length * 45 };
}

function addNodeUnder(parentId) {
  const parent = doc.nodes[parentId];
  if (!parent) return;
  parent.collapsed = false;
  const pos = placeChild(parent);
  const id = createNode(parentId, pos.x, pos.y);
  selectedId = id;
  renderAll();
  startRename(id);
  markDirty();
}

function addChild(parentId) {
  addNodeUnder(parentId);
}

function addSibling(id) {
  const n = doc.nodes[id];
  if (!n) return;
  addNodeUnder(n.parentId || id);
}

function deleteNode(id) {
  const n = doc.nodes[id];
  if (!n) return;
  const count = descendants(id).length + 1;
  const run = () => {
    if (n.parentId) {
      const p = doc.nodes[n.parentId];
      p.children = p.children.filter((c) => c !== id);
    }
    [id, ...descendants(id)].forEach((d) => {
      disposeNodeEl(doc.nodes[d]);
      delete doc.nodes[d];
    });
    if (id === doc.rootId) {
      initDoc("My Mind Map", { prompt: false, dirty: true });
    } else {
      selectedId = n.parentId;
      renderAll();
      markDirty();
    }
  };
  if (count > 1) {
    const extra = count - 1;
    confirmDialog({
      title: "Delete branch",
      text: `Delete “${n.title}” and its ${extra} descendant${extra > 1 ? "s" : ""}? This can’t be undone unless you’ve exported.`,
      okText: "Delete",
      onOk: run,
    });
  } else run();
}

function toggleCollapse(id) {
  const n = doc.nodes[id];
  if (!n || n.children.length === 0) return;
  n.collapsed = !n.collapsed;
  renderAll();
  markDirty();
}

function reparent(childId, newParentId) {
  if (childId === newParentId || childId === doc.rootId || isAncestor(childId, newParentId)) return;
  const n = doc.nodes[childId];
  if (n.parentId) {
    const old = doc.nodes[n.parentId];
    old.children = old.children.filter((c) => c !== childId);
  }
  n.parentId = newParentId;
  doc.nodes[newParentId].children.push(childId);
  n.color = doc.nodes[newParentId].color;
  descendants(childId).forEach((d) => { doc.nodes[d].color = n.color; });
  renderAll();
  markDirty();
}

/* ==========================================================================
 * 6. Rendering & input
 * ========================================================================== */
const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => scheduleEdges()) : null;

function disposeNodeEl(n) {
  if (!n?.el) return;
  resizeObserver?.unobserve(n.el);
  n.el.remove();
  n.el = null;
}

function visibleNodes() {
  const out = [];
  const walk = (id) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push(n);
    if (!n.collapsed) n.children.forEach(walk);
  };
    walk(doc.rootId);
    return out;
}

function renderAll() {
  renderNodes();
  renderEdges();
  renderColorState();
  updateToolbarState();
  $("#doc-title").textContent = doc.title;
}

function applyNodeStyle(n) {
  const el = n.el;
  el.style.setProperty("--fs", (n.fs || DEFAULT_FS) + "px");
  el.style.fontFamily = (FONTS[n.ff] || FONTS.sans).css;
  el.classList.toggle("st-b", !!n.b);
  el.classList.toggle("st-i", !!n.i);
  el.classList.toggle("st-u", !!n.u);
  el.style.width = n.rw ? n.rw + "px" : "";
  el.style.height = n.rh ? n.rh + "px" : "";
  el.classList.toggle("sized", !!(n.rw || n.rh));
  el.style.transformOrigin = "0 0";
  el.style.transform = n.sc && n.sc !== 1 ? `scale(${n.sc})` : "";
}

let pendingEdit = null;

function positionNode(n) {
  if (!n.el) return;
  n.el.style.left = n.x + "px";
  n.el.style.top = n.y + "px";
}

function renderNodes() {
  const visible = visibleNodes();
  const ids = new Set(visible.map((n) => n.id));

  [...nodesLayer.children].forEach((el) => {
    if (!ids.has(el.dataset.id)) {
      resizeObserver?.unobserve(el);
      el.remove();
    }
  });

  visible.forEach((n) => {
    if (!n.el || !n.el.isConnected) {
      n.el = buildNodeEl(n);
      nodesLayer.appendChild(n.el);
      resizeObserver?.observe(n.el);
    }
    const el = n.el;
    positionNode(n);
    el.style.setProperty("--nc", n.color);
    applyNodeStyle(n);
    el.classList.toggle("selected", n.id === selectedId);

    const titleEl = el.querySelector(".node-title");
    if (!titleEl.isContentEditable && titleEl.textContent !== n.title) titleEl.textContent = n.title;

    const bodyEl = el.querySelector(".node-body");
    if (!bodyEl.isContentEditable && el._html !== n.html) {
      bodyEl.innerHTML = n.html;
      el._html = n.html;
    }

    const hiddenCount = n.collapsed ? descendants(n.id).length : 0;
    const toggle = el.querySelector(".node-toggle");
    toggle.textContent = n.collapsed ? (hiddenCount ? "+" + hiddenCount : "+") : n.children.length ? "−" : "";
    toggle.style.display = n.children.length ? "flex" : "none";
    toggle.classList.toggle("has-hidden", n.collapsed && hiddenCount > 0);
    toggle.setAttribute("aria-label", n.collapsed ? "Expand branch" : "Collapse branch");
    toggle.setAttribute("aria-expanded", String(!n.collapsed));

    el.classList.toggle("wide", !!bodyEl.querySelector("table"));
    updateClip(bodyEl);
  });
}

/** Fade the bottom edge when a body is taller than its cap (full content is visible while editing). */
function updateClip(bodyEl) {
  bodyEl.classList.toggle("is-clipped", !bodyEl.isContentEditable && bodyEl.scrollHeight > bodyEl.clientHeight + 1);
}

function buildNodeEl(n) {
  const el = document.createElement("div");
  el.className = "node";
  el.dataset.id = n.id;
  el.innerHTML = `
  <div class="node-title"></div>
  <div class="node-body"></div>
  <button class="node-toggle" type="button"></button>
  <span class="node-resize" title="Drag to resize (double-click to reset)"></span>`;
  el.querySelector(".node-title").textContent = n.title;
  el.querySelector(".node-body").innerHTML = n.html || "";
  el._html = n.html || "";
  el.querySelector(".node-body").addEventListener("load", (e) => {
    updateClip(e.currentTarget);
    scheduleEdges();
  }, true); // images finish loading after render

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".node-toggle") || e.target.isContentEditable) return;
    if (pointers.size > 0) return; // second finger of a pinch: let the canvas handle it
    e.stopPropagation();
    hideCtxMenu();
    hideColorPanel();
    if (editing && editing.nodeId !== n.id) stopEditing();
    select(n.id);
    beginPress(e, n.id);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    select(n.id);
    showCtxMenu(e.clientX, e.clientY);
  });
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (e.target.isContentEditable || editing?.nodeId === n.id) return;
    startEditBody(n.id);
  });
  const rz = el.querySelector(".node-resize");
  rz.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    hideCtxMenu();
    select(n.id);
    const sx = e.clientX, sy = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
    try { rz.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
    const move = (ev) => {
      n.rw = clamp(Math.round(w0 + (ev.clientX - sx) / view.z / (n.sc || 1)), 100, 1200);
      n.rh = clamp(Math.round(h0 + (ev.clientY - sy) / view.z / (n.sc || 1)), 44, 1600);
      applyNodeStyle(n);
      scheduleEdges();
    };
    const up = () => {
      rz.removeEventListener("pointermove", move);
      rz.removeEventListener("pointerup", up);
      rz.removeEventListener("pointercancel", up);
      markDirty();
    };
    rz.addEventListener("pointermove", move);
    rz.addEventListener("pointerup", up);
    rz.addEventListener("pointercancel", up);
  });
  rz.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    n.rw = n.rh = null;
    applyNodeStyle(n);
    scheduleEdges();
    markDirty();
  });
  // Touch: open the editor from a real click so mobile browsers grant focus and show the keyboard.
  el.addEventListener("click", () => {
    if (pendingEdit === n.id) { pendingEdit = null; startEditBody(n.id); }
  });
  el.querySelector(".node-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCollapse(n.id);
  });
  return el;
}

/* ---------- Edges ---------- */
function scheduleEdges() {
  if (edgeFrame) return;
  edgeFrame = requestAnimationFrame(() => { edgeFrame = 0; if (doc) renderEdges(); });
}

function renderEdges() {
  const frag = document.createDocumentFragment();
  const visible = visibleNodes();
  const ids = new Set(visible.map((n) => n.id));
  visible.forEach((n) => {
    n.children.forEach((cid) => {
      const c = doc.nodes[cid];
      if (c && ids.has(cid)) frag.appendChild(edgePath(n, c));
    });
  });
  edgesSvg.replaceChildren(frag);
}

function edgePath(a, b) {
  const aw = (a.el?.offsetWidth || a.w || NODE_W) * (a.sc || 1);
  const ah = (a.el?.offsetHeight || a.h || NODE_H) * (a.sc || 1);
  const bw = (b.el?.offsetWidth || b.w || NODE_W) * (b.sc || 1);
  const bh = (b.el?.offsetHeight || b.h || NODE_H) * (b.sc || 1);
  const toRight = b.x + bw / 2 >= a.x + aw / 2;
  const x1 = toRight ? a.x + aw : a.x;
  const y1 = a.y + ah / 2;
  const x2 = toRight ? b.x : b.x + bw;
  const y2 = b.y + bh / 2;
  const c = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const dir = x2 > x1 ? 1 : -1;
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", `M ${x1} ${y1} C ${x1 + dir * c} ${y1}, ${x2 - dir * c} ${y2}, ${x2} ${y2}`);
  p.setAttribute("stroke", a.color);
  return p;
}

/* ---------- Selection & toolbar state ---------- */
function select(id) {
  if (selectedId === id) return;
  selectedId = id;
  if (!id) hideColorPanel();
  renderAll();
}

function updateToolbarState() {
  const n = doc.nodes[selectedId];
  const has = !!n;
  $("#btn-delete").disabled = !has;
  $("#btn-add-child").disabled = !has;
  $("#btn-add-sibling").disabled = !has || !n.parentId;
  $("#btn-collapse").disabled = !has || !n.children.length;
  $("#btn-rename").disabled = !has;
  $("#btn-edit").disabled = !has || !n.parentId; // the root node has no body to edit
  colorBtn.disabled = !has;
  const collapsed = !!n?.collapsed;
  $("#collapse-label").textContent = collapsed ? "Expand" : "Collapse";
  $("#btn-collapse use").setAttribute("href", collapsed ? "#i-unfold" : "#i-fold");
}

/* ---------- Node press: drag to move, drop on a node to re-parent ---------- */
function beginPress(e, id) {
  press = {
    id,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    sx: e.clientX, sy: e.clientY,
    slop: e.pointerType === "mouse" ? 4 : 8,
    started: false,
    longPressed: false,
    origins: null,
    startWorld: screenToWorld(e.clientX, e.clientY),
    dropTarget: null,
    timer: 0,
  };
  if (e.pointerType !== "mouse") {
    press.timer = setTimeout(() => {
      if (!press || press.started) return;
      press.longPressed = true;
      showCtxMenu(press.sx, press.sy);
    }, LONG_PRESS_MS);
  }
}

function startDrag() {
  clearTimeout(press.timer);
  press.started = true;
  press.origins = new Map();
  [press.id, ...descendants(press.id)].forEach((d) => {
    const dn = doc.nodes[d];
    if (!dn) return;
    press.origins.set(d, { x: dn.x, y: dn.y });
    dn.el?.classList.add("dragging");
  });
  hideCtxMenu();
}

function movePress(e) {
  const p = press;
  if (p.longPressed) return;
  if (!p.started) {
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < p.slop) return;
    startDrag();
  }
  const w = screenToWorld(e.clientX, e.clientY);
  const dx = w.x - p.startWorld.x, dy = w.y - p.startWorld.y;
  p.origins.forEach((o, id) => {
    const n = doc.nodes[id];
    if (!n) return;
    n.x = o.x + dx;
    n.y = o.y + dy;
    positionNode(n);
  });
  scheduleEdges();

  // Drop-target detection (dragged nodes ignore pointer events, so we see through them)
  p.dropEl?.classList.remove("drop-target");
  p.dropEl = null;
  p.dropTarget = null;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".node");
  if (el && !isAncestor(p.id, el.dataset.id)) {
    el.classList.add("drop-target");
    p.dropEl = el;
    p.dropTarget = el.dataset.id;
  }
}

function endPress(cancelled) {
  const p = press;
  press = null;
  clearTimeout(p.timer);
  if (p.started) {
    p.origins.forEach((_, id) => doc.nodes[id]?.el?.classList.remove("dragging"));
    p.dropEl?.classList.remove("drop-target");
    if (!cancelled && p.dropTarget) reparent(p.id, p.dropTarget);
    else { scheduleEdges(); markDirty(); }
  } else if (!cancelled && !p.longPressed && p.pointerType !== "mouse") {
    handleTap(p.id);
  }
}

/** Touch has no dblclick we can rely on, so detect double-taps ourselves. */
function handleTap(id) {
  const now = performance.now();
  if (lastTap && lastTap.id === id && now - lastTap.t < DOUBLE_TAP_MS) {
    lastTap = null;
    pendingEdit = id;
    setTimeout(() => { if (pendingEdit === id) { pendingEdit = null; startEditBody(id); } }, 400);
  } else {
    lastTap = { id, t: now };
  }
}
