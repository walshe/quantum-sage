const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
// Formatted phone numbers only (requires separators) so short trading prices are safe.
const PHONE_RE = /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
// IBAN: 2-letter country code + 2 check digits + 11–30 alphanumeric BBAN (min 15 chars total).
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
// 10–19 consecutive digits (below 10 = normal financial number; above 19 = unlikely account).
const ACCOUNT_RE = /\b\d{10,19}\b/g;

export function piiRedact(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(IBAN_RE, '[IBAN]')
    .replace(ACCOUNT_RE, '[ACCOUNT]');
}
