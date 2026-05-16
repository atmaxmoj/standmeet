import React from 'react';

interface StandMeetReferencesProps {
  sources: string[];
  className?: string;
}

export function StandMeetReferences({ sources, className }: StandMeetReferencesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className || ''}`}>
      {sources.map((source, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded"
        >
          {source}
        </span>
      ))}
    </div>
  );
}
