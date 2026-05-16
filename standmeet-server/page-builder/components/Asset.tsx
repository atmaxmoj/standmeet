import React from 'react';

interface StandMeetAssetProps {
  path: string;
  alt?: string;
  className?: string;
  width?: number | string;
  height?: number | string;
}

export function StandMeetAsset({ path, alt, className, width, height }: StandMeetAssetProps) {
  const data = typeof globalThis.__STANDMEET_DATA__ !== 'undefined'
    ? globalThis.__STANDMEET_DATA__
    : { content: [], assets: {} };

  const url = data.assets[path];
  if (!url) {
    return <div className={className} data-standmeet-asset={path}>Asset not found: {path}</div>;
  }

  return (
    <img
      src={url}
      alt={alt || path}
      className={className}
      width={width}
      height={height}
      data-standmeet-asset={path}
    />
  );
}
