importScripts('common.js');

chrome.commands.onCommand.addListener((command) => {
  if (command === 'apply-last-layout') {
    reapplyLastLayout();
  }
});

async function reapplyLastLayout() {
  const last = await cwtGetLastApplied();
  if (!last || !last.zones || !last.zones.length) return;

  const displays = await cwtGetDisplays();
  const display =
    displays.find((d) => d.id === last.displayId) ||
    displays.find((d) => d.isPrimary) ||
    displays[0];
  if (!display) return;

  const windows = await cwtGetAllWindows();
  const filtered = cwtSortWindowsStable(cwtFilterWindows(windows, last.titleFilter));
  const windowIds = filtered.map((w) => w.id);

  await cwtApplyAssignment(last.zones, windowIds, display.workArea);
}
