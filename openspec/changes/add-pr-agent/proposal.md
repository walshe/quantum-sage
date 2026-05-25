## Why

Pull requests currently have no automated review step, so review quality depends entirely on manual attention. Adding PR-Agent (Codium AI) to the GitHub Actions CI workflow gives every PR an automatic AI-generated review — catching issues, suggesting improvements, and summarising changes before a human reviews.

## What Changes

- Add a GitHub Actions workflow (`.github/workflows/pr-agent.yml`) that runs PR-Agent on every opened or synchronised pull request
- Configure PR-Agent via `.pr_agent.toml` to tailor review behaviour (e.g. which checks to run, verbosity, language)
- Store `DEEPSEEK_API_KEY` as a GitHub Actions secret

## Capabilities

### New Capabilities

- `automated-pr-review`: Every opened/updated PR automatically receives an AI-generated review comment with a summary, walkthrough, and suggestions

### Modified Capabilities

## Impact

- `.github/workflows/pr-agent.yml` — new workflow file
- `.pr_agent.toml` — new configuration file at repo root
- GitHub repository secrets — `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` must be added by the repo admin
- No source code changes required
