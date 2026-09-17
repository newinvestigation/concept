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
  const windowIds = filtered.map((w) => w.id);

  const displays = await cwtGetDisplays();
  const display = displays.find((d) => d.id === last.displayId);
  const referenceWindow =
    (display &&
      filtered.find((w) => {
        const cx = w.left + w.width / 2;
        const cy = w.top + w.height / 2;
        return (
          cx >= display.bounds.left &&
          cx <= display.bounds.left + display.bounds.width &&
          cy >= display.bounds.top &&
          cy <= display.bounds.top + display.bounds.height
        );
      })) ||
    filtered[0];

  const workArea = await cwtDetectWorkArea(referenceWindow.id);
  await cwtApplyAssignment(last.zones, windowIds, workArea);
}
