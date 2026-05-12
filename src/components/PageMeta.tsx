/**
 * PageMeta — per-page <head> management via react-helmet-async.
 *
 * Each page passes a unique `title` and `description` so that crawlers
 * (and browser tabs) show distinct metadata. Protected pages include a
 * `noindex` robots directive since they require authentication.
 */

import { Helmet } from 'react-helmet-async';

interface PageMetaProps {
  title: string;
  description: string;
  /** Set true for authenticated-only pages to prevent indexing. */
  noIndex?: boolean;
  /** Override the canonical URL path (defaults to current location). */
  canonicalPath?: string;
}

const BASE_URL = 'https://altmove.in';

export default function PageMeta({
  title,
  description,
  noIndex = false,
  canonicalPath,
}: PageMetaProps) {
  const fullTitle =
    title === 'altmove'
      ? 'altmove — Learn Chess from Every Move You Play'
      : `${title} | altmove`;

  const canonical = canonicalPath
    ? `${BASE_URL}${canonicalPath}`
    : undefined;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}
      {canonical && <link rel="canonical" href={canonical} />}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
