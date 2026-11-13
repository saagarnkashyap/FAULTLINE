/** UI time only; engine contracts continue to use integer steps. */
export function formatTime(step: number, stepDurationMs = 1000): string {
  const seconds = Math.floor(step * stepDurationMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
