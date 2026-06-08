/** Client-side navigation shared across the new shell and pages. */
export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}
