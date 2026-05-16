import React from 'react';

interface StandMeetContentListProps {
  prefix: string;
  className?: string;
  renderItem?: (item: { path: string; content: Record<string, unknown>; summary: string }) => React.ReactNode;
}

export function StandMeetContentList({ prefix, className, renderItem }: StandMeetContentListProps) {
  const data = typeof globalThis.__STANDMEET_DATA__ !== 'undefined'
    ? globalThis.__STANDMEET_DATA__
    : { content: [], assets: {} };

  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
  const items = data.content.filter(c => c.path.startsWith(normalizedPrefix));

  if (items.length === 0) {
    return <div className={className}>No content found under {prefix}</div>;
  }

  if (renderItem) {
    return (
      <div className={className}>
        {items.map(item => (
          <React.Fragment key={item.path}>{renderItem(item)}</React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {items.map(item => (
        <div key={item.path} className="mb-4 p-4 border rounded">
          <h3 className="font-semibold">{item.path}</h3>
          {item.summary && <p className="text-gray-600 text-sm">{item.summary}</p>}
        </div>
      ))}
    </div>
  );
}
