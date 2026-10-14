/** Full-page navigation, behind a seam so tests can assert the target without touching jsdom's location. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
