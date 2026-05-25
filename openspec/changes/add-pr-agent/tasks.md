## 1. Configuration

- [x] 1.1 Create `.pr_agent.toml` at repo root configuring `deepseek/deepseek-chat` as the model and enabling `review` and `describe` commands

## 2. GitHub Actions workflow

- [x] 2.1 Create `.github/workflows/pr-agent.yml` triggered on `pull_request` events (opened, synchronize, reopened) with `pull-requests: write` permission
- [x] 2.2 Add a step that runs `codiumai/pr-agent` using `DEEPSEEK_API_KEY` from repository secrets

## 3. Verify

- [ ] 3.1 Add `DEEPSEEK_API_KEY` to GitHub repository secrets (Settings → Secrets and variables → Actions)
- [ ] 3.2 Open a test PR and confirm a PR-Agent review comment appears
