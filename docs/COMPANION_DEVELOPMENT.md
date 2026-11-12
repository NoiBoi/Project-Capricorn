# Capri 2.0 beta: development experience and current evidence

## Which version is this?

Runtime 2 already existed before this work. The earlier 1.6 package label followed
the checkout's 1.5.5 application version; it did not mean the new companion loop
used legacy cognition. That label was confusing. The current application is
**2.0.0-beta.1**, with Runtime 2 as the normal installed and `npm start` entry point.
The existing legacy implementation remains available through `--legacy` or
`npm run start:legacy`, with its original profile kept separate.

## Daily development flow

1. Run `npm start`, or open the installed Capri / Capri Companion shortcut.
2. Chat opens paused. Start Capri is the primary action. Connection details and
   Usage and diagnostics stay collapsed once a model is configured.
3. Starting records the session locally. The notice explains that dialogue and
   authorized context/images can be retained. Pause and Resume operate within a
   session; Stop ends recording and pauses model work and observation.
4. Open Developer tools. Overview identifies the actual architecture, model,
   loop phase, pending sources and reasons for waiting. It reads Runtime 2,
   rather than displaying the inactive legacy mind.
5. Results contains bounded model/tool/presentation/audio event summaries. A
   provider reply, an accepted bubble and completed audio remain separate facts.
   Detailed records and export controls remain available without dominating Chat.
6. Playground retains local artwork and movement previews. The legacy contextual
   inference checks are disabled under Runtime 2, including at the host boundary,
   because they would exercise a different cognition path.

The overview's current canonical-state list shows IDs, kinds, statuses and
revisions, rather than inventing a mental-state interpretation. Its event ring
is bounded to 80 summaries of at most 600 characters and resets on session start.
Historical full reports remain in the local diagnostic folder; this new live
view does not reconstruct a prior process's event ring on restart.

## How this UX was assessed

Following the user's November 12 correction, old tests and accumulated test
assumptions are not the primary definition of a successful frontend. The fresh
walkthrough inspected the rendered Chat and Developer windows, the visible
paused state, discoverability of Start, the collapsed settings, correct runtime
identity, disabled incompatible checks and display of an actual recorder event.
The visual walkthrough used an explicitly labeled UI fixture with zero model
calls. Screenshots were inspected, not merely generated.

The initial inspection exposed a large export panel ahead of the live overview;
it was moved into a collapsed export disclosure. The resulting Chat session bar
was 107 pixels high at the inspected 880-pixel window width, leaving conversation
space available. Automated checks are supporting boundary/regression evidence,
not a substitute for assessing whether the interaction makes sense.

## Real model verification, November 12

A separate bounded check used the production CognitiveLoop, capability executor,
context assembly, SIWC provider, Electron OS-encryption context and request
admission. It reused the existing account without copying credentials. Its
journal contained only operator-selected public NASA text, not personal dialogue
or desktop content. Native actions and capture were unavailable. It was capped
at four HTTP attempts and stopped after three; no retries or additional scenarios
were added to seek a preferred result.

| Step | Actual result | Input / output tokens |
| --- | --- | --- |
| Unprompted ambient cycle | One short unsolicited remark; no tool or memory write | 4,181 / 63 |
| Direct original-recovery control | `get_observation_by_id` requested the specified retained original; completed receipt | 3,725 / 36 |
| Outcome-aware direct continuation | Correctly answered the passage's original mass range and material-loss claim | 4,228 / 43 |
| Total | Three HTTP attempts, no missing usage, no provider/tool error | 12,134 / 142 |

The ambient remark was: “Neptune basically prevented another planet from forming,
then helped fling most of the raw material away. Absolute orbital vandal.”

The control recovered the passage and answered 7–10 Earth masses, with most of
the original material potentially lost through the giant planets' changing
orbits. Source: [NASA Kuiper Belt facts, Formation and Origins](https://science.nasa.gov/solar-system/kuiper-belt/facts/#h-formation-and-origins).

This establishes a functioning real-model path and one grounded unsolicited
response under controlled input. It does not establish sustained ordinary-use
initiative, prove the companion-mode evidence-read continuation was selected
spontaneously, or compare architectures. The direct control used the existing
deep path. The November 5 frozen A/B run and its STOP marker remain untouched.
The fresh Electron preflight succeeded when initialized with the same user-data
encryption context as the installed application; the old standalone guard was
not bypassed or resumed.

## Remaining assessment

The next useful evidence is a short, attended everyday session through the
rendered app: whether the remarks fit, silence feels appropriate, interruptions
work and the developer view explains the actual result. Passing old scenarios
or generating a favorable single remark is not the acceptance criterion.

## Installed beta handoff

The 2.0.0-beta.1 installer completed successfully. The installed executable and
its packaged manifest report that version; installed `app.asar` matched the
validated package byte for byte. A normal launch with no runtime flag selected
the retained `daily-test` profile, opened compact Chat, recognized the existing
account, and showed Runtime 2 in Developer tools. It remained paused with zero
requests. The installed original-recovery control also completed with fixture
inference in its own isolated profile.

The fresh rendered-window walkthrough and native installed launch are the UX
evidence. Supporting checks covered typing/voice/session controls, direct
preemption, diagnostic handling, default/fallback selection and request bounds.
Both existing profiles were backed up while stopped, and the previous 1.6
installer was retained for rollback. Main is not merged; the work remains on
`feature/companion-evidence-loop` in the canonical Desktop checkout.
