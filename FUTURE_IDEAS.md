# Future Ideas for Andee

A collection of enhancement ideas for the Andee Telegram bot.

---

## 1. Smarter Weather Clothing Recommendations

**STATUS: IMPLEMENTED** - See `claude-sandbox-worker/.claude/skills/weather/SKILL.md`

**Problem**: The current weather report bases clothing recommendations on general temperature ranges, but doesn't account for:
- Scarf recommendations in cold weather
- The temperatures you'll actually experience during your day

**Proposed Enhancement**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Current Logic                    │  Proposed Logic                    │
├───────────────────────────────────┼────────────────────────────────────┤
│  Uses current temp or daily       │  Find coldest temp between        │
│  range for layer count            │  8:00 AM and 10:00 PM             │
│                                   │  (your actual waking/outside hours)│
│                                   │                                    │
│  No scarf recommendation          │  If coldest temp < 5°C:           │
│                                   │    → Recommend wearing a scarf    │
└───────────────────────────────────┴────────────────────────────────────┘
```

**Why 8:00 AM - 10:00 PM?**
When getting ready in the morning, you care about the coldest temperature during your active day:
- Not the 4 AM overnight low (you're asleep)
- Not the 11 PM late night low (you're home by then)

**Example scenario** (from screenshot):
- Boston: -6.1°C to -1.9°C range
- Current recommendation: "2-3 layers and a jacket"
- Missing: Scarf recommendation (it's well below 5°C!)

**Proposed clothing logic**:

| Coldest Temp (8 AM - 10 PM) | Layers | Scarf? |
|-----------------------------|--------|--------|
| > 15°C                  | 1      | No     |
| 10°C - 15°C             | 1-2    | No     |
| 5°C - 10°C              | 2      | No     |
| 0°C - 5°C               | 2-3    | Yes    |
| -10°C - 0°C             | 3+     | Yes    |
| < -10°C                 | 3+ (heavy) | Yes |

**Implementation location**: `claude-sandbox-worker/.claude/skills/weather/SKILL.md`

---

## 2. Two-Message Weather Response Flow

**Problem**: Currently the weather response is a single message that gets edited as it streams. The "View Full Weather Report" button appears in the same message as the executive summary. This means:
- User waits for the full Mini App to be ready before seeing anything useful
- The message keeps getting edited/updated

**Proposed Enhancement**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CURRENT FLOW (Single Message)                                         │
│                                                                         │
│  User: "What's the weather?"                                           │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────┐                               │
│  │ [Streaming/editing single message]  │                               │
│  │ Executive summary + details         │                               │
│  │ [View Full Weather Report] button   │  ← Everything in one message  │
│  └─────────────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  PROPOSED FLOW (Two Messages)                                          │
│                                                                         │
│  User: "What's the weather?"                                           │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────┐                               │
│  │ **Bundle up today! -6°C to -2°C**   │  ← Message 1: FAST            │
│  │ ❄️ Light snow → ☁️ Overcast          │     Sent immediately          │
│  │ **Wear 3 layers + scarf!**          │     Never edited after        │
│  │                                     │                               │
│  │ It's quite cold in Boston today...  │                               │
│  └─────────────────────────────────────┘                               │
│                                                                         │
│           │  (brief pause while Mini App generates)                    │
│           ▼                                                             │
│  ┌─────────────────────────────────────┐                               │
│  │ [View Full Weather Report]          │  ← Message 2: Separate        │
│  └─────────────────────────────────────┘     New message with button   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Benefits**:
1. **Faster perceived response** - User gets the actionable info (temp, clothing) immediately
2. **Stable reading experience** - First message doesn't jump around as it edits
3. **Clear separation** - Executive summary is its own artifact; rich report is optional
4. **Better UX** - The text summary is what most users need; Mini App is a bonus

**Implementation notes**:
- Weather skill should output the executive summary FIRST, then separately trigger the Mini App
- Bot needs to send two separate messages instead of editing one
- First message: Text only (no inline keyboard)
- Second message: Just the button (with inline keyboard)

**Implementation locations**:
- `claude-sandbox-worker/.claude/skills/weather/SKILL.md` - Skill instructions
- `claude-telegram-bot/src/index.ts` - Message handling logic

---

## 3. Weather Response Polish (Cleanup)

**STATUS: IMPLEMENTED** - See `claude-sandbox-worker/.claude/skills/weather/SKILL.md`

**Current issues visible in screenshot**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ❌ CURRENT (Scuffed)                                                   │
│                                                                         │
│  "Now let me create a proper weather report with all the details:"     │
│                                         ↑                               │
│                         This preamble shouldn't be shown to user!       │
│                                                                         │
│  **Bundle up today! Ranging -6.1°C to -1.9°C (21°F to 29°F).**         │
│  ❄️ Light snow (early morning) → ☁️ Overcast (afternoon & evening).     │
│  ...                                                                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ✅ DESIRED (Clean)                                                     │
│                                                                         │
│  **Bundle up today! Ranging -6.1°C to -1.9°C (21°F to 29°F).**         │
│  ❄️ Light snow (early morning) → ☁️ Overcast (afternoon & evening).     │
│  **Dress warm with 3 layers and a scarf - it feels like -7°C!**        │
│                                                                         │
│  It's quite cold in Boston today...                                    │
│                         ↑                                               │
│         Jump straight into the report, no "let me..." preamble         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Fix**: Update the weather skill instructions to tell Claude to respond DIRECTLY with the weather summary - no conversational preamble like "Let me...", "Now I'll...", "Here's...", etc.

**Implementation location**: `claude-sandbox-worker/.claude/skills/weather/SKILL.md`

---

## 4. Use Message Reactions Instead of "..." Typing Indicator

**STATUS: IMPLEMENTED** - See `claude-telegram-bot/src/index.ts`

**Problem**: When you send a message to Andee, the bot responds with "..." to show it's processing. This:
- Clutters the chat with a placeholder message
- Gets edited/deleted later, causing visual jumping
- Feels like unnecessary noise

**Proposed Enhancement**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CURRENT FLOW                                                          │
│                                                                         │
│  You: "What's the weather?"                                            │
│                                                                         │
│  Andee: "..."              ← Placeholder message (clutters chat)       │
│  Andee: "..." (edited to show response)                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  PROPOSED FLOW                                                         │
│                                                                         │
│  You: "What's the weather?" 👀   ← React with eyes emoji               │
│                              ↑                                          │
│                     Shows "I saw it, working on it"                    │
│                                                                         │
│  Andee: [actual response]    ← First message IS the response           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Benefits**:
1. **Cleaner chat history** - No "..." messages to delete/edit
2. **Clear acknowledgment** - 👀 on YOUR message = "I saw this"
3. **Less visual noise** - No jumping/editing of placeholder messages
4. **More natural** - Like how humans react to messages in group chats

**Telegram API**: Use `setMessageReaction` method to add 👀 emoji reaction to the user's incoming message.

**Implementation location**: `claude-telegram-bot/src/index.ts` - Message handler

---

## 5. Recipe Management System

**Goal**: Track recipes you want to make, ones you've made and loved, and manage your personal recipe collection through Andee.

**Proposed Features**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RECIPE MANAGEMENT                                                     │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  📋 WANT TO     │  │  ⭐ FAVORITES   │  │  📖 ALL RECIPES │         │
│  │     MAKE        │  │                 │  │                 │         │
│  │                 │  │  Recipes you    │  │  Full collection│         │
│  │  Queue of       │  │  made & loved   │  │  searchable     │         │
│  │  recipes to try │  │                 │  │                 │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Example Interactions**:

```
You: "Save this recipe for later: [link or recipe text]"
Andee: Added "Spicy Thai Basil Chicken" to your Want to Make list! 📋

You: "I made that Thai basil chicken - it was amazing!"
Andee: Moved to Favorites! ⭐ Any notes you want to add?

You: "What should I cook this weekend?"
Andee: You have 5 recipes in your Want to Make list:
       1. Spicy Thai Basil Chicken
       2. Homemade Ramen
       3. ...

You: "Show me my favorite pasta recipes"
Andee: [Lists favorites tagged with pasta]
```

**Data to Track per Recipe**:
- Name
- Source (URL, cookbook, etc.)
- Status: `want_to_make` | `made_once` | `favorite`
- Tags (cuisine, meal type, ingredients)
- Personal notes
- Date added / date last made
- Rating (optional)

**Potential Mini App**: Recipe browser/manager UI similar to weather report

**Implementation considerations**:
- Storage: Durable Objects SQL (already have infrastructure)
- Could parse recipes from URLs automatically
- Could integrate with grocery list feature later

**Implementation locations**:
- New skill: `claude-sandbox-worker/.claude/skills/recipes/SKILL.md`
- Storage schema in worker
- Optional Mini App: `apps/src/recipes/`

---

## 6. RAG-Powered Memory Search with Cloudflare AI Search

**Goal**: Give Andee the ability to semantically search its own memories, skills, recipes, and stored data using Cloudflare's AI Search over R2.

**Reference**: https://developers.cloudflare.com/ai-search/get-started/

**The Problem Today**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CURRENT: Andee's Memory is Siloed                                     │
│                                                                         │
│  R2 Bucket                                                             │
│  ├── memories/                                                         │
│  │   ├── 2024-01-15-conversation.md                                   │
│  │   ├── 2024-02-20-preferences.md                                    │
│  │   └── ... hundreds of files ...                                    │
│  ├── recipes/                                                          │
│  │   └── ...                                                           │
│  └── skills/                                                           │
│      └── ...                                                           │
│                                                                         │
│  ❌ No way to ask "What did we talk about re: that pasta recipe?"      │
│  ❌ Can't find relevant context without knowing exact file names       │
│  ❌ Skills/memories not discoverable by semantic meaning               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Proposed Solution**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  WITH CLOUDFLARE AI SEARCH                                             │
│                                                                         │
│  ┌──────────┐      ┌─────────────────┐      ┌──────────────────┐       │
│  │   R2     │ ───► │  AI Search      │ ───► │  Vector Index    │       │
│  │  Bucket  │      │  (auto-indexes) │      │  (embeddings)    │       │
│  └──────────┘      └─────────────────┘      └──────────────────┘       │
│                                                    │                    │
│                                                    ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  You: "What was that Italian recipe we talked about?"        │      │
│  │                                                              │      │
│  │  Andee: [searches memories semantically]                     │      │
│  │         "Found it! On Jan 15 you saved a Cacio e Pepe       │      │
│  │          recipe from Bon Appétit. You noted it was          │      │
│  │          'perfect for weeknights'. Want me to pull it up?"  │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**What Gets Indexed**:
- Conversation memories / transcripts
- Saved recipes (name, notes, source)
- User preferences learned over time
- Skill definitions (so Andee knows what it can do)
- Any other structured data in R2

**Benefits**:
1. **Semantic search** - Find by meaning, not just keywords
2. **Auto-indexing** - AI Search watches R2, indexes new files automatically
3. **Unified memory** - One search across all Andee's knowledge
4. **Better context** - Pull relevant memories into conversations
5. **Skill discovery** - "Can you help me with X?" → finds relevant skill

**Example Use Cases**:

```
"Remember when I said I don't like cilantro?"
→ Searches preferences, finds dietary note

"What recipes have I been meaning to try?"
→ Searches recipes with status=want_to_make

"How do you do the weather thing again?"
→ Searches skills, explains weather feature
```

**Implementation**:
1. Enable AI Search on existing R2 bucket
2. Configure which paths to index (`memories/`, `recipes/`, `skills/`)
3. Create a `search_memory` tool for Andee to call
4. Worker calls AI Search API, returns relevant chunks

**Implementation locations**:
- Cloudflare dashboard: Enable AI Search on R2 bucket
- `claude-sandbox-worker/src/index.ts` - Add search endpoint
- New skill: `claude-sandbox-worker/.claude/skills/memory-search/SKILL.md`

---

## 7. Persistent Message History in R2 (Markdown Format)

**Goal**: Store all conversation history in a structured, human-readable Markdown format in R2, making it available to the agent and searchable via AI Search.

**Proposed Structure**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  R2: andee-memory/conversations/                                       │
│                                                                         │
│  conversations/                                                         │
│  ├── 2024-01-15.md                                                     │
│  ├── 2024-01-16.md                                                     │
│  ├── 2024-01-17.md                                                     │
│  └── ...                                                                │
│                                                                         │
│  Each file = one day of conversation history                           │
└─────────────────────────────────────────────────────────────────────────┘
```

**File Format** (`2024-01-15.md`):

```markdown
# Conversation History - January 15, 2024

## 09:23 AM

**You**: What's the weather today?

**Andee**: Bundle up today! It's -6°C to -2°C with light snow...

---

## 11:45 AM

**You**: Save this recipe for later: [link]

**Andee**: Added "Spicy Thai Basil Chicken" to your Want to Make list!

---

## 03:12 PM

**You**: What did we talk about this morning?

**Andee**: This morning you asked about the weather (cold, -6°C)
and saved a Thai Basil Chicken recipe.

---
```

**Benefits**:
1. **Human-readable** - Can browse history directly in R2 console or download
2. **Date-organized** - Easy to find conversations from specific days
3. **AI Search compatible** - Indexed automatically for semantic search
4. **Agent accessible** - Andee can read past conversations for context
5. **Portable** - Standard Markdown, not locked into any format

**How It Works**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  User message ──► Bot receives ──► Append to today's .md file in R2    │
│                                                                         │
│  Andee response ──► Bot sends ──► Append to today's .md file in R2     │
│                                                                         │
│  AI Search auto-indexes ──► Searchable via RAG (Idea #6)               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation locations**:
- `claude-telegram-bot/src/index.ts` - Append messages to R2 after send/receive
- R2 bucket structure: `conversations/YYYY-MM-DD.md`

---

## 8. Automated R2 Backup (AI Safety Net)

**Goal**: Every 30 minutes, snapshot the entire production R2 bucket to a separate backup bucket. Protection against accidental AI modifications or deletions.

**The Risk**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI agents can write/delete files in R2                                │
│                                                                         │
│  Potential accidents:                                                   │
│  • Overwrites important memory file                                    │
│  • Deletes recipes by mistake                                          │
│  • Corrupts conversation history                                       │
│  • Misunderstands command, wipes folder                                │
│                                                                         │
│  Without backups: 😱 Data lost forever                                 │
│  With backups: 😌 Restore from 30 min ago                              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Proposed Architecture**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────────────┐         ┌─────────────────────────────────────┐   │
│  │  PRODUCTION     │         │  BACKUP BUCKET                      │   │
│  │  R2 Bucket      │         │  (andee-backup)                     │   │
│  │                 │  every  │                                     │   │
│  │  andee-memory/  │  30 min │  snapshots/                         │   │
│  │  ├── convos/    │ ──────► │  ├── 2024-01-15T09-00-00/          │   │
│  │  ├── recipes/   │         │  │   └── [full copy]                │   │
│  │  ├── prefs/     │         │  ├── 2024-01-15T09-30-00/          │   │
│  │  └── skills/    │         │  │   └── [full copy]                │   │
│  └─────────────────┘         │  ├── 2024-01-15T10-00-00/          │   │
│                              │  │   └── [full copy]                │   │
│         ↑                    │  └── ...                            │   │
│         │                    └─────────────────────────────────────┘   │
│    AI writes here                                                      │
│    (risky)                   AI has NO write access here (safe)        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Retention Policy**:
- Keep last 48 hours of 30-min snapshots (96 snapshots)
- Keep daily snapshots for last 30 days
- Keep weekly snapshots for last 6 months
- Prune older snapshots automatically

**Implementation Options**:

1. **Cloudflare Worker Cron** (recommended)
   - Cron trigger every 30 minutes
   - Worker lists all objects in prod bucket
   - Copies each to backup bucket with timestamp prefix

2. **R2 Event Notifications + Queue**
   - Trigger on every write to prod bucket
   - Queue processes and copies to backup

**Recovery Process**:
```
"Andee deleted my recipes by accident!"

1. List snapshots: `r2 ls andee-backup/snapshots/`
2. Find last good snapshot: `2024-01-15T09-30-00/`
3. Restore: Copy files back to production bucket
```

**Implementation locations**:
- New Worker: `claude-backup-worker/` with cron trigger
- `wrangler.toml`: `[triggers] crons = ["*/30 * * * *"]`
- Backup bucket: Create `andee-backup` R2 bucket (separate from prod)

---

## 9. Group Chat Support

**Goal**: Allow Andee to participate in Telegram group chats, not just 1:1 DMs.

**Current State**: Andee only works in direct messages.

**Proposed Behavior**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GROUP CHAT: "Roommates"                                               │
│                                                                         │
│  Alice: hey what should we cook tonight?                               │
│                                                                         │
│  Bob: no idea, @Andee any suggestions?                                 │
│              ↑                                                          │
│        Mention triggers response                                        │
│                                                                         │
│  Andee: Based on your saved recipes, you have 3 in your "want to       │
│         make" list! The Thai Basil Chicken is quick (~30 min).         │
│                                                                         │
│  Alice: @Andee what's the weather like tomorrow?                       │
│                                                                         │
│  Andee: Tomorrow in Boston: 2°C to 8°C, mostly cloudy...               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Trigger Options**:
1. **@mention** - Only respond when explicitly mentioned (`@Andee`)
2. **Reply** - Respond when someone replies to Andee's message
3. **Keyword** - Respond to messages starting with "Andee," or "Hey Andee"
4. **All messages** (opt-in) - Respond to everything (noisy, probably not default)

**Considerations**:
- **Privacy**: Group members share context? Or per-user memory?
- **Rate limiting**: Don't spam the group
- **Permissions**: Bot needs to be added to group with appropriate permissions
- **Context**: Should Andee read previous group messages for context?

**Implementation locations**:
- `claude-telegram-bot/src/index.ts` - Handle group message events
- Grammy middleware to detect mentions/replies
- Possibly separate container per group (or shared?)

---

## 10. `/implement-s` Slash Command for End-to-End Feature Development

**STATUS: IMPLEMENTED** - See `.claude/skills/implement-s/SKILL.md`

**Goal**: Create a Claude Code skill that handles implementing new Andee features from start to finish, with all the right context, testing reminders, and links to relevant skills baked in.

**Usage**:

```
/implement Add a reminder system where users can ask Andee to remind them about things at specific times
```

**What the Skill Provides**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  /implement <feature description>                                      │
│                                                                         │
│  Automatically injects:                                                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  CONTEXT                                                        │   │
│  │  • Link to andee-dev skill (how to add skills/mini apps)       │   │
│  │  • Link to andee-ops skill (how to test/deploy)                │   │
│  │  • Architecture overview from CLAUDE.md                         │   │
│  │  • Current skills list for reference                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  IMPLEMENTATION CHECKLIST                                       │   │
│  │  □ Plan the feature (ask clarifying questions)                 │   │
│  │  □ Identify what needs to change (skill? worker? bot? app?)    │   │
│  │  □ Implement the changes                                        │   │
│  │  □ Test locally with curl commands                             │   │
│  │  □ Test via Telegram (real device)                             │   │
│  │  □ Update CLAUDE.md if architecture changed                    │   │
│  │  □ Add to FUTURE_IDEAS.md if follow-up work identified         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  TESTING REMINDERS                                              │   │
│  │  • curl http://localhost:8787/ (health check)                  │   │
│  │  • curl -X POST http://localhost:8787/ask-telegram ...         │   │
│  │  • Check container logs for errors                             │   │
│  │  • Test cold start AND warm path                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Example Flow**:

```
You: /implement Add a grocery list feature that integrates with recipes

Claude Code:
  1. Reads the skill, gets all context injected
  2. Asks clarifying questions (storage? sharing? categories?)
  3. Plans implementation across skill + worker + possibly mini app
  4. Implements incrementally, testing each piece
  5. Runs through checklist before marking complete
  6. Suggests follow-up improvements for FUTURE_IDEAS.md
```

**Benefits**:
- **Consistency** - Every feature follows same process
- **No forgotten steps** - Testing, docs, follow-ups all prompted
- **Context loaded** - Don't need to manually point to skills/docs
- **Faster iteration** - One command kicks off full workflow

**Implementation location**: `.claude/skills/implement/SKILL.md`

---

## 11. Custom System Prompt for Andee (Override Agent SDK Default)

**Problem**: Andee currently uses the default Claude Code Agent SDK system prompt, which causes identity confusion:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CURRENT BEHAVIOR (Confused Identity)                                  │
│                                                                         │
│  User: "Hey, what can you do?"                                         │
│                                                                         │
│  Andee: "I'm Claude Code, an AI assistant made by Anthropic.           │
│          I can help you with software engineering tasks..."            │
│                    ↑                                                    │
│          Wrong! Should identify as Andee, a Telegram bot               │
│                                                                         │
│  User: "How do I use you?"                                             │
│                                                                         │
│  Andee: "You can use slash commands like /help, or run me              │
│          from your terminal..."                                        │
│                    ↑                                                    │
│          Wrong! This is Telegram, not a CLI                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Proposed Solution**: Override the system prompt when initializing the Agent SDK to give Andee its own identity and context.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DESIRED BEHAVIOR (Clear Identity)                                     │
│                                                                         │
│  User: "Hey, what can you do?"                                         │
│                                                                         │
│  Andee: "I'm Andee, your personal Telegram assistant! I can:           │
│          • Give you weather reports with clothing recommendations      │
│          • Save and manage your recipes                                │
│          • Remember things about you across conversations              │
│          • Search the web and fetch information                        │
│          • Create files and run code in my sandbox                     │
│          Just message me naturally!"                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Custom System Prompt Should Include**:

1. **Identity**: "You are Andee, a personal assistant Telegram bot"
2. **Platform context**: "Users interact with you via Telegram messages"
3. **Capabilities**: List of skills (weather, recipes, memory, web search, etc.)
4. **Personality**: Friendly, concise, helpful (not overly formal)
5. **Constraints**:
   - Don't mention being Claude Code or a CLI tool
   - Don't suggest terminal commands to the user
   - Keep responses Telegram-friendly (not too long)
6. **Mini Apps**: Explain that you can provide rich UI via buttons

**Agent SDK Configuration**:

```typescript
// In PERSISTENT_SERVER_SCRIPT or agent initialization
const session = await claude.startSession({
  systemPrompt: `You are Andee, a personal assistant Telegram bot...`
  // or however the Agent SDK accepts custom prompts
});
```

**Real Examples of the Problem** (from testing):

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User: "Testing to find my ID"                                         │
│                                                                         │
│  Andee (WRONG - thinks it's Claude Code):                              │
│  "I can help you find your ID in a few different ways:                 │
│   1. If you're looking for a system user ID: I can run commands        │
│      like whoami or id to show your username and system IDs            │
│   2. If you're looking for an ID in a specific application...          │
│   3. If you're looking for something in your codebase..."              │
│                                                                         │
│  Then it ACTUALLY RUNS whoami and returns:                             │
│  "Username: claude, User ID (UID): 1000, Group ID (GID): 1000"         │
│                     ↑                                                   │
│         This is the container's user, not the Telegram user!           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  CORRECT behavior for a personal assistant:                            │
│                                                                         │
│  "I'm not sure what you mean by finding your ID. Is there something    │
│   else I can help you with? I can check the weather, help with         │
│   recipes, or answer questions!"                                       │
│                                                                         │
│  OR simply:                                                             │
│  "I don't have access to any IDs or system information. What else      │
│   can I help you with?"                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key behaviors to fix**:
- Don't offer to run terminal commands like `whoami`, `id`, `grep`
- Don't talk about "your codebase" or "your system"
- Don't expose container internals (UID 1000, user "claude")
- Don't talk about Telegram IDs, user IDs, or any technical IDs
- Don't try to be "helpful" with technical/system questions - just deflect
- DO act like a friendly personal assistant (weather, recipes, reminders)
- DO say "I don't understand" for nonsensical/technical questions

**The vibe**: Andee is like texting a helpful friend, not a technical CLI tool. A friend wouldn't know your "user ID" or offer to run `whoami`. They'd just say "what do you mean?" and move on.

**Implementation notes**:
- Research Agent SDK API for system prompt customization
- May need to prepend to existing prompt or fully replace
- Test that tools/skills still work with custom prompt
- Explicitly tell it NOT to discuss IDs, system info, technical internals

**Implementation location**: `claude-sandbox-worker/src/index.ts` (PERSISTENT_SERVER_SCRIPT)

---

## 12. Hide API Keys in Bash Commands (Use Environment Variables)

**Problem**: When Claude Code runs curl commands to test endpoints, the API key is exposed directly in the command, making it visible in:
- Terminal output/screenshots
- Bash history (`~/.bash_history`)
- Claude Code conversation logs
- Screen recordings or demos

**Current (Insecure)**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  $ curl -s -X POST https://claude-sandbox-worker.../reset \            │
│      -H "Content-Type: application/json" \                              │
│      -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \  ← EXPOSED!│
│      -d '{"chatId":"test-direct-link"}'                                 │
│                                                                         │
│  Anyone who sees this command (screenshot, history, logs) has the key  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Proposed (Secure)**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  $ curl -s -X POST https://claude-sandbox-worker.../reset \            │
│      -H "Content-Type: application/json" \                              │
│      -H "X-API-Key: $ANDEE_API_KEY" \                        ← SAFE!   │
│      -d '{"chatId":"test-direct-link"}'                                 │
│                                                                         │
│  Key is read from environment variable, never appears in output        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation Approach**:

1. **Update CLAUDE.md** - Tell Claude Code to ALWAYS use `$ANDEE_API_KEY` in example commands, never literal values

2. **Update andee-ops skill** - Same instruction for deployment/testing commands

3. **Update implement-s skill** - Remind to use env vars when testing

4. **Load .env in shell session** - Ensure `.env` file variables are exported when starting development:
   ```bash
   # In .envrc (direnv) or shell profile
   export $(cat claude-sandbox-worker/.dev.vars | xargs)
   ```

**Example fix in CLAUDE.md**:

```markdown
# Before (insecure)
curl -X POST http://localhost:8787/reset \
  -H "X-API-Key: adk_your_key_here" \
  -d '{"chatId":"test"}'

# After (secure)
curl -X POST http://localhost:8787/reset \
  -H "X-API-Key: $ANDEE_API_KEY" \
  -d '{"chatId":"test"}'
```

**Key insight**: Claude Code already knows the key (it's in `.dev.vars`), so there's no reason to paste it literally into commands. Just reference the env var.

**Implementation locations**:
- `CLAUDE.md` - Update all curl examples to use `$ANDEE_API_KEY`
- `.claude/skills/andee-ops/SKILL.md` - Same
- `.claude/skills/implement-s/SKILL.md` - Same
- Optional: Add `direnv` or shell hook to auto-load env vars

---

*Add new ideas below this line*
