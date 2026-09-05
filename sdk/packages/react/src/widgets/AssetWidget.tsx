// AssetWidget —— embed one pool asset (an image the owner uploaded, or a downloadable file) in a
// microsite by its id. Drop-in: `<AssetWidget asset="standmeet-asset:<uuid>" alt="…" />` for an
// image, or add `download="file.pdf"` for a download link.
//
// The `asset` prop carries the full `standmeet-asset:<uuid>` token on purpose: the backend scans a
// microsite's built source for exactly that token to recompute which pool assets the page uses, so
// the delete guard protects an asset while a live page embeds it. The asset is served same-origin
// at /api/v1/assets/<id>, which 302-redirects to the (presigned) blob — no key handling on the page.

'use client';

import React from 'react';

const SCHEME = 'standmeet-asset:';

export interface AssetWidgetProps {
  readonly asset: string;
  readonly alt?: string;
  readonly className?: string;
  // download —— render a download link (a PDF/file) instead of an <img>; the value is the
  // suggested filename.
  readonly download?: string;
}

export function AssetWidget(props: AssetWidgetProps): React.ReactElement | null {
  const id = props.asset.startsWith(SCHEME) ? props.asset.slice(SCHEME.length) : props.asset;
  if (id === '') return null;
  const src = `/api/v1/assets/${id}`;
  const testid = `asset-widget-${id}`;
  return props.download !== undefined
    ? (
      <a href={src} download={props.download} data-testid={testid} className={props.className}>
        {props.alt ?? props.download}
      </a>
    )
    : (
      <img src={src} alt={props.alt ?? ''} data-testid={testid} className={props.className} />
    );
}
