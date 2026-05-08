## ADDED Requirements

### Requirement: PII patterns are redacted from audit log content before writing
The system SHALL apply a PII redactor to any text content before it is written to the structured log. Redacted tokens SHALL be replaced with a placeholder indicating the category (e.g. `[EMAIL]`, `[PHONE]`, `[IBAN]`, `[ACCOUNT]`). The original unredacted content SHALL be sent to the model as normal — redaction applies only to the audit trail.

Patterns the system SHALL redact:
- Email addresses (`[EMAIL]`)
- Phone numbers in common formats — international and local (`[PHONE]`)
- IBAN-format account numbers (`[IBAN]`)
- Numeric strings of 10–19 digits (potential account/card numbers) (`[ACCOUNT]`)

#### Scenario: Email in logged content is redacted
- **WHEN** log content contains a string matching an email pattern (e.g. `fb@example.com`)
- **THEN** the log entry contains `[EMAIL]` in place of the email address

#### Scenario: Non-PII financial numbers are not redacted
- **WHEN** log content contains typical trading prices or DVS values (e.g. `6582.50`, `61.34`)
- **THEN** the values are not redacted; only PII patterns trigger replacement

#### Scenario: Redaction is applied before the log write, not before the API call
- **WHEN** `SignalExtractor.extract()` sends content to the provider
- **THEN** the full unredacted content is sent to the model; redaction occurs only when constructing the audit log entry

### Requirement: Redaction is stateless and side-effect free
The `piiRedact(text: string): string` function SHALL be a pure function with no I/O, suitable for inline use in log formatters.

#### Scenario: Same input always produces same output
- **WHEN** `piiRedact` is called twice with identical input
- **THEN** it returns identical output both times
