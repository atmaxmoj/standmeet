// APIError —— a frontend error carrying an HTTP status + machine code, thrown by
// adminAPI when a response is non-2xx (the frontend mirror of the backend envelope
// {error:{code,message}}). Carrying status is what lets callers branch by business
// meaning: session expired (401) → login redirect, conflict (409) → inline form
// notice, everything else → toast. With only message, the caller has no way to
// tell how to display it back.
export class APIError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
  }
}
