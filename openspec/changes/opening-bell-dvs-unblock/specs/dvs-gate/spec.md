## MODIFIED Requirements

### Requirement: DVS gate re-evaluates on new setup
The engine SHALL re-evaluate the DVS gate on every call to `loadSignal()`, including when the current state is `blocked`. If the incoming setup's `volatility.dvs` is at or below the configured `trident.dvs_gate` threshold, the engine SHALL clear the blocked state and proceed to `setupTrade()` as normal. The DVS gate block is no longer a permanent per-day lock — it clears when a valid setup is submitted.

#### Scenario: Resubmit with valid DVS after block
- **WHEN** engine state is `blocked` (due to DVS gate) and a new setup is submitted with DVS ≤ gate threshold
- **THEN** engine state transitions to `watching`, SETUP_READY event fires, and the block is cleared

#### Scenario: Resubmit with still-high DVS
- **WHEN** engine state is `blocked` and a new setup is submitted with DVS still above the gate threshold
- **THEN** engine remains `blocked` and DVS_GATE_BLOCKED event fires again

#### Scenario: DVS gate fires on first load
- **WHEN** a setup is loaded and `volatility.dvs` exceeds `trident.dvs_gate`
- **THEN** engine state becomes `blocked` and DVS_GATE_BLOCKED event fires (existing behavior, unchanged)

#### Scenario: Daily lock not affected
- **WHEN** engine has `dailyLocked = true` (winning trade already taken) and a new setup is submitted
- **THEN** engine remains locked regardless of DVS value (daily lock is separate from DVS gate)
