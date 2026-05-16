import React, { useState, useEffect, useRef, useCallback } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  sources?: string[];
}

interface StandMeetChatProps {
  className?: string;
  placeholder?: string;
  title?: string;
  position?: 'inline' | 'bottom-right';
}

interface StandMeetConfig {
  gatewayUrl: string;
  inviteCode: string;
}

function getStandMeetConfig(): StandMeetConfig | null {
  if (typeof window === 'undefined') return null;
  const config = (window as unknown as Record<string, unknown>).__STANDMEET_CONFIG__ as Partial<StandMeetConfig> | undefined;
  if (!config?.gatewayUrl || !config?.inviteCode) return null;
  return config as StandMeetConfig;
}

function useWebSocketChat(getConfig: () => StandMeetConfig | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const config = getConfig();
    if (!config) return;

    const ws = new WebSocket(config.gatewayUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      const authMsg: Record<string, string> = {
        type: 'auth',
        invite_code: config.inviteCode,
      };
      if (sessionIdRef.current) {
        authMsg.session_id = sessionIdRef.current;
      }
      ws.send(JSON.stringify(authMsg));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWsMessage(data, setMessages, setIsConnected, setIsLoading, sessionIdRef);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [getConfig]);

  const sendMessage = useCallback((content: string) => {
    if (!content.trim() || !wsRef.current || !isConnected) return;
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsLoading(true);
    wsRef.current.send(JSON.stringify({ type: 'message', content }));
  }, [isConnected]);

  return { messages, isConnected, isLoading, sendMessage };
}

function handleWsMessage(
  data: Record<string, unknown>,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  sessionIdRef: React.MutableRefObject<string | null>,
) {
  switch (data.type) {
    case 'auth_ok':
      setIsConnected(true);
      sessionIdRef.current = data.session_id as string;
      if ((data.history as ChatMessage[] | undefined)?.length) {
        setMessages((data.history as ChatMessage[]).map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources,
        })));
      }
      if (data.greeting) {
        setMessages(prev => {
          if (prev.length === 0) {
            return [{ role: 'assistant', content: data.greeting as string }];
          }
          return prev;
        });
      }
      break;

    case 'text_delta':
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + (data.text as string) }];
        }
        return [...prev, { role: 'assistant', content: data.text as string, isStreaming: true }];
      });
      break;

    case 'message_done':
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), {
            role: 'assistant',
            content: data.content as string,
            isStreaming: false,
            sources: data.sources as string[] | undefined,
          }];
        }
        return [...prev, { role: 'assistant', content: data.content as string, sources: data.sources as string[] | undefined }];
      });
      setIsLoading(false);
      break;

    case 'error':
      setIsLoading(false);
      break;
  }
}

function MessageList({
  messages,
  isLoading,
  messagesEndRef,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
            msg.role === 'user'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}>
            {msg.content}
          </div>
        </div>
      ))}
      {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
        <div className="flex justify-start">
          <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-400">
            Thinking...
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatInputBar({
  input,
  setInput,
  onSend,
  isConnected,
  isLoading,
  placeholder,
}: {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  isConnected: boolean;
  isLoading: boolean;
  placeholder: string;
}) {
  return (
    <div className="border-t p-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSend()}
          placeholder={placeholder}
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={!isConnected}
        />
        <button
          onClick={onSend}
          disabled={!isConnected || !input.trim() || isLoading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-blue-700"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/**
 * StandMeetChat — embeddable chat widget.
 *
 * During SSG this renders a static placeholder. On the client it hydrates
 * and connects to the gateway WebSocket to provide live chat.
 *
 * The invite code and gateway URL are injected at build time via
 * __STANDMEET_CONFIG__ global.
 */
export function StandMeetChat({
  className,
  placeholder = 'Type a message...',
  title = 'Chat',
  position = 'inline',
}: StandMeetChatProps) {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(position === 'inline');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, isConnected, isLoading, sendMessage } = useWebSocketChat(getStandMeetConfig);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput('');
  }, [input, sendMessage]);

  const chatContent = (
    <div className={`flex flex-col ${position === 'bottom-right' ? 'h-96 w-80' : 'h-full'} ${className || ''}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
          <span className="font-medium text-sm">{title}</span>
          {position === 'bottom-right' && (
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          )}
        </div>
      )}
      <MessageList messages={messages} isLoading={isLoading} messagesEndRef={messagesEndRef} />
      <ChatInputBar
        input={input}
        setInput={setInput}
        onSend={handleSend}
        isConnected={isConnected}
        isLoading={isLoading}
        placeholder={placeholder}
      />
    </div>
  );

  // SSR placeholder
  if (typeof window === 'undefined') {
    return (
      <div className={className} data-standmeet-chat="true">
        <div className="flex items-center justify-center h-32 bg-gray-50 rounded-lg border">
          <span className="text-gray-400 text-sm">Chat loading...</span>
        </div>
      </div>
    );
  }

  if (position === 'bottom-right') {
    if (!isOpen) {
      return (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 bg-blue-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:bg-blue-700 z-50"
          data-standmeet-chat="true"
        >
          💬
        </button>
      );
    }

    return (
      <div className="fixed bottom-6 right-6 bg-white rounded-xl shadow-2xl border overflow-hidden z-50" data-standmeet-chat="true">
        {chatContent}
      </div>
    );
  }

  return <div data-standmeet-chat="true">{chatContent}</div>;
}
