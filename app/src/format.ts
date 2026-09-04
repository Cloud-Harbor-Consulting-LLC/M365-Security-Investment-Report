/**
 * Display formatting. Mirrors Format-CHSICurrency / Format-CHSIPercent.
 *
 * The rule that matters: a null figure renders as "n/a", never as zero. Zero is a claim
 * about the tenant; null means we could not establish it.
 */

const SYMBOLS: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', EUR: '€', GBP: '£' };

export function money(value: number | null | undefined, currency = 'USD', decimals = 0): string {
  if (value === null || value === undefined) return 'n/a';
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
}

export function percent(ratio: number | null | undefined, decimals = 0): string {
  if (ratio === null || ratio === undefined) return 'n/a';
  return `${(ratio * 100).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

export function count(value: number): string {
  return value.toLocaleString('en-US');
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
