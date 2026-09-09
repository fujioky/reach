import { describe, it, expect } from 'vitest';
import { formatTs } from '../format';

describe('formatTs', () => {
  it('renders a UTC instant as Asia/Shanghai wall time', () => {
    // 2026-08-13 04:00 UTC = 12:00 CST
    const d = new Date('2026-08-13T04:00:00.000Z');
    const label = formatTs(d);
    expect(label).toContain('12:00');
    expect(label).toMatch(/8月13日|8\/13/);
  });

  it('does not use the process local timezone', () => {
    const d = new Date('2026-08-13T16:30:00.000Z'); // 00:30 next day in CST
    const label = formatTs(d);
    expect(label).toContain('00:30');
    expect(label).toMatch(/8月14日|8\/14/);
  });
});
