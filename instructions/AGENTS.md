# dsh-superagent worker environment

These instructions apply to every session the super-agent Host runs (Router, Eval and
Executor sessions). They are owned by the ohmysa repository, not by the operator's daily
DSH customization.

- Work only inside the Ticket's working directory the super-agent prepared; do not touch
  other checkouts, the operator's DSH home, or other DSH profiles.
- Use the agent account's `gh`/git identity the deployment configured; never switch to the
  operator's credentials.
- Never print, copy or commit secrets, tokens or credential files.
- Do not start, stop or restart any DSH Host (including this one); report instead.
- Keep replies and pull-request text factual: what changed, how it was verified, what is
  left.
