import { describe, expect, it } from 'vitest';
import { channelLock, webLock, type ChannelLike, type LockApi } from '../src/lib/tab-lock.ts';

/** A minimal Web Locks: one holder, `ifAvailable` and `steal`; a stolen holder's request rejects. */
function fakeLocks(): LockApi {
  let holder: { done: () => void; fail: (e: Error) => void } | null = null;
  return {
    request(_name, options, callback) {
      if (options.ifAvailable && holder) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        if (options.steal && holder) {
          holder.fail(new DOMException('stolen', 'AbortError'));
          holder = null;
        }
        const run = callback({});
        const mine = {
          done: () => {
            if (holder === mine) holder = null;
            resolve(undefined);
          },
          fail: reject,
        };
        holder = mine;
        Promise.resolve(run).then(mine.done, reject);
      });
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('web lock', () => {
  it('lets one tab in and turns the second away', async () => {
    const locks = fakeLocks();
    const a = webLock(locks);
    const b = webLock(locks);
    expect(await a.acquire(() => {})).toBe(true);
    expect(await b.acquire(() => {})).toBe(false);
  });

  it('a takeover stops the old holder', async () => {
    const locks = fakeLocks();
    let lostA = 0;
    const a = webLock(locks);
    const b = webLock(locks);
    await a.acquire(() => lostA++);
    await b.takeOver(() => {});
    await tick();
    expect(lostA).toBe(1);
    expect(await webLock(locks).acquire(() => {})).toBe(false);
  });

  it('release frees the lock for the next tab', async () => {
    const locks = fakeLocks();
    const a = webLock(locks);
    await a.acquire(() => {});
    a.release();
    await tick();
    expect(await webLock(locks).acquire(() => {})).toBe(true);
  });
});

/** Channels that deliver every message to the other channels of the same name. */
function fakeChannels() {
  const open: Set<ChannelLike & { deliver: (m: unknown) => void }> = new Set();
  return (): ChannelLike => {
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const channel = {
      postMessage(message: unknown) {
        for (const other of open) if (other !== channel) other.deliver(message);
      },
      addEventListener(_type: 'message', listener: (e: { data: unknown }) => void) {
        listeners.push(listener);
      },
      close() {
        open.delete(channel);
      },
      deliver(data: unknown) {
        for (const l of listeners) l({ data });
      },
    };
    open.add(channel);
    return channel;
  };
}

describe('channel lock fallback', () => {
  it('the first tab plays, the second is told to wait, a takeover moves the game', async () => {
    const make = fakeChannels();
    const wait = () => Promise.resolve();
    let lostA = 0;
    const a = channelLock(make, wait);
    const b = channelLock(make, wait);
    expect(await a.acquire(() => lostA++)).toBe(true);
    expect(await b.acquire(() => {})).toBe(false);
    await b.takeOver(() => {});
    expect(lostA).toBe(1);
  });
});
