// log —— the chat's console exit point. It runs in the app, in a microsite and on a third-party
// page, so it reads no build-time env: `process` does not exist in a microsite's browser bundle.
// Off unless the page opts in with localStorage `sm-debug=1`.

function on(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('sm-debug') === '1';
  } catch {
    return false;
  }
}

export const logger = {
  info: (msg: string, ...args: unknown[]): void => { if (on()) console.info(`[standmeet] ${msg}`, ...args); },
  warn: (msg: string, ...args: unknown[]): void => { if (on()) console.warn(`[standmeet] ${msg}`, ...args); },
  error: (msg: string, ...args: unknown[]): void => { if (on()) console.error(`[standmeet] ${msg}`, ...args); },
};
