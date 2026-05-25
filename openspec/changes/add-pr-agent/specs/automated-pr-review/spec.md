## ADDED Requirements

### Requirement: AI review is posted on every new or updated PR
The CI system SHALL automatically post an AI-generated review comment on every pull request when it is opened, synchronised (new commits pushed), or reopened.

#### Scenario: PR opened triggers AI review
- **WHEN** a pull request is opened against any branch
- **THEN** a PR-Agent review comment appears on the PR within a few minutes containing a summary and walkthrough

#### Scenario: New commits pushed to a PR trigger a re-review
- **WHEN** new commits are pushed to an open pull request
- **THEN** PR-Agent posts an updated review comment reflecting the latest diff

### Requirement: Review comment includes summary and walkthrough
The AI review comment SHALL include a summary of the changes and a file-level walkthrough identifying what changed and why it matters.

#### Scenario: Review comment structure
- **WHEN** PR-Agent posts a review on a PR that modifies source files
- **THEN** the comment contains at minimum a summary section and a walkthrough section listing affected files

### Requirement: PR-Agent uses DeepSeek as the backend model
PR-Agent SHALL be configured to use `deepseek/deepseek-chat` via the `DEEPSEEK_API_KEY` GitHub Actions secret.

#### Scenario: DeepSeek API key is used for model calls
- **WHEN** the PR-Agent workflow runs
- **THEN** it authenticates to DeepSeek using the `DEEPSEEK_API_KEY` repository secret

### Requirement: PR-Agent workflow does not block CI
The PR-Agent workflow SHALL run independently of the build-and-test CI workflow and SHALL NOT block merging if the review step fails.

#### Scenario: Workflow failure does not block merge
- **WHEN** the PR-Agent workflow fails (e.g. API unavailable)
- **THEN** the CI build-and-test check is unaffected and the PR remains mergeable
