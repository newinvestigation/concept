importScripts('common.js');

chrome.commands.onCommand.addListener((command) => {
  if (command === 'apply-last-layout') {
    reapplyLastLayout();
  }
});

async function reapplyLastLayout() {
  const last = await cwtGetLastApplied();
  if (!last || !last.zones || !last.zones.length) return;

  const windows = await cwtGetAllWindows();
  const filtered = cwtSortWindowsStable(cwtFilterWindows(windows, last.titleFilter));
  if (!filtered.length) return;
  const ordered = cwtReorderByRemembered(filtered, last.windowOrder);
  const windowIds = ordered.map((w) => w.id);

  const displays = await cwtGetDisplays();
  const display = displays.find((d) => d.id === last.displayId);
  const referenceWindow =
    (display &&
      ordered.find((w) => {
        const cx = w.left + w.width / 2;
        const cy = w.top + w.height / 2;
        return (
          cx >= display.bounds.left &&
          cx <= display.bounds.left + display.bounds.width &&
          cy >= display.bounds.top &&
          cy <= display.bounds.top + display.bounds.height
        );
      })) ||
    ordered[0];

  const workArea = await cwtDetectWorkArea(referenceWindow.id);
  const { assignments } = await cwtApplyAssignment(last.zones, windowIds, workArea);
  await cwtSetLastApplied({ ...last, windowOrder: windowIds });

  const { lockPreference } = await chrome.storage.local.get('lockPreference');
  if (lockPreference !== false) {
    await cwtSetLockState({ enabled: true, assignments });
  }
}

// Registered at the top level so the (non-persistent) service worker wakes
// up for this event even after it's been unloaded for being idle.
chrome.windows.onBoundsChanged.addListener(async (win) => {
  const lock = await cwtGetLockState();
  if (!lock.enabled) return;
  const assignment = lock.assignments.find((a) => a.windowId === win.id);
  if (!assignment) return;

  const r = assignment.rect;
  const EPS = 2;
  const drifted =
    win.state !== 'normal' ||
    Math.abs(win.left - r.left) > EPS ||
    Math.abs(win.top - r.top) > EPS ||
    Math.abs(win.width - r.width) > EPS ||
    Math.abs(win.height - r.height) > EPS;
  if (!drifted) return;

  try {
    if (win.state !== 'normal') {
      await chrome.windows.update(win.id, { state: 'normal' });
    }
    await chrome.windows.update(win.id, { left: r.left, top: r.top, width: r.width, height: r.height });
  } catch (e) {
    // window may have been closed - ignore.
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const lock = await cwtGetLockState();
  if (!lock.enabled) return;
  const assignments = lock.assignments.filter((a) => a.windowId !== windowId);
  await cwtSetLockState({ enabled: lock.enabled, assignments });
});
