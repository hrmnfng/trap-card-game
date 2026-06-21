import { describe, it, expect, vi } from 'vitest';
import { sendExpoPush } from '../src/push.js';

describe('sendExpoPush', () => {
  it('no-ops successfully with no tokens', async () => {
    const fetchImpl = vi.fn();
    const res = await sendExpoPush([], { title: 't', body: 'b' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ sent: 0, ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts one message per token to the Expo endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const tokens = ['ExpoPushToken[a]', 'ExpoPushToken[b]'];
    const res = await sendExpoPush(
      tokens,
      { title: 'Hello', body: 'World', data: { kind: 'card_played' } },
      { url: 'https://example.test/push', fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(res).toEqual({ sent: 2, ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.test/push');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ to: 'ExpoPushToken[a]', title: 'Hello', body: 'World' });
    expect(body[0].data).toMatchObject({ kind: 'card_played' });
  });

  it('reports ok=false when the endpoint errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    const res = await sendExpoPush(['t'], { title: 't', body: 'b' }, {
      url: 'https://example.test/push',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });
});
