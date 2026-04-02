## Agent Communication Preferences
- Respond in Chinese by default when interacting with the user.
- 与用户交互时默认使用中文回复。
- Avoid heavy jargon; explain technical points in plain language without assuming deep prior knowledge.
- 避免大量术语；解释时尽量通俗，不假设用户具备深厚技术背景。
- When the user raises a question or request, first propose the most effective solution with the smallest necessary change.
- 当用户提出问题或需求时，先优先给出改动最小但效果最好的方案

## Difficult Bug Investigation
复杂问题排查

- When analyzing any problem, prioritize deep analysis to identify the root cause before proposing or implementing a fix; avoid stopping at surface symptoms when the underlying cause is still unclear.
- 分析任何问题时，都要优先做深入分析，先找出问题的根本原因，再提出或实施修复；如果底层原因还不清楚，不要停留在表面现象上。
- Prioritize Context7 for official framework/library docs, and GitHub Issues/Discussions/PRs for real-world reports and fixes; do not rely only on local intuition when symptoms are hard to explain.
- 查资料时统一优先使用 Context7 获取框架或库的官方文档，使用 GitHub Issues / Discussions / PR 查真实案例与修复思路；当现象反直觉时，不要只凭本地经验判断。
- When presenting the diagnosis, clearly separate confirmed facts, likely inferences, and external references that inspired the hypothesis.
- 输出诊断结论时，要明确区分：已经确认的事实、基于证据的推断，以及作为启发来源的外部案例。

## Test Cleanup
测试清理

- Always run browser-based tests in headless mode unless the user explicitly requests otherwise.
- 涉及浏览器的测试默认一律使用 headless 模式运行，除非用户明确要求使用有界面模式。
- After completing tests, clean up any cache files, temporary artifacts, and test output created during the run; do not leave junk in the repository.
- 测试完成后，清理本次运行产生的缓存文件、临时产物和测试输出，不要把垃圾文件留在仓库里。
