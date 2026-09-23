export function isMockInterviewWindow() {
  return new URLSearchParams(window.location.search).get("mock") === "1";
}
