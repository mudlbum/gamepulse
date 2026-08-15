import type { Lang } from '../i18n/ui';

const BASE = import.meta.env.BASE_URL || '/';

/** Join a site-root-relative path onto the configured base path. */
export function href(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const base = BASE.endsWith('/') ? BASE : BASE + '/';
  return (base + clean).replace(/\/{2,}/g, '/');
}

/** Locale-aware href. English lives at the root, Korean under /ko/. */
export function localeHref(path: string, lang: Lang): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return lang === 'ko' ? href('ko/' + clean) : href(clean);
}

/** Absolute URL, for canonicals, OG tags and JSON-LD. */
export function absolute(path: string, site: URL | string | undefined): string {
  const origin = typeof site === 'string' ? site : site?.origin || '';
  return new URL(href(path), origin || 'https://example.com').toString();
}

/** Swap the locale on the current pathname, preserving the rest of the route. */
export function alternatePath(pathname: string, to: Lang): string {
  const base = BASE.endsWith('/') ? BASE : BASE + '/';
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  rest = rest.replace(/^ko\/?/, '');
  return to === 'ko' ? href('ko/' + rest) : href(rest);
}

export function formatNumber(n: number, lang: Lang = 'en'): string {
  return new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US').format(Math.round(n));
}

export function formatCompact(n: number, lang: Lang = 'en'): string {
  return new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatDate(d: Date | string, lang: Lang = 'en'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function relativeTime(iso: string, lang: Lang = 'en'): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((then - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { numeric: 'auto' });
  const abs = Math.abs(diffMin);
  if (abs < 60) return rtf.format(diffMin, 'minute');
  if (abs < 60 * 24) return rtf.format(Math.round(diffMin / 60), 'hour');
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(diffMin / 1440), 'day');
  return rtf.format(Math.round(diffMin / 43200), 'month');
}
