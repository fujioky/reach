import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
  shares: { token: 'shares.token', id: 'shares.id', status: 'shares.status', burnAfterRead: 'shares.burnAfterRead' },
  shareVisits: {
    shareId: 'share_visits.shareId',
    visitorCookie: 'share_visits.visitorCookie',
    visitorIp: 'share_visits.visitorIp',
  },
}));

import { db } from '@/lib/db';
import { checkShareMediaAccess, parseVisitorFromRequest } from '@/lib/access/share-media';

const mockedSelect = vi.mocked(db.select);

function mockShareQuery(share: object | undefined) {
  mockedSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () => (share ? [share] : []),
      }),
    }),
  } as never);
}

function mockVisitQuery(found: boolean) {
  mockedSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () => (found ? [{ shareId: 'share-1' }] : []),
      }),
    }),
  } as never);
}

describe('checkShareMediaAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows active shares', async () => {
    mockShareQuery({ id: 'share-1', status: 'active', burnAfterRead: false });
    const result = await checkShareMediaAccess('tok', 'cookie', '1.2.3.4');
    expect(result).toEqual({
      allowed: true,
      share: { id: 'share-1', status: 'active', burnAfterRead: false },
    });
  });

  it('allows burned burn-after-read shares for returning visitors', async () => {
    mockShareQuery({ id: 'share-1', status: 'burned', burnAfterRead: true });
    mockVisitQuery(true);
    const result = await checkShareMediaAccess('tok', 'cookie', '1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('blocks burned burn-after-read shares for new visitors', async () => {
    mockShareQuery({ id: 'share-1', status: 'burned', burnAfterRead: true });
    mockVisitQuery(false);
    const result = await checkShareMediaAccess('tok', 'cookie', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'forbidden' });
  });
});

describe('parseVisitorFromRequest', () => {
  it('reads visitor_id cookie and x-forwarded-for', () => {
    const req = new Request('http://localhost/api/video-status', {
      headers: {
        cookie: 'visitor_id=abc123; other=x',
        'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      },
    });
    expect(parseVisitorFromRequest(req)).toEqual({ cookie: 'abc123', ip: '10.0.0.1' });
  });
});