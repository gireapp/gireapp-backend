import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

// Silences the structured logger's console writes for the failure paths below.
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), security: vi.fn() },
}));

const VALID_KEY = 're_abcdefghijklmnopqrstuvwxyz012345';

/**
 * The service caches its Resend client and reads the key at first send, so each
 * case needs a fresh module registry to pick up its own env.
 */
async function loadService(apiKey: string | undefined) {
  vi.resetModules();
  if (apiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = apiKey;
  return import('../email');
}

describe('sendVerificationEmail', () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    sendMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  /** Retries sleep between attempts, so timers have to advance alongside the await. */
  async function runWithTimers<T>(work: Promise<T>): Promise<T> {
    const settled = work.catch((error: unknown) => ({ __error: error }) as never);
    await vi.runAllTimersAsync();
    const outcome = (await settled) as { __error?: unknown };
    if (outcome && typeof outcome === 'object' && '__error' in outcome) {
      throw outcome.__error;
    }
    return outcome as T;
  }

  it('resolves when Resend accepts the message', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { sendVerificationEmail } = await loadService(VALID_KEY);

    await expect(runWithTimers(sendVerificationEmail('a@b.com', 'Ada', 'tok'))).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a placeholder API key before contacting Resend', async () => {
    const { sendVerificationEmail } = await loadService('re_xxxxxxxxxx');

    await expect(sendVerificationEmail('a@b.com', 'Ada', 'tok')).rejects.toThrow(/placeholder/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a missing API key', async () => {
    const { sendVerificationEmail } = await loadService(undefined);

    await expect(sendVerificationEmail('a@b.com', 'Ada', 'tok')).rejects.toThrow(
      /RESEND_API_KEY not configured/
    );
  });

  // The bug this guards: a rejected send used to resolve `false`, so the
  // fire-and-forget `.catch(log)` at every call site never ran and the backend
  // looked healthy while no mail was arriving.
  it('throws rather than resolving when Resend rejects the message', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'invalid_api_Key', message: 'API key is invalid' },
    });
    const { sendVerificationEmail, EmailDeliveryError } = await loadService(VALID_KEY);

    await expect(runWithTimers(sendVerificationEmail('a@b.com', 'Ada', 'tok'))).rejects.toBeInstanceOf(
      EmailDeliveryError
    );
  });

  it('does not retry a permanent error such as an unverified From domain', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'invalid_from_address', message: 'Domain is not verified' },
    });
    const { sendVerificationEmail } = await loadService(VALID_KEY);

    await expect(runWithTimers(sendVerificationEmail('a@b.com', 'Ada', 'tok'))).rejects.toThrow(
      /Domain is not verified/
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error up to three attempts before giving up', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'internal_server_error', message: 'upstream blew up' },
    });
    const { sendVerificationEmail } = await loadService(VALID_KEY);

    await expect(runWithTimers(sendVerificationEmail('a@b.com', 'Ada', 'tok'))).rejects.toThrow(
      /upstream blew up/
    );
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('succeeds if a retry lands after a transient failure', async () => {
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'slow down' },
      })
      .mockResolvedValueOnce({ data: { id: 'msg_2' }, error: null });
    const { sendVerificationEmail } = await loadService(VALID_KEY);

    await expect(runWithTimers(sendVerificationEmail('a@b.com', 'Ada', 'tok'))).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('escapes a name that would otherwise inject markup into the email body', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_3' }, error: null });
    const { sendVerificationEmail } = await loadService(VALID_KEY);

    await runWithTimers(sendVerificationEmail('a@b.com', '<script>alert(1)</script>', 'tok'));

    const { html } = sendMock.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
