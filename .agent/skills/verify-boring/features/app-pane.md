# App pane

The right pane is the app's own page, served by the hub. Everything it does goes through the app's declared tools, called as the person, admitted and revision-checked by the platform. Laws: DATABASE-1, DATABASE-2, ENVIRONMENT-4, PLATFORM-1.

## Sub-features

- record-list: every note, newest first; the open one highlighted.
- create-record: title box and Add; creates the note and an empty dictation file.
- dictation: the dictation text, saved against the dictation revision it was opened at.
- rename: title field and Rename, saved against the database revision it was read at.
- sections: three cards, filled by the agents; dashed while empty.
- revision pills: the database revision and the dictation revision the page is showing.
- selection-to-chat: opening a note tells the hub which record the assistant sees as open.

## How to get to it (user POV)

Open the hub; the app fills the right pane. Type a title and press Add, or pick a note in the list. Type into Dictation and press Save dictation. Edit the title and press Rename. The cards fill in when someone asks the chat for a draft.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed empty
node bin/boring.mjs type "app:#newTitle" "Visit of 28 September" && node bin/boring.mjs click "app:#new button"
node bin/boring.mjs type "app:#dictation" "Cough for a week. No fever." && node bin/boring.mjs click "app:#saveDictation"
node bin/boring.mjs snapshot "app:#msg"          # "Dictation saved at revision 2."
node bin/boring.mjs tool read_note '{"id":"<id>"}' # side effect, not pixels
node bin/boring.mjs log | tail -3                 # the writes, attributed to the person's pane
```

- Conflict path: read a note, change it through another path (`tool set_title` with the current revision), then press Rename in the page. Expect the page to say the note changed and keep the typed text; a second Rename applies it to the new revision.
- Schema path: `tool save_section '{"id":"x","section":"Z","heading":"h","lines":[]}'` answers 400 `not one of "A", "B", "C"` and the log shows no write.
- Persistence: `env up --restart --keep-data` and read the note back.

## Gotchas

- The page polls every 700 ms; `wait-settle` or a `snapshot` after a short action is the end state, not the click itself.
- Selecting a note is also what the assistant will draft. Drive `select` or click the note before asking the chat.
- A tool refused by the platform answers 400 with the reason in `error`; the page shows it in `#msg`.
