// Selection scope is the rows currently rendered by the filtered list/page.
export function toggleVisibleSelection(selected, visibleIds) {
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  return allVisibleSelected ? [] : [...visibleIds];
}
