---
name: searching-memories
description: Search conversation history using memvid CLI. Use when user asks about past conversations, "what did we discuss", "that recipe from last week", or needs to find previous context. Searches .mv2 files with hybrid search.
---

# Searching Conversation Memory

Use this skill when the user asks about past conversations or needs context from previous discussions.

## When to Use

- User asks "what did we discuss about..." or "remember when we talked about..."
- User references something from a previous conversation
- User asks for "that recipe/list/idea from last week"
- You need to recall context from earlier conversations

## Memory File Locations

```
/home/claude/shared/shared.mv2           # Group chats and shared conversations
/home/claude/private/{senderId}/memory.mv2  # Private conversations (per user)
```

**Context comes from environment**:
- `SENDER_ID` - Telegram user ID (numeric)
- `IS_GROUP` - Whether this is a group chat

## Memvid CLI Commands

### Search Conversation Memory

```bash
# Search shared memory (for group chats or general recall)
memvid find /home/claude/shared/shared.mv2 --query "pasta recipe" --mode hybrid

# Search user's private memory
memvid find /home/claude/private/${SENDER_ID}/memory.mv2 --query "secret recipe" --mode hybrid
```

### Search Modes

| Mode | When to Use |
|------|-------------|
| `--mode lex` | Exact keyword matching ("carbonara", "budget meeting") |
| `--mode sem` | Conceptual similarity ("Italian food" finds pasta, pizza) |
| `--mode hybrid` | **Default** - combines both, best for most queries (can omit flag) |

### Command Syntax

```bash
memvid find <memory_file.mv2> --query "<search_query>" [--mode lex|sem|hybrid]
```

## Search Strategy

1. **Determine context**: Is this a group chat (`IS_GROUP=true`) or private?
2. **Choose memory file**:
   - Group chat → `/home/claude/shared/shared.mv2`
   - Private chat → `/home/claude/private/${SENDER_ID}/memory.mv2`
3. **Start with hybrid mode** for best recall
4. **If no results**, try:
   - Different keywords
   - `sem` mode for conceptual matches
   - `lex` mode for exact phrases

## Example Usage

```bash
# User asks: "What was that Italian recipe we discussed?"
memvid find /home/claude/shared/shared.mv2 --query "Italian recipe" --mode hybrid

# User asks: "Remember my secret family recipe?"
memvid find /home/claude/private/${SENDER_ID}/memory.mv2 --query "secret family recipe" --mode hybrid

# User asks: "Find conversations about the budget"
memvid find /home/claude/shared/shared.mv2 --query "budget" --mode lex
```

## Output Interpretation

Memvid returns matches with:
- **Score** - Relevance (higher = better match)
- **Title** - Timestamp of the conversation turn
- **Text** - The conversation content
- **Metadata** - Role (user/assistant), artifacts created/referenced

Look for:
- **UUID references** (e.g., `a1b2c3d4`) that link to artifact files
- **Timestamps** to understand when things were discussed
- **Context** around the matched text

## Limitations

- Memory files don't exist until first append (check if file exists first)
- Private memory only contains user's private conversations
- Shared memory contains all group/shared conversations
