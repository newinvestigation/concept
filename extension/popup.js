let currentZones = [];
let currentWindows = []; // ordered list matching zones, adjustable before applying
let currentTitleFilter = '';
let currentDisplayId = null;

async function initPopup() {
  await populateDisplays();
  await populateLayouts();

  document.getElementById('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('manageLayoutsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('quickTileBtn').addEventListener('click', onQuickTile);
  document.getElementById('confirmApplyBtn').addEventListener('click', onConfirmApply);
  document.getElementById('reapplyLastBtn').addEventListener('click', onReapplyLast);
  document.getElementById('sortByTitleBtn').addEventListener('click', sortByTitle);
  document.getElementById('sortByPositionBtn').addEventListener('click', sortByPosition);
  document.getElementById('reverseOrderBtn').addEventListener('click', reverseOrder);

  const saved = await chrome.storage.local.get(['lastTitleFilter']);
  if (saved.lastTitleFilter) document.getElementById('titleFilter').value = saved.lastTitleFilter;
}

async function populateDisplays() {
  const displays = await cwtGetDisplays();
  const select = document.getElementById('displaySelect');
  select.innerHTML = '';
  displays.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.isPrimary ? '[주 모니터] ' : ''}${d.name || '모니터 ' + (i + 1)} (${d.bounds.width}x${d.bounds.height})`;
    select.appendChild(opt);
  });
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  if (primary) select.value = primary.id;
}

async function populateLayouts() {
  const layouts = await cwtGetLayouts();
  const list = document.getElementById('layoutList');
  list.innerHTML = '';
  if (!layouts.length) {
    list.innerHTML = '<li class="empty">저장된 레이아웃이 없습니다.</li>';
    return;
  }
  layouts.forEach((layout) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${layout.name} (${layout.zones.length}구역)`;
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '적용';
    applyBtn.addEventListener('click', () => startAssignment(layout.zones));
    li.appendChild(nameSpan);
    li.appendChild(applyBtn);
    list.appendChild(li);
  });
}

async function onQuickTile() {
  const rows = parseInt(document.getElementById('quickRows').value, 10) || 1;
  const cols = parseInt(document.getElementById('quickCols').value, 10) || 1;
  const overlapPercent = parseFloat(document.getElementById('quickOverlap').value) || 0;
  const overlap = Math.min(0.3, Math.max(0, overlapPercent / 100));
  await startAssignment(cwtGenerateGridZones(rows, cols, overlap));
}

async function startAssignment(zones) {
  currentZones = zones;
  currentTitleFilter = document.getElementById('titleFilter').value;
  currentDisplayId = document.getElementById('displaySelect').value;
  await chrome.storage.local.set({ lastTitleFilter: currentTitleFilter });

  const allWindows = await cwtGetAllWindows();
  const filtered = cwtSortWindowsStable(cwtFilterWindows(allWindows, currentTitleFilter));
  currentWindows = filtered.slice(0, zones.length);

  renderOrderList();
  document.getElementById('assignSection').hidden = false;
}

let dragSrcIndex = null;

function renderOrderList() {
  const ol = document.getElementById('windowOrderList');
  ol.innerHTML = '';
  if (!currentWindows.length) {
    ol.innerHTML = '<li class="empty">조건에 맞는 창을 찾지 못했습니다.</li>';
    return;
  }
  currentWindows.forEach((win, idx) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = String(idx);

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';

    const label = document.createElement('span');
    label.className = 'order-label';
    label.textContent = `${idx + 1}. ${cwtWindowLabel(win)}`;

    li.appendChild(handle);
    li.appendChild(label);

    li.addEventListener('dragstart', (e) => {
      dragSrcIndex = idx;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const targetIdx = idx;
      if (dragSrcIndex === null || dragSrcIndex === targetIdx) return;
      const [moved] = currentWindows.splice(dragSrcIndex, 1);
      currentWindows.splice(targetIdx, 0, moved);
      dragSrcIndex = null;
      renderOrderList();
    });

    ol.appendChild(li);
  });
}

function sortByTitle() {
  currentWindows.sort((a, b) => cwtWindowLabel(a).localeCompare(cwtWindowLabel(b), 'ko'));
  renderOrderList();
}

function sortByPosition() {
  // Reading order: top row first, then left to right within a row.
  currentWindows.sort((a, b) => a.top - b.top || a.left - b.left);
  renderOrderList();
}

function reverseOrder() {
  currentWindows.reverse();
  renderOrderList();
}

// Picks a window already sitting on the target monitor (roughly, using
// chrome.system.display's bounds just to narrow candidates) to briefly
// maximize and measure the real usable screen area from.
function pickReferenceWindowId(windows, displayId, displays) {
  const display = displays.find((d) => String(d.id) === String(displayId));
  if (display) {
    const onDisplay = windows.find((w) => {
      const cx = w.left + w.width / 2;
      const cy = w.top + w.height / 2;
      return (
        cx >= display.bounds.left &&
        cx <= display.bounds.left + display.bounds.width &&
        cy >= display.bounds.top &&
        cy <= display.bounds.top + display.bounds.height
      );
    });
    if (onDisplay) return onDisplay.id;
  }
  return windows[0].id;
}

async function onConfirmApply() {
  if (!currentWindows.length) return;
  const displays = await cwtGetDisplays();
  const windowIds = currentWindows.map((w) => w.id);
  const referenceId = pickReferenceWindowId(currentWindows, currentDisplayId, displays);
  const workArea = await cwtDetectWorkArea(referenceId);

  await cwtApplyAssignment(currentZones, windowIds, workArea);
  await cwtSetLastApplied({
    zones: currentZones,
    titleFilter: currentTitleFilter,
    displayId: currentDisplayId,
  });
  document.getElementById('assignSection').hidden = true;
}

async function onReapplyLast() {
  const last = await cwtGetLastApplied();
  if (!last) return;
  const windows = await cwtGetAllWindows();
  const filtered = cwtSortWindowsStable(cwtFilterWindows(windows, last.titleFilter));
  if (!filtered.length) return;
  const windowIds = filtered.map((w) => w.id);
  const displays = await cwtGetDisplays();
  const referenceId = pickReferenceWindowId(filtered, last.displayId, displays);
  const workArea = await cwtDetectWorkArea(referenceId);
  await cwtApplyAssignment(last.zones, windowIds, workArea);
}

document.addEventListener('DOMContentLoaded', initPopup);
