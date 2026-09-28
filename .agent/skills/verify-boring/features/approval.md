# Approval

"Approve current revision" records the person's decision as a human Job whose output is the exact database revision they saw. A later write moves the note past it and the approval no longer covers what is shown. Laws: JOB-6.

## Sub-features

- approve: one click binds the decision to the current revision.
- coverage-badge: green while the note is at the approved revision, amber after any later write.

## How to get to it (user POV)

Press "Approve current revision" above the app. The badge turns green. Edit anything; the badge turns amber and names both revisions.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed drafted
node bin/boring.mjs click "#approve" && node bin/boring.mjs state        # approved.revision == database
node bin/boring.mjs tool set_title '{"id":"<id>","title":"x","expected_revision":"<rev>"}'
node bin/boring.mjs snapshot "#appr"                                     # "approval covers revision N, now at N+1"
```

## Gotchas

- The approval covers the whole app database revision, not one note; any write elsewhere also moves past it.
