export const money = (n, currency = 'PKR') =>
  `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');
export const datetime = (d) => (d ? new Date(d).toLocaleString() : '—');

export const errorMessage = (e) =>
  e?.response?.data?.message || e?.message || 'Something went wrong';
