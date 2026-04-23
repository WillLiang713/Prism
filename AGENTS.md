## Agent Communication Preferences
- Respond in Chinese by default when interacting with the user.
- Avoid heavy jargon; explain technical points in plain language without assuming deep prior knowledge.
- When the user raises a question or request, first propose the most effective solution with the smallest necessary change.

## Difficult Bug Investigation
- When analyzing any problem, prioritize deep analysis to identify the root cause before proposing or implementing a fix; avoid stopping at surface symptoms when the underlying cause is still unclear.
- Prioritize Context7 for official framework/library docs, and GitHub Issues/Discussions/PRs for real-world reports and fixes; do not rely only on local intuition when symptoms are hard to explain.
- When presenting the diagnosis, clearly separate confirmed facts, likely inferences, and external references that inspired the hypothesis.

## Test Cleanup
- Always run browser-based tests in headless mode unless the user explicitly requests otherwise.
- After completing tests, clean up any cache files, temporary artifacts, and test output created during the run; do not leave junk in the repository.
