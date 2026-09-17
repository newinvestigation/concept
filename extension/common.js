// common.js - shared helpers used by popup.js, options.js, background.js
// Loaded as a classic script (not a module) so its top-level declarations
// are visible to whichever script runs after it in the same context.

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

async function cwtGetDisplays() {
  return await chrome.system.display.getInfo();
}

async function cwtGetAllWindows() {
  return await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup'] });
}

function cwtWindowLabel(win) {
  const tabs = win.tabs || [];
  const tab = tabs.find((t) => t.active) || tabs[0];
  if (tab && tab.title) return tab.title;
  return `창 #${win.id}`;
}

function cwtFilterWindows(windows, titleFilter) {
  const term = (titleFilter || '').trim().toLowerCase();
  if (!term) return windows.slice();
  return windows.filter((w) => {
    const label = cwtWindowLabel(w).toLowerCase();
    const url = ((w.tabs || [])[0] || {}).url || '';
    return label.includes(term) || url.toLowerCase().includes(term);
  });
}

function cwtSortWindowsStable(windows) {
  return [...windows].sort((a, b) => a.id - b.id);
}

function cwtGenerateGridZones(rows, cols) {
  const zones = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      zones.push({
        x: c / cols,
        y: r / rows,
        w: 1 / cols,
        h: 1 / rows,
      });
    }
  }
  return zones;
}

const CWT_PRESETS = {
  '2x2': () => cwtGenerateGridZones(2, 2),
  '2x3': () => cwtGenerateGridZones(2, 3),
  '3x3': () => cwtGenerateGridZones(3, 3),
  '2x4': () => cwtGenerateGridZones(2, 4),
  '2x8': () => cwtGenerateGridZones(2, 8),
  'cols-2': () => cwtGenerateGridZones(1, 2),
  'cols-3': () => cwtGenerateGridZones(1, 3),
  'cols-4': () => cwtGenerateGridZones(1, 4),
  'main-side': () => [
    { x: 0, y: 0, w: 0.65, h: 1 },
    { x: 0.65, y: 0, w: 0.35, h: 0.5 },
    { x: 0.65, y: 0.5, w: 0.35, h: 0.5 },
  ],
};

function cwtRectFromZone(zone, workArea) {
  return {
    left: Math.round(workArea.left + clamp01(zone.x) * workArea.width),
    top: Math.round(workArea.top + clamp01(zone.y) * workArea.height),
    width: Math.max(50, Math.round(clamp01(zone.w) * workArea.width)),
    height: Math.max(50, Math.round(clamp01(zone.h) * workArea.height)),
  };
}

async function cwtMoveWindow(windowId, rect) {
  try {
    // A maximized/minimized window ignores bounds updates until it's
    // back to the 'normal' state, so that has to happen first.
    await chrome.windows.update(windowId, { state: 'normal' });
  } catch (e) {
    // window may already be normal, or may have been closed - ignore.
  }
  try {
    await chrome.windows.update(windowId, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  } catch (e) {
    console.warn('[chat-window-tiler] failed to move window', windowId, e);
  }
}

async function cwtApplyAssignment(zones, windowIds, workArea) {
  const count = Math.min(zones.length, windowIds.length);
  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(cwtMoveWindow(windowIds[i], cwtRectFromZone(zones[i], workArea)));
  }
  await Promise.all(tasks);
}

async function cwtGetLayouts() {
  const { layouts } = await chrome.storage.local.get('layouts');
  return layouts || [];
}

async function cwtSaveLayouts(layouts) {
  await chrome.storage.local.set({ layouts });
}

async function cwtSetLastApplied(data) {
  await chrome.storage.local.set({ lastApplied: data });
}

async function cwtGetLastApplied() {
  const { lastApplied } = await chrome.storage.local.get('lastApplied');
  return lastApplied || null;
}
