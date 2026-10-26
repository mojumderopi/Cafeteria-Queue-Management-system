"use client";
/**
 * Format minor units (e.g. cents/paisa) into a localized currency string.
 * Defaults to BDT (৳) because all existing code uses ৳, but exposes currency.
 */
export function formatMoney(minor: number, currency: string = "BDT", locale: string = "en-BD") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `৳${(minor / 100).toFixed(2)}`;
  }
}

export function Money({ minor, className = "" }: { minor: number; className?: string }) {
  return <span className={`text-mono-num ${className}`}>{formatMoney(minor)}</span>;
}
