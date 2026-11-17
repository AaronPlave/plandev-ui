import { describe, expect, it } from 'vitest';
import { softBreakSegments } from './softBreaks';

describe('softBreakSegments', () => {
  it('never changes the text', () => {
    for (const text of [
      '/europa/sequences/2026-001/flyby-E12/banana_bite_morning_v12.seq.json',
      '2026-318T08:12:31Z',
      'MOON_ME_DE440_ALIGNED',
      '0.000123456789',
      '-0.40',
      'a',
    ]) {
      expect(softBreakSegments(text).join('')).toBe(text);
    }
  });

  it('breaks paths after / _ - and . extension separators', () => {
    expect(softBreakSegments('/europa/sequences/flyby-E12/banana_bite_v12.seq.json')).toEqual([
      '/',
      'europa/',
      'sequences/',
      'flyby-',
      'E12/',
      'banana_',
      'bite_',
      'v12.',
      'seq.',
      'json',
    ]);
  });

  it('breaks timestamps after the T only', () => {
    expect(softBreakSegments('2026-318T08:12:31Z')).toEqual(['2026-318T', '08:12:31Z']);
  });

  it('does not split numbers', () => {
    expect(softBreakSegments('0.000123456789')).toEqual(['0.000123456789']);
    expect(softBreakSegments('-12345.6789')).toEqual(['-12345.6789']);
  });
});
