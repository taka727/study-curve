# Undo a pushed commit

## ✅ Can you recall it? (before reading)

> Think of the answers to the examples before reading the answer below.

**Example 1** A commit already pushed to main has a bug. Which command undoes it without rewriting history?

**Example 2** You want to undo your last commit, which you haven't pushed yet, but keep its changes locally. Which command?

**Example 3** What goes wrong if you remove the commit from Example 1 with `git reset` and force-push?

| Grade | Criterion | Next review |
|---|---|---|
| **☆ New** | Learning this for the first time | In 3 days |
| **◯** | Said the bold words of the answer in your own words | Stage +1 |
| **△** | Said the bold words but not the "why" | Same stage |
| **✗** | Learned it before but couldn't recall it | Tomorrow |

---

## 🎯 Answer — remember this

- **OK**: If it's pushed, **`git revert`** (adds a commit that undoes it); if not, **`git reset`** (moves history back; with `--soft`, the changes stay staged)
- **Why**: reset rewrites history, so it no longer matches the history of people who already pulled it. revert only adds to history, so it is safe on shared branches
