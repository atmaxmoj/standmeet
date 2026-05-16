"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getGatewayUrl } from "@/lib/api-client";
import { exportReportPdf } from "@/lib/export-pdf";
import type { ChatMessage } from "@/lib/types";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type ToolStatus = { tool: string; status: "start" | "done" } | null;

export type ViewingContent = {
  path: string;
  title: string;
  content: string;
  contentType: string;
} | null;

interface UseChatOptions {
  inviteCode: string;
  sessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
}

type ChatStateSetter = {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setToolStatus: React.Dispatch<React.SetStateAction<ToolStatus>>;
  setViewingContent: React.Dispatch<React.SetStateAction<ViewingContent>>;
  setContentLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setCanGenerateReport: React.Dispatch<React.SetStateAction<boolean>>;
  setIsGeneratingReport: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSessionEnded: React.Dispatch<React.SetStateAction<boolean>>;
  setMessageLimit: React.Dispatch<React.SetStateAction<number | null>>;
  setMessageCount: React.Dispatch<React.SetStateAction<number>>;
};

function handleAuthOk(
  msg: Record<string, unknown>,
  setters: Pick<ChatStateSetter, "setConnectionStatus" | "setMessages" | "setCanGenerateReport" | "setIsSessionEnded" | "setMessageLimit" | "setMessageCount">,
  onSessionCreatedRef: React.RefObject<((sessionId: string) => void) | undefined>,
) {
  setters.setConnectionStatus("connected");
  if (msg.history && Array.isArray(msg.history) && (msg.history as unknown[]).length > 0) {
    setters.setMessages((msg.history as Array<{ role: string; content: string; sources?: string[] }>).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: m.sources,
    })));
  }
  if ((msg.capabilities as Record<string, unknown>)?.canGenerateReport) {
    setters.setCanGenerateReport(true);
  }
  if (msg.sessionEnded) {
    setters.setIsSessionEnded(true);
  }
  if (msg.messageLimit != null) {
    setters.setMessageLimit(msg.messageLimit as number);
  }
  if (msg.messageCount != null) {
    setters.setMessageCount(msg.messageCount as number);
  }
  if (msg.session_id) {
    onSessionCreatedRef.current?.(msg.session_id as string);
  }
}

function handleTextDelta(
  msg: Record<string, unknown>,
  streamingTextRef: React.RefObject<string>,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  streamingTextRef.current += msg.text as string;
  const currentText = streamingTextRef.current;
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last && last.role === "assistant" && last.isStreaming) {
      return [...prev.slice(0, -1), { ...last, content: currentText }];
    }
    return [...prev, { role: "assistant", content: currentText, isStreaming: true }];
  });
}

function handleMessageDone(
  msg: Record<string, unknown>,
  streamingTextRef: React.RefObject<string>,
  setters: Pick<ChatStateSetter, "setMessages" | "setIsLoading" | "setToolStatus">,
) {
  streamingTextRef.current = "";
  const sources = msg.sources as string[] | undefined;
  setters.setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last && last.role === "assistant" && last.isStreaming) {
      return [...prev.slice(0, -1), { role: "assistant", content: msg.content as string, sources }];
    }
    return [...prev, { role: "assistant", content: msg.content as string, sources }];
  });
  setters.setIsLoading(false);
  setters.setToolStatus(null);
}

function handleWsMessage(
  msg: Record<string, unknown>,
  streamingTextRef: React.RefObject<string>,
  setters: ChatStateSetter,
  onSessionCreatedRef: React.RefObject<((sessionId: string) => void) | undefined>,
) {
  switch (msg.type) {
    case "auth_ok":
      handleAuthOk(msg, setters, onSessionCreatedRef);
      break;
    case "auth_error":
      setters.setConnectionStatus("error");
      setters.setError(msg.error as string);
      break;
    case "text_delta":
      handleTextDelta(msg, streamingTextRef, setters.setMessages);
      break;
    case "tool_use":
      setters.setToolStatus({ tool: msg.tool as string, status: msg.status as "start" | "done" });
      break;
    case "message_done":
      handleMessageDone(msg, streamingTextRef, setters);
      break;
    case "content_data":
      setters.setViewingContent({
        path: msg.path as string,
        title: msg.title as string,
        content: msg.content as string,
        contentType: msg.content_type as string,
      });
      setters.setContentLoading(false);
      break;
    case "content_error":
      setters.setContentLoading(false);
      break;
    case "report_generating":
      setters.setIsGeneratingReport(true);
      break;
    case "report_ready":
      setters.setIsGeneratingReport(false);
      exportReportPdf((msg as Record<string, unknown>).summary as string).catch(() => {
        setters.setError("Failed to generate PDF");
      });
      break;
    case "session_ended":
      setters.setIsSessionEnded(true);
      break;
    case "report_error":
      setters.setIsGeneratingReport(false);
      setters.setError(msg.message as string);
      break;
    case "error":
      setters.setError(msg.error as string);
      setters.setIsLoading(false);
      setters.setToolStatus(null);
      break;
  }
}

function useWebSocketConnection(
  inviteCode: string,
  sessionId: string | undefined,
  streamingTextRef: React.RefObject<string>,
  setters: ChatStateSetter,
  onSessionCreatedRef: React.RefObject<((sessionId: string) => void) | undefined>,
): React.RefObject<WebSocket | null> {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ws = new WebSocket(getGatewayUrl());
    wsRef.current = ws;
    setters.setConnectionStatus("connecting");
    setters.setError(null);

    ws.onopen = () => {
      if (cancelled) return;
      const authMsg: Record<string, unknown> = { type: "auth", invite_code: inviteCode };
      if (sessionId) {
        authMsg.session_id = sessionId;
      }
      ws.send(JSON.stringify(authMsg));
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      const msg = JSON.parse(event.data);
      handleWsMessage(msg, streamingTextRef, setters, onSessionCreatedRef);
    };

    ws.onclose = () => {
      if (cancelled) return;
      setters.setConnectionStatus("disconnected");
    };

    ws.onerror = () => {
      if (cancelled) return;
      setters.setConnectionStatus("error");
      setters.setError("Connection failed");
    };

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [inviteCode, sessionId]);

  return wsRef;
}

function useChatActions(
  wsRef: React.RefObject<WebSocket | null>,
  streamingTextRef: React.RefObject<string>,
  isLoading: boolean,
  isGeneratingReport: boolean,
  isSessionEnded: boolean,
  setters: Pick<ChatStateSetter, "setMessages" | "setMessageCount" | "setIsLoading" | "setError" | "setToolStatus" | "setContentLoading" | "setIsGeneratingReport" | "setViewingContent">,
) {
  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim() || isLoading) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setters.setError("Not connected");
        return;
      }
      const userMessage: ChatMessage = { role: "user", content };
      setters.setMessages((prev) => [...prev, userMessage]);
      setters.setMessageCount((c) => c + 1);
      setters.setIsLoading(true);
      setters.setError(null);
      streamingTextRef.current = "";
      wsRef.current.send(JSON.stringify({ type: "message", content }));
    },
    [isLoading, wsRef, streamingTextRef, setters],
  );

  const cancel = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
    setters.setIsLoading(false);
    setters.setToolStatus(null);
  }, [wsRef, setters]);

  const fetchContent = useCallback((path: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setters.setContentLoading(true);
    wsRef.current.send(JSON.stringify({ type: "fetch_content", path }));
  }, [wsRef, setters]);

  const generateReport = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isGeneratingReport || isSessionEnded) return;
    setters.setIsGeneratingReport(true);
    wsRef.current.send(JSON.stringify({ type: "generate_report" }));
  }, [wsRef, isGeneratingReport, isSessionEnded, setters]);

  const closeContentViewer = useCallback(() => {
    setters.setViewingContent(null);
  }, [setters]);

  const clearMessages = useCallback(() => {
    setters.setMessages([]);
    setters.setError(null);
  }, [setters]);

  return { sendMessage, cancel, fetchContent, generateReport, closeContentViewer, clearMessages };
}

export function useChat({ inviteCode, sessionId, onSessionCreated }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [toolStatus, setToolStatus] = useState<ToolStatus>(null);
  const [viewingContent, setViewingContent] = useState<ViewingContent>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [canGenerateReport, setCanGenerateReport] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isSessionEnded, setIsSessionEnded] = useState(false);
  const [messageLimit, setMessageLimit] = useState<number | null>(null);
  const [messageCount, setMessageCount] = useState(0);

  const streamingTextRef = useRef("");
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;

  const setters: ChatStateSetter = {
    setMessages, setIsLoading, setError, setConnectionStatus,
    setToolStatus, setViewingContent, setContentLoading,
    setCanGenerateReport, setIsGeneratingReport, setIsSessionEnded,
    setMessageLimit, setMessageCount,
  };

  const wsRef = useWebSocketConnection(
    inviteCode, sessionId, streamingTextRef, setters, onSessionCreatedRef,
  );

  const actions = useChatActions(
    wsRef, streamingTextRef, isLoading, isGeneratingReport, isSessionEnded, setters,
  );

  return {
    messages, isLoading, error, connectionStatus, toolStatus,
    viewingContent, contentLoading, canGenerateReport, isGeneratingReport,
    isSessionEnded, messageLimit, messageCount,
    ...actions,
  };
}
