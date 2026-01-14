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

Memory is stored in R2 (mounted at `/media`) by chat ID:

```
/media/conversation-history/{chatId}/memory.mv2   # All chats (private and group)
```

Note: For private chats, chatId equals the user's Telegram ID.
For group chats, chatId is the group's negative ID (e.g., `-1003285272358`).

## Getting Context

The chat ID is available in the context file. Read it with:

```bash
CHAT_ID=$(jq -r .chatId /tmp/protected/telegram_context/context.json)
```

**Always read context first** before searching memory.

## Memvid CLI Commands

### Search Conversation Memory

```bash
# First, get the chat ID from context
CHAT_ID=$(jq -r .chatId /tmp/protected/telegram_context/context.json)

# Search this chat's memory
memvid find /media/conversation-history/$CHAT_ID/memory.mv2 --query "pasta recipe" --mode hybrid
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

1. **Read context first**:
   ```bash
   CHAT_ID=$(jq -r .chatId /tmp/protected/telegram_context/context.json)
   ```
2. **Build memory file path**: `/media/conversation-history/$CHAT_ID/memory.mv2`
3. **Start with hybrid mode** for best recall
4. **If no results**, try:
   - Different keywords
   - `sem` mode for conceptual matches
   - `lex` mode for exact phrases

## Example Usage

```bash
# First, always get chat ID from context
CHAT_ID=$(jq -r .chatId /tmp/protected/telegram_context/context.json)

# User asks: "What was that Italian recipe we discussed?"
memvid find /media/conversation-history/$CHAT_ID/memory.mv2 --query "Italian recipe" --mode hybrid

# User asks: "Remember my secret family recipe?"
memvid find /media/conversation-history/$CHAT_ID/memory.mv2 --query "secret family recipe" --mode hybrid

# User asks: "Find conversations about the budget"
memvid find /media/conversation-history/$CHAT_ID/memory.mv2 --query "budget" --mode lex
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
- Each chat has its own isolated memory file
- Memory is stored in R2 (mounted at `/media`) and persists across container restarts
