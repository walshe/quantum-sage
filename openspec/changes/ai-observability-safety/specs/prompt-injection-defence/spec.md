## ADDED Requirements

### Requirement: Text-derived inputs are screened for injection patterns before dispatch
The system SHALL screen any analyst-supplied text strings (e.g. `callerKey`, future free-text fields) for prompt injection patterns before they are included in the model request. Image bytes are not screened (they are not text). If an injection pattern is detected, the call SHALL be blocked and a `warn`-level log entry emitted with `event: "INJECTION_BLOCKED"` and the matched pattern category.

#### Scenario: Clean input passes screening
- **WHEN** `checkBeforeCall` is invoked with inputs containing no injection patterns
- **THEN** it returns `{ allowed: true }` and the call proceeds normally

#### Scenario: Injection attempt is blocked and logged
- **WHEN** a text input contains a known injection pattern (e.g. `ignore previous instructions`, `disregard your system prompt`, `you are now`, `forget everything`)
- **THEN** `checkBeforeCall` returns `{ allowed: false, reason: "<pattern category>" }` and a `warn` log entry with `event: "INJECTION_BLOCKED"` is emitted; the LLM call is NOT made

#### Scenario: Partial match on common word does not block
- **WHEN** a text input contains the word "ignore" in a normal context (e.g. "ignore outliers above 6700")
- **THEN** the screener does not block the call; only multi-word injection phrases trigger blocking

### Requirement: Blocked calls are never forwarded to the provider
The system SHALL ensure that if `checkBeforeCall` returns `{ allowed: false }`, the provider's `extractSignal` method is never called and the caller receives a structured error indicating the block reason.

#### Scenario: Server returns 400 on blocked call
- **WHEN** `POST /signals/extract` triggers an injection block in `checkBeforeCall`
- **THEN** the server responds with HTTP 400 and a JSON body `{ error: "Request blocked: <reason>" }`; no provider API call is made
