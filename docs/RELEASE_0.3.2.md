# Capri 0.3.2

Connects real saved conversations and approved profile records to the user's local
Honcho server through the official SDK 2.7.0. User and Capri authorship, source IDs
and original dates are retained. Private exchanges, action outputs, errors,
interrupted drafts and excluded sources do not enter the service.

Chat retrieves relevant learned conclusions within a 1.2-second deadline; desktop
remarks use a cached reading. These interpretations remain separate from approved
facts and cannot create action permissions, reminders or new commitment statuses.
Native memory, presence, movement, focus and direct conversation remain in place.

Memory exposes sync state, both perspectives and sync/rebuild controls. Forgetting,
correcting and disabling memory/automatic learning/saved history immediately block
old external recall. A durable deletion ledger removes the dedicated Honcho
workspace before reconnecting, including after an outage or restart. The initial
conservative reset rebuilds from remaining approved profile and future chat,
without replaying historical chat that could recreate a forgotten inference.

The server stays on loopback. Its configured local start script runs with Capri.
Storage and embeddings are local; text reasoning uses the existing Codex account.
The local adapter has a persistent 64-generation daily ceiling in Indianapolis
time. Its worker preserves queued batches at the ceiling. Recall does not invoke
a generative model. Capri falls back to native memory during service outages.

Validation: typecheck and 545 unit tests passed. The first packaged run passed 25
of 27 checks: native reply focus and actual Honcho derivation failed. The latter
run logged transient upstream 401 authentication failures. Both checks passed on
isolated reruns; original results are retained. The real source and packaged
Honcho tests verified derived context in chat and ambient prompts, Memory UI,
private-turn exclusion and privacy deletion. Five isolated daily-budget checks
passed without modifying the actual queue or budget.
