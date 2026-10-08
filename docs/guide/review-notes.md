# Writing review notes

[日本語](review-notes.ja.md) / [Back to README](../../README.md)

## About this guide

Half of what Study Curve offers is the shape of the note: a question you try to recall before reading, a one- or two-line answer, and clear criteria for ☆ ◯ △ ✗. This guide explains that idea and how to write such notes, both for people using the built-in template and for people making their own.

Notes with the built-in template are created by the command "復習ノートを作成" (Create review note) or "＋ ノート" on a deck card on the board. The plugin's UI is in Japanese; see the [Japanese UI reference](../../README.md#japanese-ui-reference).

## The idea

- **One note, one thing to recall.** A note checks one thing you can clearly say you did or didn't recall
- **Recall before you read.** Reading the answer and thinking "I knew that" is not recall. Look at the question, say the answer in your head, then read the answer
- **Grade by facts, not by feeling.** Not "I sort of remember it", but "did I say the bold words of the answer?"

## Parts of the built-in template

The built-in template is in Japanese:

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

To write in English, copy this English version to a file in your vault and set "復習ノートのテンプレート" (Review note template) in the settings to that file. `{{title}}`, `{{deck}}` and `{{date}}` are replaced as usual.

```markdown
# {{title}}

## ✅ Can you recall it? (before reading)

> Think of the answers to the examples before reading the answer below.

**Example 1**

**Example 2**

**Example 3**

| Grade | Criterion | Next review |
|---|---|---|
| **☆ New** | Learning this for the first time | In 3 days |
| **◯** | Said the bold words of the answer in your own words | Stage +1 |
| **△** | Said the bold words but not the "why" | Same stage |
| **✗** | Learned it before but couldn't recall it | Tomorrow |

---

## 🎯 Answer — remember this

- **OK**:
- **Why**:
```

| Part | Role |
| --- | --- |
| ✅ Can you recall it? (before reading) | Where the questions go. Read them and say the answer in your head |
| Examples 1–3 | The questions. Ask about the same answer from different angles (see "Writing questions") |
| Grading table | The criteria. Look at it before pressing a button. If you changed the intervals, edit "Next review" freely |
| Divider (`---`) | Separates questions from the answer, so the answer is out of sight until you scroll |
| 🎯 Answer | The answer. The OK line is the grading criterion, and the "why" line is the criterion for △ |

## Writing questions

1. **Don't put the answer in the question.** The answer goes only in the answer section
2. **Ask with a situation, not a definition.** Exams and real work both ask you to pick the answer for a situation
3. **Use two or three examples that ask about the same answer from different angles**: a concrete situation, the reverse direction, a contrast with something easy to confuse
4. **Make questions with exactly one answer.** "Explain X" cannot be graded as said or not said
5. **Keep each example to one or two lines.** Long questions cost time at every review

| Bad | Good | Why |
| --- | --- | --- |
| `What is 401?` | `You call a members-only API without logging in. 401 or 403?` | Picks the answer for a situation instead of reciting a definition |
| `401 is an authentication error. What is 403?` | `You log in as a regular member and call an admin-only API. What do you get?` | The question already contains half of the answer |
| `Explain HTTP status codes.` | (Split the note and ask only about 401 vs 403) | Too broad to grade as said or not said |

## Writing the answer

- **The OK line is one or two lines.** It is the standard for ◯. If it grows beyond three lines, split the note
- **The bold words are what you grade against.** Make them words you can clearly say or not say (terms, numbers, commands)
- **The "why" is one line.** It is the standard for △ (you said the bold words but not the why)
- Add anything else (diagrams, sources, links to related notes) below the answer, but don't make the OK line longer

## Grading with ☆ ◯ △ ✗

Go from the top.

| Step | Question | If so |
| --- | --- | --- |
| 1 | Is this the first time you are learning it (you never tried to memorize it)? | ☆ New (same stage, in 3 days) |
| 2 | Before reading the answer, did you say **all** the bold words of the OK line in your own words? | If not, ✗ Forgot (stage 0, tomorrow) |
| 3 | Did you also say the "why"? | If not, △ Unsure (same stage) |
| 4 | None of the above | ◯ Remembered (stage +1) |

- If you said only some of the bold words, it is ✗. If you keep missing some of them, that is a sign to split the note
- If you couldn't answer one of the examples but said the bold words and the "why", ◯ is fine (steps 2 and 3 are met). The examples are only cues for recalling the bold words. If you said the bold words but not the why, it is △ as in step 3

### Why not "△ when in doubt"

- △ keeps the stage. It looks safe, but you lose either way
  - You had actually forgotten, but chose △ → the interval doesn't shrink, and the gap until the next review stays long
  - You had actually recalled it, but chose △ → the interval doesn't grow, the note keeps coming back at the same interval, and your daily count doesn't go down
- You hesitate because you are grading by feeling (confidence). Grade by "did I say the bold words of the OK line?" and there is little room to hesitate
- ✗ is not a punishment. The note just comes back tomorrow; recall it then and ◯ moves it forward

## When to split a note

Split it if any of these is true:

- The OK line is longer than three lines
- There are more than four bold words
- The examples have different answers (the note asks about two things)

On the other hand, if the examples only rephrase one term, keep them in one note.

## Making notes from work notes

1. From your notes, pick one thing you want to decide without looking it up next time the same situation comes
2. Write it as the OK line (one or two lines). Bold the words that decide it (`git revert`, `git reset` and so on)
3. Write the situations that need that decision as Examples 1–3, in question form (the situations in your notes are easy to reuse)
4. Write the reason in one line as the "why"
5. Leave the rest of your notes (detailed steps, logs, links) below the answer or in the original note. Don't put everything into the review note

An example of the original notes (made up):

```markdown
- A fix we shipped to production had a bug. It was already pushed, so I used revert instead of reset
- For my last local commit, I redid it with reset --soft HEAD~1 (the changes stay)
- Resetting and force-pushing conflicts with the history of people who already pulled
```

The sample "Undo a pushed commit" below was made from these notes.

## Samples

| Sample | What to look at |
| --- | --- |
| [401 vs 403](../examples/en/401-vs-403.md) (for exam study) | Examples 1 and 2 contrast the two; Example 3 asks in reverse (deciding from a 403). All can be answered with the bold words of the OK line |
| [Undo a pushed commit](../examples/en/git-undo-pushed-commit.md) (from work notes) | Only the deciding point (revert vs reset) from the three lines of notes above became the OK line. The detailed steps are left out |

Japanese versions with the built-in template's headings are in [`docs/examples/ja/`](../examples/ja/).

- Copy a sample into a deck's folder and it appears under "未登録のノート" (Notes not enrolled yet) on the board. Enroll it from there (it has no `study-*` keys, so it is not enrolled just by being there)
- The samples are finished notes, so don't use them as templates (they have no placeholders and would produce the same text every time). Use the full template in "Parts of the built-in template"

## Using checkboxes for self-checks

The built-in template doesn't use checkboxes. If you want them, write the examples as `- [ ] Example 1 …` and turn on "採点したら本文のチェックを外す" (Clear checks after grading).

- After grading, only completed checkboxes (`- [x]`) under a heading containing the text set in "チェックを外す見出し" (Heading for clearing checks, default `思い出せるか`) are reset to `- [ ]`. Other sections, the frontmatter and code blocks are not changed
- If you write headings in English, change this setting to match your heading (for example, `Can you recall it`)

## Using generative AI

An instruction you can use with any tool:

```text
Create one review note from the content below.

- Follow the "template" below exactly (headings, Examples 1–3, grading table, answer)
- The examples under "Can you recall it?" must be questions that don't contain the answer. Ask for the answer in a situation, not for a definition
- The OK line of the answer is one or two lines. Bold the words used to judge whether it was recalled
- The "why" is one line
- Don't write frontmatter (the part between --- lines)
- If there are three or more things to remember, first suggest how to split the note

Template:
(paste the template here)

Content:
(paste the relevant part of your study material or notes here)
```

- Always check the answer against your study material or official sources (generated answers can be wrong)
- Don't paste content that must not leave your hands, such as work notes. You decide what to send to which service (this plugin itself makes no network requests)
- Enroll the resulting note from "未登録のノート" (Notes not enrolled yet) on the board, or paste the text into a note made with "Create review note"

## About frontmatter

You don't need to write it. The plugin writes it when you enroll or create a note. An enrolled note's frontmatter looks like this:

```yaml
---
study-deck: Exam study
study-next: 2026-10-20
study-stage: 2
study-history:
  - 2026-10-10 ok
  - 2026-10-13 ok
---
```

The [Frontmatter reference](../../README.md#frontmatter-reference) in the README is the specification of the keys and formats. If you edit them by hand, keep these in mind:

| To do this | Edit | Note |
| --- | --- | --- |
| Change the next review date | Set `study-next` as `YYYY-MM-DD` (or use "Postpone to tomorrow" on the board) | An invalid format is treated as unscheduled and shows up in today's reviews |
| Pause a note for a while | Use the command "このノートの復習を休止／再開" (Suspend / resume this note; `study-suspended: true`) | When writing it by hand, use `true` without quotes |
| Change the deck | Edit `study-deck` | A name not in the settings shows "設定に無いデッキ名です" (Deck name not in settings) on the board |
| Change the stage | Set `study-stage` to an integer | A quoted value such as `"3"` is treated as 0 |
| History | Don't edit it by hand | Only the last 20 entries are kept. See the README for the format |
| Stop reviewing a note | Use the command "このノートを復習対象から外す" (Unenroll this note) | All five keys are removed (including the stage and history) |
