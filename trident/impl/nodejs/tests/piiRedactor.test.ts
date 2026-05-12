import { describe, it, expect } from 'vitest';
import { piiRedact } from '../src/ai/piiRedactor.js';

describe('piiRedactor', () => {
  it('redacts email addresses', () => {
    expect(piiRedact('Contact fb@example.com for details')).toBe('Contact [EMAIL] for details');
  });

  it('redacts phone numbers with dashes', () => {
    expect(piiRedact('Call 555-123-4567 now')).toBe('Call [PHONE] now');
  });

  it('redacts international phone numbers', () => {
    expect(piiRedact('Reach +1 555-123-4567 today')).toBe('Reach [PHONE] today');
  });

  it('redacts IBAN account numbers', () => {
    expect(piiRedact('Transfer to GB29NWBK60161331926819')).toBe('Transfer to [IBAN]');
  });

  it('redacts 10–19 digit account numbers', () => {
    expect(piiRedact('Account 1234567890 needs review')).toBe('Account [ACCOUNT] needs review');
  });

  it('does NOT redact trading prices', () => {
    expect(piiRedact('DVS 61.34 price 6582.50')).toBe('DVS 61.34 price 6582.50');
  });

  it('does NOT redact short standalone numbers', () => {
    expect(piiRedact('Level 6616 is the max_sell_1')).toBe('Level 6616 is the max_sell_1');
  });

  it('produces the same output for the same input (pure function)', () => {
    const input = 'user@domain.com and 555-123-4567';
    expect(piiRedact(input)).toBe(piiRedact(input));
  });
});
