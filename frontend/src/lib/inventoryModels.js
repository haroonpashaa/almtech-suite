export const MAX_SELECTED_MODELS = 100;

export function filterModelOptions(models, query) {
  const search = String(query || '').trim().toLocaleLowerCase();
  return (models || []).filter((model) => String(model).toLocaleLowerCase().includes(search));
}

export function toggleModelSelection(selected, model) {
  if (selected.includes(model)) return selected.filter((item) => item !== model);
  if (selected.length >= MAX_SELECTED_MODELS) return selected;
  return [...selected, model];
}

export function inventoryListParams({ q, lowStock, models }) {
  return {
    q: q || undefined,
    lowStock: lowStock || undefined,
    models: models.length ? JSON.stringify(models) : undefined,
  };
}
