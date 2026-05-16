"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useChat } from "@/hooks/use-chat";
import type { ChatMessage } from "@/lib/types";
import { ChatMessageBubble } from "./chat-message";
import { ContentViewer } from "./content-viewer";

interface ChatBoxProps {
  inviteCode: string;
  sessionId?: string;
  onBack: () => void;
}

function friendlyToolStatus(tool: string): string {
  if (tool.includes("list") || tool.includes("search")) return "Looking things up";
  if (tool.includes("read")) return "Reading";
  return "Working";
}

function friendlyError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("connection failed"))
    return "Couldn't connect to the server. Please try again later.";
  if (lower.includes("not connected"))
    return "Connection lost. Please go back and try again.";
  if (lower.includes("auth") || lower.includes("invite"))
    return "This invite code is invalid or expired.";
  if (lower.includes("limit"))
    return "You've reached the message limit for this session.";
  if (lower.includes("ended"))
    return "This conversation has ended.";
  return "Something went wrong. Please try again later.";
}

function ChatHeader({
  connectionStatus,
  messageLimit,
  messageCount,
  canGenerateReport,
  hasMessages,
  isLoading,
  isGeneratingReport,
  isSessionEnded,
  onBack,
  onDownload,
}: {
  connectionStatus: string;
  messageLimit: number | null;
  messageCount: number;
  canGenerateReport: boolean;
  hasMessages: boolean;
  isLoading: boolean;
  isGeneratingReport: boolean;
  isSessionEnded: boolean;
  onBack: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="chat-header">
      <button className="chat-back-btn" onClick={onBack}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div className="chat-header-right">
        {messageLimit != null && (
          <span className="chat-message-count">
            {messageCount}/{messageLimit}
          </span>
        )}
        {canGenerateReport && hasMessages && !isLoading && !isSessionEnded && (
          <button
            className="chat-report-btn"
            onClick={onDownload}
            disabled={isGeneratingReport}
          >
            {isGeneratingReport ? (
              <span className="chat-export-spinner" />
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path d="M10 3V13M10 13L6 9M10 13L14 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 15V16C3 16.6 3.4 17 4 17H16C16.6 17 17 16.6 17 16V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download Summary
              </>
            )}
          </button>
        )}
        <div className={`chat-status-dot ${connectionStatus}`} />
      </div>
    </div>
  );
}

function ReportConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-title">Download Summary</p>
        <p className="confirm-message">
          This will end the conversation and download a summary PDF. Continue?
        </p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-ok" onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessageArea({
  messages,
  error,
  toolStatus,
  isLoading,
  isSessionEnded,
  isLimitReached,
  connectionStatus,
  messagesRef,
  fetchContent,
}: {
  messages: ChatMessage[];
  error: string | null;
  toolStatus: { tool: string; status: "start" | "done" } | null;
  isLoading: boolean;
  isSessionEnded: boolean;
  isLimitReached: boolean;
  connectionStatus: string;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  fetchContent: (source: string) => void;
}) {
  return (
    <div className="chat-messages" ref={messagesRef}>
      {messages.length === 0 && !error && (
        <div className="chat-empty">
          {isSessionEnded || isLimitReached ? (
            <p className="chat-empty-text">This conversation has ended.</p>
          ) : (
            <>
              <p className="chat-empty-emoji">👋</p>
              <p className="chat-empty-text">
                {connectionStatus === "connecting"
                  ? "Connecting..."
                  : connectionStatus === "connected"
                    ? "Hi! Ask me anything."
                    : ""}
              </p>
            </>
          )}
        </div>
      )}
      {messages.map((msg, i) => (
        <ChatMessageBubble
          key={i}
          message={msg}
          onSourceClick={(source) => { fetchContent(source); }}
        />
      ))}
      {toolStatus && (
        <div className="chat-tool-status">
          <span className="chat-tool-dot" />
          {toolStatus.status === "start"
            ? `${friendlyToolStatus(toolStatus.tool)}...`
            : "Done"}
        </div>
      )}
      {isLoading && !toolStatus && (
        <div className="chat-thinking">
          <span className="chat-thinking-dots">
            <span /><span /><span />
          </span>
        </div>
      )}
      {error && (
        <div className="chat-error">{friendlyError(error)}</div>
      )}
    </div>
  );
}

function ChatInputBar({
  input,
  isSessionEnded,
  isLimitReached,
  isConnected,
  isLoading,
  messageLimit,
  onInputChange,
  onSubmit,
  onCancel,
}: {
  input: string;
  isSessionEnded: boolean;
  isLimitReached: boolean;
  isConnected: boolean;
  isLoading: boolean;
  messageLimit: number | null;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="chat-input-bar" onSubmit={onSubmit}>
      <input
        className="chat-input"
        type="text"
        value={isSessionEnded || isLimitReached ? "" : input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={
          isSessionEnded
            ? "Conversation ended"
            : isLimitReached
              ? `Message limit reached (${messageLimit})`
              : "Ask a question..."
        }
        disabled={isSessionEnded || isLimitReached || !isConnected || isLoading}
      />
      {!isSessionEnded && !isLimitReached && (
        isLoading ? (
          <button type="button" className="chat-cancel-btn" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="chat-send-btn"
            disabled={!input.trim() || !isConnected}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M3 10L17 3L10 17L9 11L3 10Z" fill="currentColor"/>
            </svg>
          </button>
        )
      )}
    </form>
  );
}

export function ChatBox({ inviteCode, sessionId, onBack }: ChatBoxProps) {
  const onSessionCreated = useCallback((sid: string) => {
    const newUrl = `/i/${encodeURIComponent(inviteCode)}/${encodeURIComponent(sid)}`;
    window.history.replaceState(null, "", newUrl);
  }, [inviteCode]);

  const {
    messages, isLoading, error, connectionStatus, toolStatus,
    viewingContent, canGenerateReport, isGeneratingReport,
    isSessionEnded, messageLimit, messageCount,
    sendMessage, cancel, fetchContent, closeContentViewer, generateReport,
  } = useChat({ inviteCode, sessionId, onSessionCreated });

  const [input, setInput] = useState("");
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
      setInput("");
    }
  };

  const isConnected = connectionStatus === "connected";
  const isLimitReached = messageLimit != null && messageCount >= messageLimit;

  return (
    <div className="chat-container">
      <ChatHeader
        connectionStatus={connectionStatus}
        messageLimit={messageLimit}
        messageCount={messageCount}
        canGenerateReport={canGenerateReport}
        hasMessages={messages.length > 0}
        isLoading={isLoading}
        isGeneratingReport={isGeneratingReport}
        isSessionEnded={isSessionEnded}
        onBack={onBack}
        onDownload={() => setShowReportConfirm(true)}
      />
      <ChatMessageArea
        messages={messages}
        error={error}
        toolStatus={toolStatus}
        isLoading={isLoading}
        isSessionEnded={isSessionEnded}
        isLimitReached={isLimitReached}
        connectionStatus={connectionStatus}
        messagesRef={messagesRef}
        fetchContent={fetchContent}
      />
      <ChatInputBar
        input={input}
        isSessionEnded={isSessionEnded}
        isLimitReached={isLimitReached}
        isConnected={isConnected}
        isLoading={isLoading}
        messageLimit={messageLimit}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        onCancel={cancel}
      />
      <ContentViewer content={viewingContent} onClose={closeContentViewer} />
      {showReportConfirm && (
        <ReportConfirmModal
          onCancel={() => setShowReportConfirm(false)}
          onConfirm={() => {
            setShowReportConfirm(false);
            generateReport();
          }}
        />
      )}
    </div>
  );
}
