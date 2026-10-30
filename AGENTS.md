# Capri project continuity

Before changing dialogue, persona, context, or companion behavior, read
`docs/DIALOGUE_GUIDE.md`. It is the cumulative source of the user's dialogue
preferences. Its runtime section is imported into both chat and ambient prompts.

Preserve older preferences unless the user explicitly supersedes them. Add new
feedback to the dated preference ledger, reconcile conflicts explicitly, and
update examples and runtime guidance together. Do not replace this guide with
the newest request or create a competing persona document. Keep examples as
illustrations, not fixed lines to repeat. Check actual live prompt paths.

Keep cursor visits, new-window interest, and tour/perch/lower-ledge choices
available together. A change to speech or memory must not silently remove a
physical behavior. Test movement cancellation, closed/covered targets, user
placement, focus, sleep, and profile preservation when changing these paths.

Keep existing unrelated changes. Validate the packaged application before
replacing the running copy, with a stopped-profile backup and rollback package.
