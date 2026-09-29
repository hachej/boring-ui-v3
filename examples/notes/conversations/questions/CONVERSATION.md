---
name: questions
title: Questions about the notes
agent: answer
history: 6
inputs:
  notes: { type: array, items: string, description: The notes the conversation is about }
---

Each message is one run of `answer` with the notes and the last six turns as context.
