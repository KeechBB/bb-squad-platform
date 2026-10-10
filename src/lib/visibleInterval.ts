/** setInterval that skips ticks while the tab is hidden (cuts API storms). */
export function setVisibleInterval(
  fn: () => void,
  ms: number
): () => void {
  const id = window.setInterval(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    fn();
  }, ms);
  return () => window.clearInterval(id);
}
