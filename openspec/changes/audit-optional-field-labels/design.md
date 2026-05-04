## Context

The setup form's Levels fieldset contains four fields — MAX SELL 1, MAX SELL 2, MAX BUY 1, MAX BUY 2 — each individually labeled "(optional)". The validator (Rule 5b in `src/signal/validator.ts`) enforces two constraints that the form does not communicate:

1. **Pair integrity**: if either member of a pair is present, the other must be too (a solo MAX BUY 1 with MAX BUY 2 missing will not pass ordering validation, and more importantly will never constitute a complete pair).
2. **At-least-one-pair**: both pairs may be absent only if neither is needed; in practice, the validator rejects any setup where neither pair is present, since the engine would have nothing to trade.

All other "(optional)" labels on the form are accurate and need no change.

## Goals / Non-Goals

**Goals:**
- Make the form self-explanatory: an analyst reading the Levels fieldset should understand the pairing constraint without consulting external docs.
- Change the four MAX level field badges from `(optional)` to `(paired)` to distinguish them from genuinely free-standing optional fields.
- Add a single short inline note inside the Levels fieldset that spells out the rule.
- Keep the Italian i18n table in sync.

**Non-Goals:**
- Changing the validator logic — the backend rule is correct as-is.
- Enforcing the constraint client-side with JS (a clear label + note is sufficient; the server error is descriptive enough if it still fires).
- Touching any other form section or any server-side code.

## Decisions

**Use `(paired)` badge instead of `(optional)`.** Keeps the same visual pattern the analyst is used to (the `<span class="optional">` chip) but signals a different semantics. Re-using the existing CSS class avoids adding a new style.

**Add a fieldset-level note, not per-field tooltips.** The constraint applies to the group as a whole. A single note above the level inputs is less repetitive than duplicating the explanation in four separate tooltip strings.

**Note placement: after the `<legend>` tag, before the first input.** This is the natural reading position — the analyst sees the rule before touching any field.

## Risks / Trade-offs

- **Slightly busier UI.** One extra line of text in the fieldset. Low risk — the note is short and helps, not harms, the analyst.
- **`(paired)` may be unfamiliar.** Mitigated by the adjacent fieldset note which explains what "paired" means in concrete terms.
