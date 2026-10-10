# Study Curve

[日本語](README.ja.md)

**Study Curve** schedules reviews of whole notes along the Ebbinghaus forgetting curve. Each note you enroll moves up a fixed ladder of intervals (1, 3, 7, 14, 30, 60 and 90 days by default) when you remember it, and drops back to the start when you forget. If you are studying for an exam, give the deck an exam date: reviews that would fall after the exam are pulled in, and every note in the deck comes back in the final days before it.

Other plugins such as Spaced Repetition (flashcards and entire notes) and Note Review Reminder (spaced reviews and reminders) also schedule note reviews. Study Curve treats one note as one topic you should be able to recall, keeps the review state only in each note's frontmatter, and gives every note a "can you recall it?" section and grading criteria through a built-in template. **The user interface is currently in Japanese only**; see the [Japanese UI reference](#japanese-ui-reference) below. English UI is planned.

## Features

- Review whole notes. Grade each review with one of four buttons (☆ ◯ △ ✗) and the next review date is set for you
- A review board with each deck's status, today's reviews, upcoming reviews and notes not enrolled yet
- Optional exam dates: reviews are pulled in before the exam, and the whole deck comes back in the final days
- Code blocks for your daily note (`study-today`, `study-forecast`, `study-progress`), so you can grade without opening the board
- "Create review note" makes a note from the built-in template (or your own) and enrolls it right away
- Enroll the existing notes in a deck's folder in bulk, after confirming the count
- The same workflow on Mac, Windows, iPad and phones. The layout follows the available width

## How it works

### Intervals

Each stage has a fixed interval, and your grade moves the note between stages.

| Stage | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Next review in | 1 day | 3 days | 7 days | 14 days | 30 days | 60 days | 90 days |

- **◯ Remembered** → stage +1 (stays at the last stage)
- **△ Unsure** → same stage (the same interval again)
- **✗ Forgot** → back to stage 0 (comes back tomorrow)
- **☆ New** → same stage, but the next review is **always 3 days later**

☆ is not "forgot" but "**I haven't learned this yet**". The forgetting curve measures how well you retain something you once learned; grading unlearned material with ◯△✗ would mix "forgot" and "never learned" on the same scale, and the note would never move up. Tomorrow would only test your short-term memory, and a week is too long for something you just met, so it is 3 days.

You can change the intervals in the settings. There is no ease factor (as in SM-2): the stage alone explains why a note is due today.

The clock button (postpone to tomorrow) moves the review one day later (the day after the later of the due date and today) without changing the stage. It is hidden for decks in their final review period.

### Exam dates (optional)

If a deck has an exam date, two things happen. Without one, neither does.

1. **Pull-in** — a review that would fall after the exam date is moved to the exam date
2. **Final review** — when the exam is less than 7 days away (configurable), every note in the deck shows up in today's reviews regardless of its due date

## Getting started

1. Install Study Curve from Community plugins and enable it
2. Open the review board (the brain icon in the ribbon, or the command "復習ボードを開く") and create a deck by following the guidance. If some notes already have `study-deck`, the board finds those decks and lets you add them to the settings
3. Prepare notes
   - For a new note, use the command "復習ノートを作成" (Create review note) or "＋ ノート" on a deck card
   - For existing notes, enroll them from "未登録のノート" (Notes not enrolled yet) on the board, or open a note and run "このノートを復習対象に登録" (Enroll this note)
4. From the next day, grade your notes in "今日の復習" (Today's reviews) on the board, or in a `study-today` block in your daily note

## Writing review notes

"Create review note" uses this built-in template (`{{title}}` is the title you enter). The headings are in Japanese; "思い出せるか" means "can you recall it?" and "答え合わせ" means "check your answer".

```markdown
# {{title}}

## ✅ 思い出せるか（読む前に）

> 例を見て答えを思い浮かべてから、下の答え合わせを読む。

**例1**

**例2**

**例3**

| 判定 | 基準 | 次回 |
|---|---|---|
| **☆ 初見** | この内容を学ぶのが初めて | 3日後 |
| **◯** | 答え合わせの太字を自分の言葉で言えた | ステージ +1 |
| **△** | 太字は言えたが「なぜ」が出てこない | 据え置き |
| **✗** | 一度学んだはずなのに出てこない | 翌日 |

---

## 🎯 答え合わせ — これを覚えていればOK

- **OK**：
- **なぜ**：
```

- The note is created in the deck's folder (or in Obsidian's default location for new notes). If the name is taken, ` 1`, ` 2`… is appended
- Set "復習ノートのテンプレート" (Review note template) to use your own file instead. `{{title}}`, `{{deck}}` and `{{date}}` are replaced. The template's frontmatter is kept, and the `study-*` keys are added to it
- The "思い出せるか" heading matches the default heading of the "clear checks after grading" setting

The [guide to writing review notes](docs/guide/review-notes.md) covers writing questions and answers, grading with ☆ ◯ △ ✗, making notes from work notes or with generative AI, and an English version of the template. Finished samples are in [`docs/examples/en/`](docs/examples/en/).

## Japanese UI reference

| On screen | In English | Where |
| --- | --- | --- |
| 復習ボード | Review board | Board tab |
| デッキ | Decks | Board section |
| 今日の復習 | Today's reviews | Board section, `study-today` |
| これからの復習量 | Upcoming reviews | Board section |
| 未登録のノート | Notes not enrolled yet | Board section |
| ☆ 初見 | New (learning it for the first time) | Grade button |
| ◯ 覚えてた | Remembered | Grade button |
| △ あいまい | Unsure | Grade button |
| ✗ 忘れた | Forgot | Grade button |
| 明日に送る (clock icon) | Postpone to tomorrow | Row button |
| 復習対象から解除 (trash icon) | Unenroll | Row button |
| 遅延 / 今日 / 直前 | Overdue / Due today / Final review | Row badge |
| 初回 / 未スケジュール | First review / Not scheduled | Row |
| 試験まで あと N日 / 試験日 未設定 | N days until the exam / No exam date | Deck card |
| 登録 / 遅延 / 休止 / 定着度 | Enrolled / Overdue / Suspended / Retention | Deck card |
| ＋ ノート | + Note (create a review note in this deck) | Deck card |
| 設定に無いデッキ名です / 設定に追加 | Deck name not in settings / Add to settings | Deck card |
| すべて登録 / 登録 | Enroll all / Enroll | Notes not enrolled yet |
| フォルダ名で絞り込み | Filter by folder name | Notes not enrolled yet |
| 処理中… | Working… | Notes not enrolled yet |
| 最初のデッキを作りましょう / デッキを作成 | Create your first deck / Create deck | Board guidance |
| 登録済みのノートが見つかりました / すべて設定に追加 | Enrolled notes found / Add all to settings | Board guidance |
| 名前 / フォルダ / 試験日 | Name / Folder / Exam date | Deck dialog |
| 復習ノートを作成 / 作成 | Create review note / Create | Review note dialog |
| キャンセル / 保存 / 削除 | Cancel / Save / Delete | Dialogs |
| ノートを残して削除 / N 件を復習対象から外して削除 | Delete and keep notes / Delete and unenroll N notes | Deck deletion |

## Commands

No hotkeys are assigned by default. Assigning hotkeys to ☆ ◯ △ ✗ lets you grade while reading a note.

| Command (Japanese) | In English | What it does |
| --- | --- | --- |
| 復習ボードを開く | Open review board | Opens the board in a tab |
| 今日の復習を始める（最初のノートを開く） | Start today's reviews (open the first note) | Opens the first note in today's reviews |
| このノートを復習対象に登録 | Enroll this note | Picks the deck from the note's folder, or asks you to choose one (a new name is also added to the settings) |
| 復習ノートを作成 | Create review note | Asks for a deck and a title, creates the note, enrolls it and opens it |
| このノートを復習対象から外す | Unenroll this note | After confirmation, removes `study-*` from the frontmatter |
| 復習を記録: ◯ 覚えてた / △ あいまい / ✗ 忘れた / ☆ 初見 | Record review: Remembered / Unsure / Forgot / New | Grades the open note |
| このノートの復習を休止／再開 | Suspend / resume this note | Toggles `study-suspended` |

## Code blocks

Put these in your daily note or weekly review.

````markdown
```study-today
deck: AWS ANS   # optional: only this deck
limit: 10       # optional: defaults to the daily limit setting
```

```study-forecast
days: 30        # optional: defaults to the forecast days setting
deck: AWS ANS   # optional
```

```study-progress
deck: AWS ANS   # optional
```
````

- `study-today`: the same rows as the board, so you can grade inside your daily note
- `study-forecast`: a bar chart of how many reviews are due in the next N days. Overdue reviews count toward today and are shown in red at the bottom of today's bar
- `study-progress`: a table of each deck's exam date, enrolled notes, due today, overdue and retention

## Settings

| Setting (Japanese) | In English | Default | Notes |
| --- | --- | --- | --- |
| ステージごとの間隔（日） | Intervals per stage (days) | `1, 3, 7, 14, 30, 60, 90` | Stage 0, 1, 2… from the left. Empty uses the default |
| 1日に出す上限 | Daily limit | 20 | 0 means no limit |
| 直前総ざらいの日数 | Final review days | 7 | Show every note of a deck when its exam is closer than this |
| 予定グラフの日数 | Forecast days | 14 | Default for the board and `study-forecast` |
| 採点したら次のノートを開く | Open the next note after grading | On | After grading on the board, open the next note |
| 採点したら本文のチェックを外す | Clear checks after grading | **Off** | When on, completed checkboxes (`- [x]`) under the heading below are reset to `- [ ]`. Other sections, the frontmatter and code blocks are not touched |
| チェックを外す見出し | Heading for clearing checks | `思い出せるか` | From a heading containing this text to the next heading of the same or higher level |
| 復習ノートのテンプレート | Review note template | (empty) | Empty uses the built-in template |
| デッキ | Decks | (none) | Name, folder and exam date. Use "デッキを追加" (Add deck) and the edit and delete buttons on each row |

- Invalid numbers are not saved; the reason is shown under the field
- A deck's **folder** is used to list notes not enrolled yet and to pick the deck when enrolling. With nested folders, the deepest match wins
- **Renaming** a deck also rewrites `study-deck` in its notes (the count is shown before you save). Deck names written in code blocks (`deck:`) and in your scripts are not changed
- **Deleting** a deck asks for confirmation and lets you either keep its notes or unenroll them

## Frontmatter reference

The review state lives only in each note's frontmatter. There is no separate database, so a note shows when it is due next, and Dataview can read it.

```yaml
---
study-deck: AWS DOP      # which deck (exam or subject)
study-next: 2026-09-19   # next review date
study-stage: 2           # review stage
study-history:           # the last 20 grades
  - 2026-09-12 ok
  - 2026-09-16 ok
study-suspended: true    # (optional) pause reviews
---
```

| Key | Type | Meaning | Written when |
| --- | --- | --- | --- |
| `study-deck` | text | Deck name. Notes with this key are enrolled | Enrolling, creating a note, renaming the deck |
| `study-next` | date (`YYYY-MM-DD`) | Next review date | Enrolling, grading, postponing |
| `study-stage` | integer (0–) | Stage, i.e. the position in the interval list | Enrolling (0), grading |
| `study-history` | list of text | Grades (last 20). `ok` = ◯, `hard` = △, `ng` = ✗, `new` = ☆ | Grading |
| `study-suspended` | boolean (optional) | Suspended; not shown in today's reviews | Suspending / resuming |

Unenrolling removes all five keys and leaves the other keys alone.

## Mobile

Study Curve works the same on Mac, Windows, iPad and Android (`isDesktopOnly: false`; no Node or Electron APIs).

The layout follows the width that is actually available, not the device: a phone in portrait, an iPad in split view and the board in a narrow sidebar on a Mac look the same at the same width.

| Width | Layout |
| --- | --- |
| Under 520px | Rows stack vertically and grade buttons span the width, showing only the symbols (☆ ✗ △ ◯). Forecast dates every 2 days |
| Under 380px | Forecast dates every 3 days. The progress table scrolls horizontally |
| 520px and over | One line per row, buttons with text (such as "✗ 忘れた"). Deck cards in several columns |

On touch devices, the buttons are large enough to tap easily.

Across devices:

- The review state is in the notes, so it follows your notes through Obsidian Sync, obsidian-git or any other sync
- **Don't grade the same note on two devices at the same time.** It causes a sync conflict in the note itself
- **"Today" is the device's local date.** If Obsidian stays open past midnight, the board and blocks redraw with the new date

## Privacy and disclosures

- No network requests. Everything runs locally
- Free. No payment, account, ads or telemetry
- It only reads and writes files inside your vault. Open source (MIT)

What it reads:

- The frontmatter of every Markdown note in the vault (from Obsidian's metadata cache), to find enrolled notes. A note can be enrolled in any folder, so every note is checked. Nothing it reads leaves your vault
- The paths of your folders and notes, for the suggestions in the deck folder and "Review note template" fields
- The template file set in "Review note template", when you create a review note
- Only when "Clear checks after grading" is on: the body of the note you grade

What it writes:

- The `study-*` keys in the frontmatter of enrolled notes (see above)
- Notes created with "Create review note" (in the deck's folder or Obsidian's default location for new notes)
- Only when "Clear checks after grading" is on (**off by default**): completed checkboxes in the chosen section
- Bulk enrolling, renaming a deck and unenrolling a deleted deck's notes all show the count before writing
- Settings are saved to `data.json` in the plugin's folder

## Scripting

```js
const plugin = app.plugins.plugins['study-curve'];
const queue = plugin.getDueQueue('AWS ANS'); // the deck name is optional
```

`getDueQueue(deckName?)` returns today's reviews in the same order as the board (overdue → due today → final review). The due-date and final-review rules stay inside the plugin, so templates (Templater and so on) don't need to copy them.

## Development

```bash
npm install
npm run build    # type check + production build, no side effects (used by CI and the directory's build check)
npm run dev      # watch build; copies to OBSIDIAN_DEV_PLUGIN_DIR (a test vault) if set
npm test         # unit tests (Vitest)
npm run lint     # ESLint, including manifest.json
npm run deploy   # copies the production build of main to OBSIDIAN_PLUGIN_DIR
```

Copy `.env.example` to `.env.local` and set the paths (`.env.local` is not committed).

### Releases

Pushing a tag (no `v`, the same as `version` in `manifest.json`) makes GitHub Actions create a draft release with `main.js`, `manifest.json` and `styles.css` attached. Check the attachments, then publish it.

```bash
npm version patch   # updates manifest.json, package.json and versions.json, commits and tags
git push origin main
git push origin <version>
```

Always bump the version for a fix; replacing files in an existing release is not picked up.

## License

[MIT](LICENSE)
