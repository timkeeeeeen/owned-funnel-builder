# Final fix wave report

Closed the reviewed safety gaps at the shared seams: canonical funnel IDs are
required and queue sender manifests fail closed; Meta receives only the event's
persisted buyer context and requires `meta-v1` identity metadata; privacy
requests commit tombstones first and queue/DLQ replay suppresses tombstoned
subjects; Tinybird deduplication anti-joins current tombstones and uses a
versioned subject key; retryable deliveries become permanent/DLQ at the retry
ceiling; browser claims require a verified HttpOnly flow binding; context
exchange rows are expiry- and one-time-consume-bound; kill-switch work remains
paused; and live publish dry-runs select the production Wrangler environment.

Added migration `0008_security_fix_wave.sql` and adjusted focused fixtures.
The follow-up also preserves the validated funnel routing key through policy
projection, removes raw checkout buyer context from source outbox envelopes,
binds Tinybird subjects to persisted privacy IDs, uses durable delivery attempt
counts, scrubs persisted context at cleanup, and keeps access/correction
requests pending without creating deletion tombstones.
No provider, deployment, campaign, payment, refund, or Woodpecker mutation was
performed.

Verification: `git diff --check` passed. The focused host wrapper remained
blocked by load above its configured threshold. `maestro-remote-test` was
attempted after commit but the remote seed rejected the bundle ancestry with
`fatal: Not a valid commit name c4e8e590a9bca68fb0535ead713c00701c2aeae0`.
Repository-wide `tsc --noEmit` still reports pre-existing baseline errors; the
new Tinybird commerce typing issue was corrected.
