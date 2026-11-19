/**
 * Exactly one tab plays at a time: two loops writing one save would overwrite each other.
 * Web Locks is the mechanism; where it is missing, a BroadcastChannel handshake does the same job.
 */
export interface TabLock {
  /** Takes the lock if nobody holds it. `onLost` runs if another tab takes it over later. */
  acquire(onLost: () => void): Promise<boolean>;
  /** Takes the lock from whoever holds it. */
  takeOver(onLost: () => void): Promise<void>;
  release(): void;
}

export const LOCK_NAME = 'shinobi-idle-game';

/** The part of `LockManager` that is used. */
export interface LockApi {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: object | null) => Promise<void> | void,
  ): Promise<unknown>;
}

export function webLock(locks: LockApi, name = LOCK_NAME): TabLock {
  let release: (() => void) | null = null;

  const hold = (options: { ifAvailable?: boolean; steal?: boolean }, onLost: () => void) =>
    new Promise<boolean>((resolve) => {
      locks
        .request(name, options, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          return new Promise<void>((done) => {
            release = done;
          });
        })
        // A stolen lock makes the request of the old holder reject.
        .catch(() => {
          release = null;
          onLost();
        });
    });

  return {
    acquire: (onLost) => hold({ ifAvailable: true }, onLost),
    takeOver: async (onLost) => {
      await hold({ steal: true }, onLost);
    },
    release: () => release?.(),
  };
}

/** The part of `BroadcastChannel` that is used. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

type Message = { type: 'ping' | 'alive' | 'claim'; from: string };

/** Fallback without Web Locks: ask who is out there, and tell the others when taking over. */
export function channelLock(
  open: (name: string) => ChannelLike,
  wait: (ms: number) => Promise<void>,
  name = LOCK_NAME,
): TabLock {
  const me = Math.random().toString(36).slice(2);
  let channel: ChannelLike | null = null;
  let owner = false;
  let lost: () => void = () => {};
  let answered = false;

  const send = (type: Message['type']) => channel?.postMessage({ type, from: me });
  const connect = () => {
    if (channel) return;
    channel = open(name);
    channel.addEventListener('message', (event) => {
      const msg = event.data as Message;
      if (!msg || msg.from === me) return;
      if (msg.type === 'alive') answered = true;
      else if (msg.type === 'ping' && owner) send('alive');
      else if (msg.type === 'claim' && owner) {
        owner = false;
        lost();
      }
    });
  };

  return {
    acquire: async (onLost) => {
      connect();
      answered = false;
      send('ping');
      await wait(300);
      if (answered) return false;
      owner = true;
      lost = onLost;
      return true;
    },
    takeOver: async (onLost) => {
      connect();
      send('claim');
      owner = true;
      lost = onLost;
    },
    release: () => {
      owner = false;
      channel?.close();
      channel = null;
    },
  };
}

/** The lock for this browser: Web Locks if present, else the channel handshake, else none. */
export function createTabLock(): TabLock | null {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return webLock(navigator.locks as unknown as LockApi);
  }
  if (typeof BroadcastChannel !== 'undefined') {
    return channelLock(
      (name) => new BroadcastChannel(name),
      (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    );
  }
  return null;
}
