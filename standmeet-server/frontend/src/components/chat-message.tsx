"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { ChatMessage } from "@/lib/types";

interface ChatMessageProps {
  message: ChatMessage;
  onSourceClick?: (source: string) => void;
}

const VISIBLE_SOURCES = 3;

function SourceButtons({ sources, onSourceClick }: { sources: string[]; onSourceClick?: (source: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || sources.length <= VISIBLE_SOURCES;
  const visible = showAll ? sources : sources.slice(0, VISIBLE_SOURCES);
  const hiddenCount = sources.length - VISIBLE_SOURCES;

  return (
    <div className="chat-sources">
      {visible.map((source, i) => (
        <button
          key={i}
          className="chat-source-item"
          onClick={() => onSourceClick?.(source)}
          title={source}
        >
          <span className="chat-source-icon">📄</span>
          {source.replace(/^\//, "").split("/").pop() || source}
        </button>
      ))}
      {!showAll && (
        <button
          className="chat-source-item chat-source-more"
          onClick={() => setExpanded(true)}
        >
          +{hiddenCount} more
        </button>
      )}
    </div>
  );
}

export function ChatMessageBubble({ message, onSourceClick }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`chat-msg ${isUser ? "chat-msg-user" : "chat-msg-assistant"}`}>
      <div className={`chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-assistant"}`}>
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeKatex]}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
      {!isUser && message.sources && message.sources.length > 0 && (
        <SourceButtons sources={message.sources} onSourceClick={onSourceClick} />
      )}
    </div>
  );
}
