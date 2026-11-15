"use strict";
const $ = id => document.getElementById(id);
const app = document.querySelector("main");
const grid = $("stage");
const tabId = Number(location.hash.slice(1));
for (const n of [0.25, 0.5, 1, 1.5, 2, 4]) $("rate").add(new Option(n + "×", n, false, n === 1));

let rows = [], running = false, epoch = 0, raf, lastSync = 0, drag = false, resume = false;
let scrubFrame = null, lastScrubSeek = 0, lastSecondarySync = 0;
let mode = "grid", flipIndex = 0, opacityValue = 50, wipeValue = 50;
const panel = $("panel");
const seekEl = $("seek");
let seekMax = 0, seekLocked = true;
const selected = () => rows.filter(row => row.kind === "video" && row.check.checked);
const limit = g => Math.min(...g.map(row => row.v.duration));

/* ---------- 帧率自适应 ---------- */
const FPS_CANDIDATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
let autoFps = 30;
const fpsSamples = [];

function snapFps(value) {
  let best = value, closest = Infinity;
  for (const candidate of FPS_CANDIDATES) {
    const diff = Math.abs(candidate - value);
    if (diff < closest) { closest = diff; best = candidate; }
  }
  return closest / value < 0.04 ? best : Math.round(value * 100) / 100;
}
function watchFrames(row) {
  const v = row.v;
  if (row.watching || typeof v.requestVideoFrameCallback !== "function") return;
  row.watching = true;
  let previous = null;
  const onFrame = (now, meta) => {
    if (previous !== null) {
      const delta = meta.mediaTime - previous;
      if (delta > 0.004 && delta < 0.1) {
        fpsSamples.push(1 / delta);
        if (fpsSamples.length > 30) fpsSamples.shift();
        if (fpsSamples.length >= 8) {
          const sorted = [...fpsSamples].sort((a, b) => a - b);
          autoFps = snapFps(sorted[sorted.length >> 1]);
        }
      }
    }
    previous = meta.mediaTime;
    if (running && selected()[0]?.v === v) v.requestVideoFrameCallback(onFrame);
    else row.watching = false;
  };
  v.requestVideoFrameCallback(onFrame);
}

function pause() {
  epoch++;
  running = false;
  for (const { v } of selected()) v.pause();
}
function stopGroup() {
  if (running || resume) pause();
  resume = false;
  drag = false;
}
function seekTo(row, t) {
  const v = row.v;
  row.target = t;
  if (row.seeking) { row.dirty = true; return; }
  if (Math.abs(v.currentTime - t) < 1e-4) return;
  row.seeking = true;
  row.dirty = false;
  v.currentTime = t;
}
function seek(t, scope = "all") {
  const group = selected();
  for (const [index, row] of group.entries()) {
    if (scope === "lead" && index > 0) continue;
    if (scope === "others" && index === 0) continue;
    const duration = row.v.duration;
    if (Number.isFinite(duration)) seekTo(row, Math.max(0, Math.min(duration, t)));
  }
}
function cancelSeeks() {
  for (const row of rows) row.dirty = false;
  if (!drag) scrubFrame = null;
}
async function play(startTime) {
  const g = selected();
  if (!g.length) { $("status").textContent = "请先勾选视频"; return; }
  const pending = g.filter(row => !Number.isFinite(row.v.duration));
  if (pending.length) {
    $("status").textContent = pending.map(row => row.name).join("、") + " 尚未就绪，请查看卡片状态";
    return;
  }
  $("status").textContent = "";
  const token = ++epoch;
  const position = startTime ?? g[0].v.currentTime;
  seek(position >= limit(g) - 0.015 ? 0 : position);
  running = true;
  try {
    await Promise.all(g.map(({ v }) => { v.playbackRate = +$("rate").value; return v.play(); }));
  } catch {
    if (token === epoch) { pause(); $("status").textContent = "播放失败，请检查原视频是否可播放"; }
  }
}

/* ---------- 浮层显隐（上下独立） ---------- */
let hideTopTimer, hideBottomTimer, pointerDown = false;
function showTop(sticky = false) {
  app.classList.remove("idle-top");
  clearTimeout(hideTopTimer);
  if (!sticky) hideTopSoon(650);
}
function hideTopSoon(delay = 120) {
  clearTimeout(hideTopTimer);
  hideTopTimer = setTimeout(() => {
    if (pointerDown) return;
    if ($("topbar").matches(":hover") || panel.matches(":hover")) return;
    if (!panel.hidden) closePanel(true);
    app.classList.add("idle-top");
  }, delay);
}
function showBottom(sticky = false) {
  app.classList.remove("idle-bottom");
  clearTimeout(hideBottomTimer);
  if (!sticky) hideBottomSoon(650);
}
function hideBottomSoon(delay = 120) {
  clearTimeout(hideBottomTimer);
  hideBottomTimer = setTimeout(() => {
    if (pointerDown) return;
    if ($("dock").matches(":hover")) return;
    app.classList.add("idle-bottom");
  }, delay);
}
function showChrome(sticky = false) { showTop(sticky); showBottom(sticky); }
function hideChromeSoon(delay = 120) { hideTopSoon(delay); hideBottomSoon(delay); }

const topZone = () => Math.min(120, Math.max(56, innerHeight * 0.10));
const bottomZone = () => Math.min(360, Math.max(150, innerHeight * 0.22));

document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
document.addEventListener("pointerup", event => {
  pointerDown = false;
  if (event.clientY > topZone()) hideTopSoon(150);
  if (event.clientY < innerHeight - bottomZone()) hideBottomSoon(150);
}, true);
document.addEventListener("pointercancel", () => { pointerDown = false; }, true);
$("topbar").addEventListener("pointerleave", () => { if (!pointerDown) hideTopSoon(120); });
$("dock").querySelector(".dock-panel").addEventListener("pointerleave", () => { if (!pointerDown) hideBottomSoon(120); });

document.addEventListener("pointermove", event => {
  const y = event.clientY, height = innerHeight;
  if (y <= topZone()) showTop(true);
  else if (!app.classList.contains("idle-top")) hideTopSoon();
  if (y >= height - bottomZone()) showBottom(true);
  else if (!app.classList.contains("idle-bottom")) hideBottomSoon();
}, { passive: true });
document.addEventListener("pointerleave", () => hideChromeSoon(100));

/* ---------- 素材面板 ---------- */
function openPanel() {
  panel.hidden = false;
  $("pick-toggle").setAttribute("aria-expanded", "true");
  showTop(true);
}
function closePanel(silent = false) {
  panel.hidden = true;
  $("pick-toggle").setAttribute("aria-expanded", "false");
  if (!silent) hideTopSoon();
}
$("pick-toggle").onclick = () => panel.hidden ? openPanel() : closePanel();
$("panel-close").onclick = () => closePanel();
document.addEventListener("pointerdown", event => {
  if (panel.hidden) return;
  if (panel.contains(event.target) || $("pick-toggle").contains(event.target)) return;
  closePanel();
});

/* ---------- 选中状态 ---------- */
function layoutCards() {
  const count = mode === "grid" ? rows.filter(row => row.check.checked).length : 1;
  grid.classList.toggle("many", count > 3);
  const columns = Math.ceil(Math.sqrt(count || 1));
  grid.style.setProperty("--cols", columns);
  grid.style.setProperty("--rows", Math.ceil(count / columns) || 1);
}
function checkedRows() {
  return rows.filter(row => row.check.checked)
    .sort((a, b) => Number(a.card.style.order) - Number(b.card.style.order));
}
function applyOverlayClasses() {
  app.style.setProperty("--diff-opacity", String(opacityValue / 100));
  app.style.setProperty("--wipe", wipeValue + "%");
  $("wipe-line").style.left = wipeValue + "%";
  $("diff-range").value = opacityValue;
  $("diff-label").textContent = mode === "wipe" ? "分割 " + wipeValue + "% · 拖动分割线" : opacityValue + "%";
}
function updateModeButtons() {
  const checked = checkedRows();
  for (const button of $("mode-seg").querySelectorAll("button")) {
    button.classList.toggle("on", button.dataset.mode === mode);
    const overlay = button.dataset.mode === "opacity" || button.dataset.mode === "wipe";
    button.disabled = (overlay && checked.length < 2) || (button.dataset.mode === "flip" && checked.length < 1);
  }
}
function applyMode() {
  const checked = checkedRows();
  const isOverlay = () => mode === "opacity" || mode === "wipe";
  if (isOverlay() && checked.length < 2) mode = "grid";
  if (mode === "flip" && checked.length < 1) mode = "grid";
  app.classList.toggle("mode-flip", mode === "flip");
  app.classList.toggle("mode-overlay", isOverlay());
  app.classList.toggle("overlay-opacity", mode === "opacity");
  app.classList.toggle("overlay-wipe", mode === "wipe");
  for (const row of rows) row.card.classList.remove("flip-active", "diff-base", "diff-top");
  $("flip-hint").hidden = mode !== "flip";
  if (mode === "flip") {
    flipIndex = ((flipIndex % checked.length) + checked.length) % checked.length;
    const row = checked[flipIndex];
    row.card.classList.add("flip-active");
    $("flip-hint").textContent = row.title + " · " + (flipIndex + 1) + "/" + checked.length
      + (bindings.cycle ? " · 点击画面或按 " + keyLabel(bindings.cycle) + " 切换" : " · 点击画面切换");
  }
  if (isOverlay()) {
    checked[0].card.classList.add("diff-base");
    checked[1].card.classList.add("diff-top");
  }
  $("overlay-box").hidden = !isOverlay();
  applyOverlayClasses();
  updateModeButtons();
  layoutCards();
}
function cycleFlip(step = 1) {
  const checked = checkedRows();
  if (!checked.length) return;
  if (mode !== "flip") {
    mode = "flip";
    flipIndex = 0;
    syncState();
    return;
  }
  flipIndex = (flipIndex + step + checked.length) % checked.length;
  applyMode();
}
function chooseMode(next) {
  if (next === "flip") { cycleFlip(1); return; }
  if (next === mode) return;
  if ((next === "opacity" || next === "wipe") && checkedRows().length < 2) {
    $("status").textContent = "叠加对比需要至少勾选 2 项素材";
    return;
  }
  mode = next;
  flipIndex = 0;
  syncState();
  if (mode === "opacity" || mode === "wipe") showBottom(true);
}
function refreshChips() {
  const list = rows.filter(row => row.check.checked)
    .sort((a, b) => Number(a.card.style.order) - Number(b.card.style.order));
  const chips = $("chips");
  chips.replaceChildren();
  for (const row of list) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.title = "取消 " + row.title;
    const name = document.createElement("b");
    name.textContent = row.title;
    const mark = document.createElement("span");
    mark.textContent = "✕";
    mark.setAttribute("aria-hidden", "true");
    chip.append(name, mark);
    chip.onclick = () => { row.check.checked = false; row.check.onchange(); };
    chips.append(chip);
  }
}
function syncState() {
  const checked = rows.filter(row => row.check.checked);
  app.classList.toggle("is-empty", checked.length === 0);
  app.classList.toggle("has-video", checked.some(row => row.kind === "video"));
  app.classList.toggle("has-image", checked.some(row => row.kind === "img"));
  $("pick-count").textContent = checked.length + "/" + rows.length;
  app.classList.toggle("can-scrub", checked.some(row => row.kind === "video"));
  applyMode();
  refreshChips();
}

/* ---------- 卡片排序 ---------- */
let dragCard = null;
function clearCardDrag() {
  dragCard?.classList.remove("dragging");
  dragCard = null;
  grid.querySelector(".drop-target")?.classList.remove("drop-target");
}
function enableCardSort(card, pick, index) {
  card.style.order = index;
  const handle = card.querySelector(".sort-handle");
  handle.ondragstart = event => {
    clearCardDrag();
    dragCard = card;
    card.classList.add("dragging");
    event.dataTransfer.setData("text/plain", handle.textContent);
    event.dataTransfer.effectAllowed = "move";
  };
  handle.ondragend = clearCardDrag;
  card.ondragover = event => {
    if (!dragCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    grid.querySelector(".drop-target")?.classList.remove("drop-target");
    if (card !== dragCard) card.classList.add("drop-target");
  };
  card.ondrop = event => {
    if (!dragCard) return;
    event.preventDefault();
    const cards = [...grid.children].sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const target = cards.indexOf(card);
    cards.splice(cards.indexOf(dragCard), 1);
    cards.splice(target, 0, dragCard);
    for (const [order, entry] of cards.entries()) {
      entry.style.order = order;
      rows[entry.dataset.pickIndex].pick.style.order = order;
    }
    clearCardDrag();
    applyMode();
    refreshChips();
  };
  card.dataset.pickIndex = index;
  pick.style.order = index;
}

/* ---------- 抓取来源页 ---------- */
let generation = 0;
async function sourceCall(options) {
  const [reply] = await chrome.scripting.executeScript({ target: { tabId }, ...options });
  if (!reply || reply.result == null) throw Error("来源页没有返回素材");
  return reply.result;
}
async function loadClip(item, session, row, version) {
  try {
    let url = item.url;
    if (item.transfer) {
      const chunks = [];
      let offset = 0, part;
      do {
        if (version !== generation) return;
        part = await sourceCall({
          func: (key, id, start) => globalThis.__syncClipReader(key, id, start),
          args: [session, item.id, offset],
        });
        const bytes = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
        if (!bytes.length && offset < part.size) throw Error("素材读取中断");
        chunks.push(bytes);
        offset += bytes.length;
      } while (offset < part.size);
      if (version !== generation) return;
      url = row.objectUrl = URL.createObjectURL(new Blob(chunks, { type: part.type }));
    }
    if (!/^(blob:|file:|https?:)/i.test(url)) throw Error("没有可独立播放的文件地址");
    row.v.src = url;
  } catch {
    row.message.textContent = item.transfer || item.stream ? "临时流无法独立读取" : "素材地址不可用";
  }
}
async function scan() {
  stopGroup();
  cancelSeeks();
  const version = ++generation;
  autoFps = 30;
  fpsSamples.length = 0;
  for (const row of rows) {
    row.v.pause?.();
    row.v.removeAttribute("src");
    row.v.load?.();
    if (row.objectUrl) URL.revokeObjectURL(row.objectUrl);
  }
  clearCardDrag();
  grid.replaceChildren();
  $("video-picks").replaceChildren();
  $("img-picks").replaceChildren();
  rows = [];
  syncState();
  $("status").textContent = "正在抓取来源页…";
  showChrome(true);
  try {
    const { session, descriptors } = await sourceCall({ files: ["collect.js"] });
    if (version !== generation) return;
    for (const item of descriptors) {
      const isImage = item.kind === "img";
      const group = $(isImage ? "img-picks" : "video-picks");
      const index = group.childElementCount;
      const card = document.createElement("article");
      card.innerHTML = '<div class="card-head"><strong draggable="true" class="sort-handle" title="拖到另一张素材卡片上调整顺序">⠿ 拖动排序</strong><span></span></div><em class="card-msg"></em>';
      const v = document.createElement(isImage ? "img" : "video");
      if (isImage) { v.alt = ""; v.draggable = false; }
      else { v.muted = true; v.playsInline = true; v.preload = "auto"; }
      card.append(v);
      const pick = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      const name = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
      const title = (isImage ? "图片 " : "视频 ") + name;
      const message = card.querySelector(".card-msg");
      message.textContent = "读取中…";
      v.onload = v.onloadedmetadata = () => { message.textContent = ""; };
      v.onerror = () => { message.textContent = "加载失败，请检查素材访问权限或编码"; };
      v.onwaiting = () => { message.textContent = "缓冲中…"; };
      v.oncanplay = () => { message.textContent = ""; };

      check.checked = false;
      card.hidden = true;
      check.onchange = () => {
        card.hidden = !check.checked;
        syncState();
        if (isImage) return;
        const wasPlaying = running;
        const previous = rows.filter(row => row.kind === "video" && (row.check === check ? !check.checked : row.check.checked));
        const position = previous[0]?.v.currentTime ?? 0;
        v.pause();
        stopGroup();
        if (wasPlaying && selected().length) play(position);
      };
      pick.append(check, title);
      group.append(pick);
      card.querySelector(".card-head span").textContent = title;
      enableCardSort(card, pick, item.id);
      grid.append(card);
      const row = { v, check, name, title, message, card, pick, kind: item.kind, seeking: false, dirty: false, target: 0, zoom: { scale: 1, x: 0, y: 0 } };
      v.addEventListener("seeked", () => {
        row.seeking = false;
        if (row.dirty) { row.dirty = false; seekTo(row, row.target); }
      });
      rows.push(row);
    }
    syncState();
    $("status").textContent = rows.length ? "已抓取 " + rows.length + " 项素材" : "未发现图片或视频，请检查来源页后重新抓取";
    hideBottomSoon(2200);
    for (const item of descriptors) {
      if (version !== generation) return;
      await loadClip(item, session, rows[item.id], version);
    }
  } catch {
    if (version === generation) {
      $("status").textContent = "无法读取来源页。请在原网页重新点击插件；本地网页需开启「允许访问文件网址」。";
      hideChromeSoon(4000);
    }
  }
}

/* ---------- 帧定位 ---------- */
function frameRate() {
  return autoFps;
}
function lastFrame(end, fps) {
  return Number.isFinite(end) ? Math.max(0, Math.ceil(end * fps - 1e-8) - 1) : 0;
}
function frameAt(time, fps, last) {
  return Math.min(last, Math.max(0, Math.floor(time * fps + 1e-6)));
}
function stepIndex(time, fps, last) {
  return Math.min(last, Math.max(0, Math.round(time * fps)));
}
function seekFrame(index) {
  const end = limit(selected());
  if (!Number.isFinite(end)) return;
  const fps = frameRate();
  const frame = Math.max(0, Math.min(Math.round(index), lastFrame(end, fps)));
  seek(frame / fps);
}
let rulerKey = "";
function renderRuler(end) {
  const ruler = $("ruler");
  const divisions = Math.max(2, Math.min(10, Math.floor(ruler.clientWidth / 80)));
  const key = end + "/" + divisions;
  if (key === rulerKey) return;
  rulerKey = key;
  ruler.replaceChildren();
  if (!Number.isFinite(end) || end <= 0) return;
  const ticks = document.createDocumentFragment();
  for (let i = 0; i <= divisions * 5; i++) {
    const fraction = i / (divisions * 5);
    const mark = document.createElement("i");
    mark.style.left = fraction * 100 + "%";
    if (i % 5 === 0) {
      mark.className = "major";
      const label = document.createElement("span");
      const seconds = end * fraction;
      if (end < 60) {
        label.textContent = Number(seconds.toFixed(end < 1 ? 3 : 2)) + "s";
      } else {
        const rounded = Math.round(seconds);
        label.textContent = Math.floor(rounded / 60) + ":" + String(rounded % 60).padStart(2, "0");
      }
      mark.append(label);
    }
    ticks.append(mark);
  }
  ruler.append(ticks);
}
let lastGroupText = "", lastTimeText = "", lastRunning = false, lastShownFrame = -1;
function tick(now) {
  const g = selected(), lead = g[0]?.v, end = limit(g);
  const fps = frameRate();
  const last = lastFrame(end, fps);
  if (running && lead) {
    if (g.some(row => row.v.ended) || lead.currentTime >= end - 0.015) { pause(); seek(end); }
    else {
      watchFrames(g[0]);
      if (now - lastSync > 300) {
        lastSync = now;
        for (const row of g.slice(1)) {
          const v = row.v;
          if (!lead.seeking && !v.seeking && v.readyState >= 3 && Math.abs(v.currentTime - lead.currentTime) > 0.10) seekTo(row, lead.currentTime);
        }
      }
    }
  }
  renderRuler(last / fps);
  let frame, t;
  if (drag && scrubFrame !== null) {
    frame = Math.min(scrubFrame, last);
    t = frame / fps;
    if (now - lastSecondarySync >= 240) { lastSecondarySync = now; seek(t, "others"); }
  } else {
    t = lead?.currentTime || 0;
    frame = running ? frameAt(t, fps, last) : stepIndex(t, fps, last);
  }
  const groupText = g.length ? g.map(row => row.name).join(" + ") : "未选择";
  if (groupText !== lastGroupText) { lastGroupText = groupText; $("group").textContent = groupText; }
  seekMax = last;
  seekLocked = !Number.isFinite(end);
  seekEl.classList.toggle("disabled", seekLocked);
  if (!drag && frame !== lastShownFrame) {
    lastShownFrame = frame;
    setSeekVisual(frame, last);
    seekEl.setAttribute("aria-valuetext", "第 " + (frame + 1) + " 帧");
  }
  const timeText = (Number.isFinite(end) ? (frame + 1) + "/" + (last + 1) + " 帧 · " : "")
    + t.toFixed(3) + (Number.isFinite(end) ? " / " + end.toFixed(3) : "") + " s · "
    + (Number.isInteger(autoFps) ? autoFps : autoFps.toFixed(3)) + " fps";
  if (timeText !== lastTimeText) { lastTimeText = timeText; $("time").textContent = timeText; }
  if (running !== lastRunning) {
    lastRunning = running;
    $("play").classList.toggle("is-playing", running);
    $("play").setAttribute("aria-label", running ? "暂停" : "播放");
  }
  raf = requestAnimationFrame(tick);
}

/* ---------- 控制 ---------- */
function setSelection(checked) {
  const position = selected()[0]?.v.currentTime ?? 0;
  const wasPlaying = running;
  stopGroup();
  cancelSeeks();
  for (const row of rows) {
    row.check.checked = checked;
    row.card.hidden = !checked;
  }
  syncState();
  if (checked && wasPlaying && selected().length) play(position);
}
$("all").onclick = () => setSelection(true);
$("none").onclick = () => setSelection(false);
$("scan").onclick = scan;
$("close").onclick = () => window.close();
$("play").onclick = () => { if (running) pause(); else play(); };
$("rate").onchange = () => selected().forEach(({ v }) => v.playbackRate = +$("rate").value);
$("zero").onclick = () => { pause(); seek(0); };
for (const [id, d] of [["prev", -1], ["next", 1]]) $(id).onclick = () => {
  const g = selected();
  if (!g.length || !Number.isFinite(limit(g))) return;
  const fps = frameRate();
  pause();
  seekFrame(stepIndex(g[0].v.currentTime, fps, lastFrame(limit(g), fps)) + d);
};
function setSeekVisual(frame, max) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, frame / max)) : 0;
  $("seek-fill").style.width = ratio * 100 + "%";
  $("seek-thumb").style.left = ratio * 100 + "%";
  seekEl.setAttribute("aria-valuenow", String(frame));
  seekEl.setAttribute("aria-valuemax", String(max));
}
function frameAtPointer(event) {
  const rect = seekEl.getBoundingClientRect();
  if (!rect.width || seekMax <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return Math.round(ratio * seekMax);
}
function endScrub(event) {
  if (!drag) return;
  drag = false;
  seekEl.classList.remove("dragging");
  if (event && seekEl.hasPointerCapture?.(event.pointerId)) {
    try { seekEl.releasePointerCapture(event.pointerId); } catch {}
  }
  if (scrubFrame !== null) seekFrame(scrubFrame);
  scrubFrame = null;
  if (resume) { resume = false; play(); }
}
seekEl.addEventListener("pointerdown", event => {
  if (seekLocked || seekMax <= 0) return;
  event.preventDefault();
  try { seekEl.setPointerCapture(event.pointerId); } catch {}
  seekEl.classList.add("dragging");
  resume = running;
  pause();
  drag = true;
  scrubFrame = frameAtPointer(event);
  lastScrubSeek = performance.now();
  setSeekVisual(scrubFrame, seekMax);
  seek(scrubFrame / frameRate(), "lead");
});
seekEl.addEventListener("pointermove", event => {
  if (!drag) return;
  scrubFrame = frameAtPointer(event);
  setSeekVisual(scrubFrame, seekMax);
  const now = performance.now();
  if (now - lastScrubSeek >= 28) {
    lastScrubSeek = now;
    seek(scrubFrame / frameRate(), "lead");
  }
});
seekEl.addEventListener("pointerup", endScrub);
seekEl.addEventListener("pointercancel", endScrub);

/* ---------- 对比模式 ---------- */
$("mode-seg").addEventListener("click", event => {
  const button = event.target.closest("button[data-mode]");
  if (!button || button.disabled) return;
  chooseMode(button.dataset.mode);
});
$("diff-range").addEventListener("input", event => {
  opacityValue = Number(event.target.value);
  applyMode();
});
const wipeLine = $("wipe-line");
let wipeDragging = false;
function setWipeAt(clientX) {
  wipeValue = Math.round(Math.min(1, Math.max(0, clientX / innerWidth)) * 100);
  applyOverlayClasses();
}
wipeLine.addEventListener("pointerdown", event => {
  if (mode !== "wipe") return;
  event.preventDefault();
  wipeDragging = true;
  try { wipeLine.setPointerCapture(event.pointerId); } catch {}
  setWipeAt(event.clientX);
});
wipeLine.addEventListener("pointermove", event => {
  if (!wipeDragging) return;
  setWipeAt(event.clientX);
});
function endWipe(event) {
  if (!wipeDragging) return;
  wipeDragging = false;
  if (event && wipeLine.hasPointerCapture?.(event.pointerId)) {
    try { wipeLine.releasePointerCapture(event.pointerId); } catch {}
  }
}
wipeLine.addEventListener("pointerup", endWipe);
wipeLine.addEventListener("pointercancel", endWipe);
/* ---------- 画面拖动 scrub ---------- */
let areaScrub = null;
function videoContentRect(row) {
  const v = row.v;
  if (!v.videoWidth || !v.videoHeight) return null;
  const rect = row.card.getBoundingClientRect();
  const cover = app.classList.contains("mode-cover");
  const scale = cover
    ? Math.max(rect.width / v.videoWidth, rect.height / v.videoHeight)
    : Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight);
  const width = v.videoWidth * scale;
  const height = v.videoHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    right: rect.left + (rect.width + width) / 2,
    top: rect.top + (rect.height - height) / 2,
    bottom: rect.top + (rect.height + height) / 2,
  };
}
function inVideoContent(event, row) {
  if (row.zoom && row.zoom.scale > 1) return true;
  const rect = videoContentRect(row);
  return !!rect && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
}
grid.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  if (event.target.closest(".card-head")) return;
  const card = event.target.closest("article");
  const row = card ? rows.find(item => item.card === card) : null;
  const group = selected();
  const end = group.length ? limit(group) : NaN;
  const fps = frameRate();
  const scrub = {
    id: event.pointerId, x: event.clientX, moved: false,
    canScrub: !!row && row.kind === "video" && row.check.checked
      && group.length > 0 && Number.isFinite(end) && inVideoContent(event, row),
  };
  if (scrub.canScrub) {
    scrub.fps = fps;
    scrub.last = lastFrame(end, fps);
    scrub.frame = stepIndex(group[0].v.currentTime, fps, scrub.last);
  }
  areaScrub = scrub;
  try { grid.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
});
grid.addEventListener("pointermove", event => {
  const scrub = areaScrub;
  if (!scrub || event.pointerId !== scrub.id || !scrub.canScrub) return;
  const dx = event.clientX - scrub.x;
  if (!scrub.moved) {
    if (Math.abs(dx) < 4) return;
    scrub.moved = true;
    resume = running;
    pause();
    drag = true;
    showBottom(true);
  }
  const step = event.shiftKey ? 10 : 1;
  const frame = Math.max(0, Math.min(scrub.last, Math.round(scrub.frame + dx * step)));
  scrubFrame = frame;
  setSeekVisual(frame, scrub.last);
  const now = performance.now();
  if (now - lastScrubSeek >= 28) {
    lastScrubSeek = now;
    seek(frame / scrub.fps, "lead");
  }
});
function endAreaScrub(event) {
  const scrub = areaScrub;
  if (!scrub || event.pointerId !== scrub.id) return;
  areaScrub = null;
  if (grid.hasPointerCapture?.(event.pointerId)) {
    try { grid.releasePointerCapture(event.pointerId); } catch {}
  }
  if (scrub.moved) endScrub();
  else if (mode === "flip") cycleFlip(1);
}
grid.addEventListener("pointerup", endAreaScrub);
grid.addEventListener("pointercancel", event => {
  const scrub = areaScrub;
  if (!scrub || event.pointerId !== scrub.id) return;
  areaScrub = null;
  if (scrub.moved) endScrub();
});

/* ---------- 缩放（滚轮 + 中键拖动） ---------- */
const MAX_ZOOM = 4;
let pan = null;

function setZoom(row, scale, x, y) {
  const rect = row.card.getBoundingClientRect();
  const next = Math.max(1, Math.min(MAX_ZOOM, scale));
  if (next <= 1) { x = 0; y = 0; }
  else {
    x = Math.min(0, Math.max(rect.width - next * rect.width, x));
    y = Math.min(0, Math.max(rect.height - next * rect.height, y));
  }
  row.zoom = { scale: next, x, y };
  const style = row.v.style;
  style.transformOrigin = "0 0";
  if (next === 1) {
    style.transform = "";
    style.willChange = "";
  } else {
    style.transform = "translate(" + x + "px," + y + "px) scale(" + next + ")";
    style.willChange = "transform";
  }
}
function resetZoom(row) { setZoom(row, 1, 0, 0); }
function resetAllZoom() { for (const row of rows) resetZoom(row); }

grid.addEventListener("wheel", event => {
  const card = event.target.closest("article");
  const row = card ? rows.find(item => item.card === card) : null;
  if (!row) return;
  event.preventDefault();
  const rect = row.card.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const zoom = row.zoom;
  const scale = Math.max(1, Math.min(MAX_ZOOM, zoom.scale * Math.exp(-event.deltaY * 0.0015)));
  if (Math.abs(scale - zoom.scale) < 0.001) return;
  const qx = (px - zoom.x) / zoom.scale;
  const qy = (py - zoom.y) / zoom.scale;
  setZoom(row, scale, px - scale * qx, py - scale * qy);
}, { passive: false });

grid.addEventListener("mousedown", event => { if (event.button === 1) event.preventDefault(); });
grid.addEventListener("pointerdown", event => {
  if (event.button !== 1) return;
  const card = event.target.closest("article");
  const row = card ? rows.find(item => item.card === card) : null;
  if (!row || row.zoom.scale <= 1) return;
  event.preventDefault();
  pan = { row, x: event.clientX, y: event.clientY };
  try { grid.setPointerCapture(event.pointerId); } catch {}
});
grid.addEventListener("pointermove", event => {
  if (!pan) return;
  const zoom = pan.row.zoom;
  setZoom(pan.row, zoom.scale, zoom.x + event.clientX - pan.x, zoom.y + event.clientY - pan.y);
  pan.x = event.clientX;
  pan.y = event.clientY;
});
function endPan() { pan = null; }
grid.addEventListener("pointerup", endPan);
grid.addEventListener("pointercancel", endPan);

grid.addEventListener("dblclick", event => {
  const card = event.target.closest("article");
  const row = card ? rows.find(item => item.card === card) : null;
  if (row) resetZoom(row);
});

/* ---------- 显示模式 / 全屏 ---------- */
$("fit-toggle").onclick = () => {
  const cover = app.classList.toggle("mode-cover");
  $("fit-toggle").textContent = cover ? "裁剪" : "适应";
  $("fit-toggle").title = cover ? "当前：填充裁剪（画面放大，边缘被裁）" : "当前：完整显示（保留黑边）";
};
$("fullscreen").onclick = () => {
  const task = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  task?.catch?.(() => {});
};
document.addEventListener("fullscreenchange", () => {
  app.classList.toggle("fs", !!document.fullscreenElement);
  showChrome();
});

/* ---------- 快捷键（可自定义） ---------- */
const SHORTCUT_ACTIONS = [
  { id: "grid", label: "并排" },
  { id: "flip", label: "交替（切下一项）" },
  { id: "opacity", label: "透明度叠加" },
  { id: "wipe", label: "滑动对比" },
  { id: "zoom", label: "缩放复位" },
  { id: "toggleOpacity", label: "透明度开关" },
  { id: "cycle", label: "切换 A/B" },
  { id: "play", label: "播放 / 暂停" },
  { id: "prev", label: "上一帧" },
  { id: "next", label: "下一帧" },
  { id: "start", label: "回到起点" },
];
const DEFAULT_BINDINGS = {
  grid: "Digit1",
  flip: "Digit2",
  opacity: "Digit3",
  wipe: "Digit4",
  zoom: "KeyZ",
  toggleOpacity: "KeyD",
  cycle: "KeyC",
  play: "Space",
  prev: "ArrowLeft",
  next: "ArrowRight",
  start: "Home",
};
const bindings = { ...DEFAULT_BINDINGS };
let captureAction = null;

function keyId(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.code || event.key);
  return parts.join("+");
}
function keyLabel(id) {
  if (!id) return "未设置";
  return id.split("+").map(part => {
    if (part === "Space") return "空格";
    if (part === "ArrowLeft") return "←";
    if (part === "ArrowRight") return "→";
    if (part === "ArrowUp") return "↑";
    if (part === "ArrowDown") return "↓";
    if (part === "Escape") return "Esc";
    if (part.startsWith("Digit")) return part.slice(5);
    if (part.startsWith("Key")) return part.slice(3);
    return part;
  }).join("+");
}
function runAction(id) {
  switch (id) {
    case "grid": chooseMode("grid"); break;
    case "flip": chooseMode("flip"); break;
    case "opacity": chooseMode("opacity"); break;
    case "wipe": chooseMode("wipe"); break;
    case "zoom": resetAllZoom(); break;
    case "toggleOpacity": chooseMode(mode === "opacity" ? "grid" : "opacity"); break;
    case "cycle": cycleFlip(1); break;
    case "play": $("play").click(); break;
    case "prev": $("prev").click(); break;
    case "next": $("next").click(); break;
    case "start": $("zero").click(); break;
  }
}
function setBinding(action, value) {
  if (value) {
    for (const other of Object.keys(bindings)) {
      if (other !== action && bindings[other] === value) bindings[other] = "";
    }
  }
  bindings[action] = value;
  saveBindings();
  updateTitles();
}
function renderKeys() {
  const list = $("keys-list");
  list.replaceChildren();
  for (const action of SHORTCUT_ACTIONS) {
    const row = document.createElement("div");
    row.className = "key-row";
    const label = document.createElement("span");
    label.textContent = action.label;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-btn" + (captureAction === action.id ? " capturing" : "");
    button.textContent = captureAction === action.id ? "按下新键…" : keyLabel(bindings[action.id]);
    button.onclick = () => { captureAction = action.id; renderKeys(); };
    row.append(label, button);
    list.append(row);
  }
}
function updateTitles() {
  const modeTitles = { grid: "并排", flip: "交替", opacity: "透明度叠加", wipe: "滑动对比" };
  for (const button of $("mode-seg").querySelectorAll("button")) {
    const key = bindings[button.dataset.mode];
    button.title = modeTitles[button.dataset.mode] + (key ? " (" + keyLabel(key) + ")" : "");
  }
  const titles = [
    ["play", "play", "播放 / 暂停"],
    ["prev", "prev", "上一帧"],
    ["next", "next", "下一帧"],
    ["zero", "start", "回到起点"],
  ];
  for (const [elementId, action, label] of titles) {
    const key = bindings[action];
    $(elementId).title = label + (key ? " (" + keyLabel(key) + ")" : "");
  }
  $("fullscreen").title = "全屏";
  $("all").title = "全选素材";
  $("scan").title = "重新抓取";
}
function saveBindings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) chrome.storage.local.set({ shortcuts: bindings });
  } catch {}
  try { localStorage.setItem("shortcuts", JSON.stringify(bindings)); } catch {}
}
function loadBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem("shortcuts") || "null");
    if (saved) Object.assign(bindings, saved);
  } catch {}
  updateTitles();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get("shortcuts", result => {
        if (result?.shortcuts) {
          Object.assign(bindings, result.shortcuts);
          updateTitles();
          if (captureAction === null) renderKeys();
        }
      });
    }
  } catch {}
}
function openKeys() {
  $("keys-dialog").hidden = false;
  captureAction = null;
  renderKeys();
  showChrome(true);
}
function closeKeys() {
  $("keys-dialog").hidden = true;
  captureAction = null;
}
$("keys").onclick = openKeys;
$("keys-close").onclick = closeKeys;
$("keys-reset").onclick = () => {
  Object.assign(bindings, DEFAULT_BINDINGS);
  saveBindings();
  updateTitles();
  renderKeys();
};
document.addEventListener("pointerdown", event => {
  if ($("keys-dialog").hidden) return;
  if ($("keys-dialog").contains(event.target) || $("keys").contains(event.target)) return;
  closeKeys();
});
document.addEventListener("pointerup", event => {
  const button = event.target.closest("button");
  if (button) button.blur();
});
for (const id of ["rate", "diff-range"]) {
  $(id).addEventListener("change", event => event.target.blur());
}

document.addEventListener("keydown", event => {
  if (!captureAction) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") { captureAction = null; renderKeys(); return; }
  if (event.key === "Backspace" || event.key === "Delete") {
    setBinding(captureAction, "");
    captureAction = null;
    renderKeys();
    return;
  }
  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
  setBinding(captureAction, keyId(event));
  captureAction = null;
  renderKeys();
}, true);

/* ---------- 快捷键 ---------- */
document.addEventListener("keydown", event => {
  if (captureAction) return;
  if (event.key === "Escape") {
    if (!$("keys-dialog").hidden) { closeKeys(); return; }
    if (!panel.hidden) { closePanel(); return; }
  }
  showChrome();
  if (!$("keys-dialog").hidden) return;
  const tag = event.target.tagName;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
  const action = SHORTCUT_ACTIONS.find(item => bindings[item.id] === keyId(event));
  if (!action) return;
  if (action.id === "play" && tag === "BUTTON") return;
  event.preventDefault();
  runAction(action.id);
});

loadBindings();
openPanel();
scan();
raf = requestAnimationFrame(tick);
