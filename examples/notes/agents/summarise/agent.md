---
name: summarise
title: Summarise a note
description: Turns one note into a title, a short summary and up to three tags.
model: openrouter/openai/gpt-4o-mini
effort: low
max_tokens: 2000
output: tool
helper_tools: [lookup]
inputs:
  note: { type: string, description: The text of the note to summarise, required: true }
outputs:
  title: A title of at most 80 characters
  summary: One or two sentences
  tags: Up to three lowercase tags
---

You summarise a note for the person who wrote it. Read the note, then call the tool `summary_save` once with the complete result: a short title, a summary of one or two sentences, and up to three lowercase tags. Never invent facts that are not in the note. If a `lookup` tool is available you may consult it for a term you do not know.
