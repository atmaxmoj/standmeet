"use client";

import { useState } from "react";

interface InviteInputProps {
  onSubmit: (code: string) => void;
  error?: string | null;
  isLoading?: boolean;
}

export function InviteInput({ onSubmit, error, isLoading }: InviteInputProps) {
  const [code, setCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() && !isLoading) {
      onSubmit(code.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "400px" }}>
      <label htmlFor="invite-code" style={{ fontSize: "14px", fontWeight: 500 }}>
        Enter your invite code
      </label>
      <input
        id="invite-code"
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="sm_xxxxx"
        disabled={isLoading}
        style={{
          padding: "10px 14px",
          border: `1px solid ${error ? "#e44" : "#ddd"}`,
          borderRadius: "8px",
          fontSize: "16px",
          fontFamily: "monospace",
        }}
      />
      {error && (
        <div className="invite-error">{error}</div>
      )}
      <button
        type="submit"
        disabled={!code.trim() || isLoading}
        style={{
          padding: "10px 20px",
          backgroundColor: !code.trim() || isLoading ? "#ccc" : "#000",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          fontSize: "14px",
          cursor: !code.trim() || isLoading ? "not-allowed" : "pointer",
        }}
      >
        {isLoading ? "Validating..." : "Continue"}
      </button>
    </form>
  );
}
