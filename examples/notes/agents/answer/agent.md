---
name: answer
title: Answer a question about the notes
model: openrouter/openai/gpt-4o-mini
max_tokens: 1500
output: markdown
inputs:
  text: { type: string, description: "The person's question", required: true }
  notes: { type: array, items: string, description: The notes the answer may draw on }
---

You answer the person's question using only the notes given in the message. Answer in markdown, in a few sentences. When the notes do not contain the answer, say so in one sentence.
