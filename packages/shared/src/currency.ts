// Relay operates in Rwandan Francs (RWF). RWF has no minor unit in practice,
// so amounts are whole numbers, shown with thousands separators.

export const CURRENCY_CODE = "RWF";

export function formatRWF(amount: number): string {
  const n = Math.round(amount);
  return `RWF ${n.toLocaleString("en-US")}`;
}

// Bare number with separators, no currency code (for tight table cells).
export function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString("en-US");
}
