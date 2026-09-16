let zones = [];
let selectedIndex = -1;
let stageEl;
let displays = [];
let dragState = null;

const PRESETS = [
  { key: '2x2', label: '2x2' },
  { key: '2x3', label: '2x3' },
  { key: '3x3', label: '3x3' },
  { key: '2x4', label: '2x4' },
  { key: 'cols-2', label: '세로 2분할' },
  { key: 'cols-3', label: '세로 3분할' },
  { key: 'cols-4', label: '세로 4분할' },
  { key: 'main-side', label: '메인+사이드' },
];

async function init() {
  stageEl = document.getElementById('stage');
  await populateDisplays();
  renderPresetButtons();
  bindGlobalControls();
  await refreshSavedLayouts();
  loadZones(CWT_PRESETS['2x2']());
}

async function populateDisplays() {
  displays = await cwtGetDisplays();
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
  select.addEventListener('change', updateStageAspect);
  updateStageAspect();
}

function getSelectedDisplay() {
  const id = document.getElementById('displaySelect').value;
  return displays.find((d) => String(d.id) === String(id)) || displays[0];
}

function updateStageAspect() {
  const display = getSelectedDisplay();
  if (!display) return;
  const { width, height } = display.workArea;
  const maxW = 760;
  const stageWidth = maxW;
  const stageHeight = Math.round(maxW * (height / width));
  stageEl.style.width = stageWidth + 'px';
  stageEl.style.height = stageHeight + 'px';
}

function renderPresetButtons() {
  const grid = document.getElementById('presetGrid');
  grid.innerHTML = '';
  PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    btn.addEventListener('click', () => loadZones(CWT_PRESETS[p.key]()));
    grid.appendChild(btn);
  });
}

function bindGlobalControls() {
  document.getElementById('addZoneBtn').addEventListener('click', addZone);
  document.getElementById('deleteZoneBtn').addEventListener('click', deleteSelectedZone);
  document.getElementById('saveLayoutBtn').addEventListener('click', saveCurrentLayout);
  ['zoneX', 'zoneY', 'zoneW', 'zoneH'].forEach((id) => {
    document.getElementById(id).addEventListener('input', onZoneFieldChange);
  });
}

function loadZones(newZones) {
  zones = newZones.map((z) => ({ ...z }));
  selectedIndex = -1;
  renderStage();
  updateZoneDetail();
}

function addZone() {
  const offset = (zones.length % 5) * 0.05;
  zones.push({ x: clamp01(0.1 + offset), y: clamp01(0.1 + offset), w: 0.3, h: 0.3 });
  selectedIndex = zones.length - 1;
  renderStage();
  updateZoneDetail();
}

function deleteSelectedZone() {
  if (selectedIndex < 0) return;
  zones.splice(selectedIndex, 1);
  selectedIndex = -1;
  renderStage();
  updateZoneDetail();
}

function renderStage() {
  stageEl.innerHTML = '';
  zones.forEach((zone, idx) => {
    const el = document.createElement('div');
    el.className = 'zone' + (idx === selectedIndex ? ' selected' : '');
    el.style.left = zone.x * 100 + '%';
    el.style.top = zone.y * 100 + '%';
    el.style.width = zone.w * 100 + '%';
    el.style.height = zone.h * 100 + '%';

    const labelEl = document.createElement('div');
    labelEl.className = 'zone-label';
    labelEl.textContent = String(idx + 1);
    el.appendChild(labelEl);

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);

    el.addEventListener('mousedown', (e) => onZoneMouseDown(e, idx));
    handle.addEventListener('mousedown', (e) => onResizeMouseDown(e, idx));

    stageEl.appendChild(el);
  });
}

function selectZone(idx) {
  selectedIndex = idx;
  renderStage();
  updateZoneDetail();
}

function updateZoneDetail() {
  const detail = document.getElementById('zoneDetail');
  const deleteBtn = document.getElementById('deleteZoneBtn');
  if (selectedIndex < 0 || !zones[selectedIndex]) {
    detail.hidden = true;
    deleteBtn.disabled = true;
    return;
  }
  deleteBtn.disabled = false;
  detail.hidden = false;
  const z = zones[selectedIndex];
  document.getElementById('zoneX').value = (z.x * 100).toFixed(1);
  document.getElementById('zoneY').value = (z.y * 100).toFixed(1);
  document.getElementById('zoneW').value = (z.w * 100).toFixed(1);
  document.getElementById('zoneH').value = (z.h * 100).toFixed(1);
}

function onZoneFieldChange() {
  if (selectedIndex < 0) return;
  const z = zones[selectedIndex];
  z.x = clamp01((parseFloat(document.getElementById('zoneX').value) || 0) / 100);
  z.y = clamp01((parseFloat(document.getElementById('zoneY').value) || 0) / 100);
  z.w = Math.min(1, Math.max(0.02, (parseFloat(document.getElementById('zoneW').value) || 2) / 100));
  z.h = Math.min(1, Math.max(0.02, (parseFloat(document.getElementById('zoneH').value) || 2) / 100));
  renderStage();
}

function onZoneMouseDown(e, idx) {
  if (e.target.classList.contains('resize-handle')) return;
  e.preventDefault();
  selectZone(idx);
  const rect = stageEl.getBoundingClientRect();
  const z = zones[idx];
  dragState = {
    mode: 'move',
    idx,
    startX: e.clientX,
    startY: e.clientY,
    origX: z.x,
    origY: z.y,
    stageW: rect.width,
    stageH: rect.height,
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onResizeMouseDown(e, idx) {
  e.preventDefault();
  e.stopPropagation();
  selectZone(idx);
  const rect = stageEl.getBoundingClientRect();
  const z = zones[idx];
  dragState = {
    mode: 'resize',
    idx,
    startX: e.clientX,
    startY: e.clientY,
    origW: z.w,
    origH: z.h,
    stageW: rect.width,
    stageH: rect.height,
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
  if (!dragState) return;
  const z = zones[dragState.idx];
  const dx = (e.clientX - dragState.startX) / dragState.stageW;
  const dy = (e.clientY - dragState.startY) / dragState.stageH;
  if (dragState.mode === 'move') {
    z.x = Math.min(1 - z.w, Math.max(0, dragState.origX + dx));
    z.y = Math.min(1 - z.h, Math.max(0, dragState.origY + dy));
  } else {
    z.w = Math.min(1 - z.x, Math.max(0.03, dragState.origW + dx));
    z.h = Math.min(1 - z.y, Math.max(0.03, dragState.origH + dy));
  }
  renderStage();
  updateZoneDetail();
}

function onMouseUp() {
  dragState = null;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
}

async function saveCurrentLayout() {
  const name = document.getElementById('layoutName').value.trim();
  if (!name) {
    alert('레이아웃 이름을 입력하세요.');
    return;
  }
  if (!zones.length) {
    alert('구역을 1개 이상 추가하세요.');
    return;
  }
  const layouts = await cwtGetLayouts();
  const existingIdx = layouts.findIndex((l) => l.name === name);
  const layout = {
    id: existingIdx >= 0 ? layouts[existingIdx].id : `${Date.now()}`,
    name,
    zones: zones.map((z) => ({ ...z })),
    updatedAt: Date.now(),
  };
  if (existingIdx >= 0) layouts[existingIdx] = layout;
  else layouts.push(layout);
  await cwtSaveLayouts(layouts);
  await refreshSavedLayouts();
}

async function refreshSavedLayouts() {
  const layouts = await cwtGetLayouts();
  const list = document.getElementById('savedLayoutList');
  list.innerHTML = '';
  if (!layouts.length) {
    list.innerHTML = '<li class="empty">없음</li>';
    return;
  }
  layouts.forEach((layout) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${layout.name} (${layout.zones.length})`;

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '불러오기';
    loadBtn.addEventListener('click', () => {
      document.getElementById('layoutName').value = layout.name;
      loadZones(layout.zones);
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`"${layout.name}" 레이아웃을 삭제할까요?`)) return;
      const updated = (await cwtGetLayouts()).filter((l) => l.id !== layout.id);
      await cwtSaveLayouts(updated);
      await refreshSavedLayouts();
    });

    li.appendChild(nameSpan);
    li.appendChild(loadBtn);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', init);
