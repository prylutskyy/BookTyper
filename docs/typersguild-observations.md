# Typersguild: public interface observations

Observed 2026-10-21 through a fresh unauthenticated in-app browser. This report describes rendered public UI, not recovered original source. No login, uploads, account changes, or external form submissions were performed.

## Sources and observed behavior

| URL | Observation | Evidence boundary |
| --- | --- | --- |
| https://typersguild.com/ | Product positions practice around complete books/chapters, showing speed, accuracy, and weak letter pairs. Public catalog advertised as 100+ classics. | Rendered homepage text; marketing claims were not benchmarked. |
| https://typersguild.com/books/alice-in-wonderland | Book detail includes cover, title, author link, genres, estimated pages/read time, description, Start Typing, and chapter list. Other tabs are Notes, Highlights, Friends. Twelve chapters shown for Alice. | Read UI; secondary tabs not exercised. |
| https://typersguild.com/books/alice-in-wonderland/chapter/4 | Public trainer opens without authentication. This URL displayed chapter I, “Down the Rabbit-Hole”; route number is therefore not a reliable human chapter number. | Actual rendered chapter and route. |
| https://typersguild.com/books/alice-in-wonderland/chapter/4 | Trainer shows WPM, a long horizontal chapter progress bar, chapter percentage, vertically fading surrounding prose, a virtual keyboard highlighting the expected character, and right-side navigation/settings controls. It explicitly prompts sign-in to retain progress. | Screenshot and accessibility tree; typing and persistence were not tested. |
| https://typersguild.com/settings?section=training | Training controls: backtrack on error, ignore case, ignore accents, stop on error, skip symbols, skip numbers, predictive hints. Default observed training mode off; case ignored; accents not ignored; stop/skip controls off. | Rendered control labels/states, settings not modified. |
| https://typersguild.com/settings?section=training | Appearance sidebar displays font, size, weight, spacing, caret style/motion, error rendering, shortcut visibility, paragraph statistics, friends’ paragraph statistics, cat animation, zen mode. | Appearance sidebar selected without changing preferences; URL remained the training query. |
| https://typersguild.com/faq | FAQ says private imports accept EPUB and plain text, are Premium-only, and have a 50-book account limit. FAQ does not advertise FB2. | Published statement only; import not tested. |
| https://typersguild.com/faq | FAQ ties saved progress to signing in and describes cloud progress/sync. OAuth providers listed are Google, Discord, Twitter. | Published statement; no authentication performed. |

## Trainer interaction affordances

- Shortcuts shown: Ctrl+Backspace deletes a word; Ctrl+Enter dictionary; Ctrl+/ notes; Tab skips a letter.
- Quick Settings opens a side sheet with font, font size, caret motion, sound controls, virtual keyboard visibility and training options.
- Initial quick-settings values included 22 px monospace text, smooth caret motion, visible keyboard, audio enabled and an Alpaca switch sound.
- Full settings also exposes themes, stats card, audio, keyboard, notifications and billing sections.
- Top navigation links books, Wikipedia practice and leaderboard; account sign-in is distinct from starting anonymous practice.

## Visual observations relevant to a reconstruction

The desktop layout uses a slim top navigation, generous whitespace, restrained pale grey/blue surfaces, dark near-black text, subtle borders and rounded controls. Book metadata sits beside a portrait cover. Trainer content is centered in a moderately narrow reading column; the progress card spans its top, keyboard is below the active prose, and tools sit to the right. The active reading region uses large monospaced text and fades later lines. A compact shortcuts card appears on the left.

These are design observations, not permission or a requirement to reuse branding, artwork, proprietary assets, catalog data, or original code.

## Unknowns and implementation implications

- No public UI evidence establishes local browser persistence for anonymous progress. The visible sign-in prompt and FAQ describe account/cloud persistence. Local-only progress is a requested extension.
- FB2 support is not established. The bounded public FAQ search names EPUB/text; this does not prove no hidden FB2 path exists.
- Import internals, archive limits, worker usage, DOM rendering strategy, indexing and large-book performance remain unknown from UI observation.
- The trainer accessibility tree exposed the whole sample chapter. That is not proof of the underlying DOM virtualization or rendering algorithm.
- Handling of wrong characters, undo, chapter completion and session timing were not runtime-tested in this read-only UI scope.
- A reconstruction should independently implement local IndexedDB book/progress storage, worker-based import, bounded text chunks and a small visible character window to satisfy the user’s performance and format requirements. These are engineering recommendations, not claims about Typersguild internals.
