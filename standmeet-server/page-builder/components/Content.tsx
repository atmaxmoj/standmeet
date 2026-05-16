import React from 'react';

// At build time, content data is injected via global __STANDMEET_DATA__
declare global {
  var __STANDMEET_DATA__: {
    content: Array<{ path: string; content: Record<string, unknown>; summary: string }>;
    assets: Record<string, string>;
  };
}

interface StandMeetContentProps {
  path: string;
  className?: string;
  renderField?: (key: string, value: unknown) => React.ReactNode;
}

export function StandMeetContent({ path, className, renderField }: StandMeetContentProps) {
  const data = typeof globalThis.__STANDMEET_DATA__ !== 'undefined'
    ? globalThis.__STANDMEET_DATA__
    : { content: [], assets: {} };

  const entry = data.content.find(c => c.path === path);
  if (!entry) {
    return <div className={className} data-standmeet-content={path}>Content not found: {path}</div>;
  }

  const content = entry.content;

  if (renderField) {
    return (
      <div className={className} data-standmeet-content={path}>
        {Object.entries(content).map(([key, value]) => (
          <React.Fragment key={key}>{renderField(key, value)}</React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className={className} data-standmeet-content={path}>
      {Object.entries(content).map(([key, value]) => (
        <div key={key} className="mb-2">
          <strong className="text-sm text-gray-500 uppercase">{key}</strong>
          <div>{typeof value === 'string' ? value : JSON.stringify(value)}</div>
        </div>
      ))}
    </div>
  );
}
