## MODIFIED Requirements

### Requirement: checkBeforeCall screens inputs and returns an allow/block decision
The guardrail's `checkBeforeCall` method SHALL accept the call context and return a structured decision object `{ allowed: boolean; reason?: string }`. It SHALL delegate to the injection screener for text inputs. Previously this was a no-op returning void; the return type is now load-bearing.

#### Scenario: Clean inputs return allowed
- **WHEN** `checkBeforeCall` is called with inputs that pass all screens
- **THEN** it returns `{ allowed: true }` synchronously

#### Scenario: Injected input returns blocked with reason
- **WHEN** `checkBeforeCall` detects an injection pattern in any text input
- **THEN** it returns `{ allowed: false, reason: "<pattern category>" }`

### Requirement: recordUsage accumulates cost and call statistics
The guardrail's `recordUsage` method SHALL accept a usage record `{ latencyMs, promptTokens, completionTokens, estimatedCostUsd, success, validationFailed }` and accumulate the values into the session metrics store used by the `ai-quality-metrics` capability. Previously this was a no-op.

#### Scenario: Successful call increments success count and cost
- **WHEN** `recordUsage` is called with `{ success: true, estimatedCostUsd: 0.002, latencyMs: 1200 }`
- **THEN** `successCount` increments by 1, `totalCostUsd` increases by `0.002`, and `1200` is added to the latency sample

#### Scenario: Failed call increments failure count but not cost
- **WHEN** `recordUsage` is called with `{ success: false, estimatedCostUsd: null }`
- **THEN** `failureCount` increments by 1 and `totalCostUsd` is unchanged
