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

/**
 * Microsoft returns Secure Score remediation guidance as an HTML fragment. Rendering it
 * as-is puts raw markup in front of a customer; rendering it as HTML would inject a
 * third party's markup into the page. Neither is worth it for what is, in the end,
 * a paragraph of instructions — so reduce it to readable text and keep the anchors'
 * words while dropping their tags. The control's actionUrl is shown separately as the
 * one real link.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return (
    html
      // List items become bullets before the tags go, so the structure survives.
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|ol|ul|li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&rsquo;/gi, '\u2019')
      .replace(/&ldquo;/gi, '\u201c')
      .replace(/&rdquo;/gi, '\u201d')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
  );
}
