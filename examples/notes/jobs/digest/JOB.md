---
name: digest
title: Digest of several notes
children: [summarise]
inputs:
  notes: The notes to digest, one summary each
outputs:
  summaries: One summary per note, in order
---

One `summarise` run per note, in parallel; the digest is the list of summaries in the order of the notes. A note that fails to summarise fails the digest.
