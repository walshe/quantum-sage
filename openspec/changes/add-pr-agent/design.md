## Context

The project has a GitHub Actions CI workflow (`.github/workflows/ci.yml`) that runs build and tests on every push/PR. PRs currently receive no automated review. PR-Agent (by CodiumAI) is an open-source tool that hooks into GitHub Actions and posts AI-generated review comments — summary, walkthrough, and suggestions — directly on the PR.

## Goals / Non-Goals

**Goals:**
- Every opened or synchronised PR automatically gets an AI review comment
- Minimal configuration to keep maintenance burden low
- Use DeepSeek as the backend model for cost-efficient reviews

**Non-Goals:**
- Replacing human code review
- Auto-approving or auto-merging PRs
- Running PR-Agent on push events (only PRs need review comments)

## Decisions

**Decision: Use PR-Agent's GitHub Action via `codiumai/pr-agent`**
The official action (`codiumai/pr-agent@main`) runs PR-Agent inside GitHub's infrastructure with no external service dependency. Alternative (self-hosted runner or direct API call) adds infrastructure complexity with no benefit for a small team.

**Decision: Use DeepSeek (`deepseek-chat`) as the backend model**
PR-Agent uses LiteLLM under the hood, which supports DeepSeek via `DEEPSEEK_API_KEY`. DeepSeek is significantly cheaper than GPT-4o for code review workloads while delivering strong results on code understanding tasks. The model is configured in `.pr_agent.toml` as `deepseek/deepseek-chat`. Alternative (OpenAI `gpt-4o`) is already in use for extraction but costs more per PR review call.

**Decision: Trigger on `pull_request` opened/synchronize/reopened events only**
Review comments only make sense on PRs. Triggering on pushes to non-PR branches would be noisy and wasteful.

**Decision: Limit to `review` and `describe` commands on first run**
`review` gives a line-by-line review; `describe` auto-generates a PR description. `improve` (code suggestions as review comments) is useful but verbose — can be added later once the team has validated the signal quality.

## Risks / Trade-offs

[API cost] → Each PR triggers one or two DeepSeek calls. DeepSeek is very cheap for this use case. → Mitigation: monitor DeepSeek usage dashboard; cost is unlikely to be a concern at this repo's volume.

[Noisy comments on trivial PRs] → Minor changes (typo fix, dependency bump) will still get a full review. → Mitigation: PR-Agent can be configured to skip reviews below a diff-line threshold via `.pr_agent.toml`.

[GITHUB_TOKEN permissions] → PR-Agent needs `pull-requests: write` to post comments. The workflow must explicitly grant this. Missing this is a common setup mistake.

## Migration Plan

1. Add `.pr_agent.toml` at repo root with minimal config
2. Add `.github/workflows/pr-agent.yml`
3. Add `DEEPSEEK_API_KEY` as a GitHub Actions secret (Settings → Secrets and variables → Actions)
4. Open a test PR to validate the comment appears
5. Rollback: delete the workflow file; no other changes to revert
