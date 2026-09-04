export function isOverlayWindow() {
  return new URLSearchParams(window.location.search).get("overlay") === "1";
}
