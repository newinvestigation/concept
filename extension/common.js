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

// overlapFraction lets adjacent rows intentionally overlap around each
// internal row boundary - handy for letting a row's bottom edge cover the
// next row's title/address bar instead of wasting a full row boundary's
// worth of screen space on it. The overlap is split evenly across the two
// rows that share a boundary, so both end up the same height instead of
// one growing at the other's expense. 0 means a plain, non-overlapping grid.
function cwtGenerateGridZones(rows, cols, overlapFraction = 0) {
  const zones = [];
  for (let r = 0; r < rows; r++) {
    const half = overlapFraction / 2;
    const top = r / rows - (r > 0 ? half : 0);
    const bottom = (r + 1) / rows + (r < rows - 1 ? half : 0);
    for (let c = 0; c < cols; c++) {
      zones.push({
        x: c / cols,
        y: top,
        w: 1 / cols,
        h: bottom - top,
      });
    }
  }
  return zones;
}

const CWT_PRESETS = {
  '2x2': (overlap = 0) => cwtGenerateGridZones(2, 2, overlap),
  '2x3': (overlap = 0) => cwtGenerateGridZones(2, 3, overlap),
  '3x3': (overlap = 0) => cwtGenerateGridZones(3, 3, overlap),
  '2x4': (overlap = 0) => cwtGenerateGridZones(2, 4, overlap),
  '2x8': (overlap = 0) => cwtGenerateGridZones(2, 8, overlap),
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

// Returns the window's actual resulting bounds, which can be larger than
// requested if the browser enforces a minimum window size.
async function cwtMoveWindow(windowId, rect) {
  try {
    // A maximized/minimized window ignores bounds updates until it's
    // back to the 'normal' state, so that has to happen first.
    await chrome.windows.update(windowId, { state: 'normal' });
  } catch (e) {
    // window may already be normal, or may have been closed - ignore.
  }
  try {
    return await chrome.windows.update(windowId, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  } catch (e) {
    console.warn('[chat-window-tiler] failed to move window', windowId, e);
    return null;
  }
}

// chrome.system.display reports monitor size in a coordinate space that can
// disagree with chrome.windows.update's coordinate space when Windows
// display scaling isn't 100% - the usual symptom is tiled windows running
// past the right/bottom edge of the real screen. Maximizing an actual
// window and reading its bounds back sidesteps that mismatch entirely,
// since both the read and the write go through the same chrome.windows API.
async function cwtDetectWorkArea(referenceWindowId) {
  await chrome.windows.update(referenceWindowId, { state: 'maximized' });
  const maximized = await chrome.windows.get(referenceWindowId);
  await chrome.windows.update(referenceWindowId, { state: 'normal' });
  return { left: maximized.left, top: maximized.top, width: maximized.width, height: maximized.height };
}

// Groups zone/window pairs that sit in the same horizontal band (same y
// and height), preserving left-to-right order within each group. Custom
// zones that don't line up into rows just end up as one-item "rows",
// which is harmless.
function cwtGroupIntoRows(pairs, epsilon = 0.01) {
  const rows = [];
  for (const pair of pairs) {
    const row = rows.find(
      (r) => Math.abs(r[0].zone.y - pair.zone.y) < epsilon && Math.abs(r[0].zone.h - pair.zone.h) < epsilon
    );
    if (row) row.push(pair);
    else rows.push([pair]);
  }
  return rows;
}

async function cwtApplyAssignment(zones, windowIds, workArea) {
  const count = Math.min(zones.length, windowIds.length);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    const zone = zones[i];
    pairs.push({ zone, windowId: windowIds[i], rect: cwtRectFromZone(zone, workArea) });
  }

  await Promise.all(
    pairs.map(async (pair) => {
      pair.actual = await cwtMoveWindow(pair.windowId, pair.rect);
    })
  );

  // A window can't always shrink to the exact width we asked for (the
  // browser may enforce a minimum). If we left every window at its
  // requested left position regardless, a window that stayed wider than
  // planned would simply overlap its neighbour. Instead, re-pack each row
  // left-to-right using the width each window actually ended up with.
  const rows = cwtGroupIntoRows(pairs);
  let overflowRowCount = 0;
  for (const row of rows) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.zone.x - b.zone.x);
    let cursor = row[0].rect.left;
    for (const pair of row) {
      const actualWidth = (pair.actual && pair.actual.width) || pair.rect.width;
      const targetLeft = Math.round(cursor);
      if (targetLeft !== pair.rect.left) {
        try {
          await chrome.windows.update(pair.windowId, { left: targetLeft });
        } catch (e) {
          // window may have been closed - ignore.
        }
      }
      cursor += actualWidth;
    }
    if (cursor > workArea.left + workArea.width + 1) overflowRowCount += 1;
  }

  // When zones intentionally overlap (e.g. a taller top row covering the
  // row below it), the zone higher on screen (smaller y) should end up on
  // top. Focusing a window brings it to the front, so focus bottom-most
  // zones first and top-most zones last.
  const focusOrder = [...pairs].sort((a, b) => b.zone.y - a.zone.y);
  for (const { windowId } of focusOrder) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (e) {
      // window may have been closed - ignore.
    }
  }

  return { overflowRowCount };
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
