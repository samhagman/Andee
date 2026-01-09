# Andee Memory Architecture
## Conversation-First Memory with File-Based Artifacts

---

## Overview

Andee is a Claude agent running in Cloudflare's sandbox environment. This document outlines the memory architecture that gives Andee persistent, searchable memory across conversations while maintaining a file-first approach where all artifacts (recipes, lists, notes, etc.) are stored as human-readable files in the sandbox filesystem.

### Core Principles

1. **Conversation history is the memory** — Memvid stores append-only conversation logs with hybrid search
2. **Artifacts are flat files** — Recipes, lists, etc. are markdown files with YAML frontmatter
3. **Shared by default** — All artifacts go to `shared/` unless explicitly marked as "secret" or "private"
4. **UUIDs link conversations to artifacts** — Every created file has a UUID that appears in conversation history
5. **MENU.JSON tracks schema & vocabulary** — Single file at `lists/` level containing all artifact types, their schemas, and vocabulary values with descriptions
6. **Sub-agent with structured output** — Artifact creation uses a sub-agent that receives vocabularies and returns content + metadata + any new vocabulary values
7. **Vocabulary auto-updates** — When AI creates new tags, it provides descriptions that get added to MENU.JSON automatically
8. **Automatic R2 snapshots** — The sandbox filesystem is automatically snapshotted to R2
9. **AI Search for cross-file semantic search** — Cloudflare AI Search indexes the latest R2 snapshot

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTION                               │
│                     (Alice, Bob, or shared "us" context)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ANDEE AGENT (Claude)                              │
│                     Running in Cloudflare Sandbox                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Agent SDK Tools                              │    │
│  │  • read/write files    • bash commands    • conversation append     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐
│   MEMVID (.mv2)       │ │  SANDBOX FILESYSTEM│ │   CLOUDFLARE AI SEARCH   │
│   Conversation Memory │ │  Artifact Storage  │ │   Cross-File Semantic    │
│                       │ │                    │ │                          │
│ • Hybrid search       │ │ /home/claude/       │ │ • Indexes R2 snapshots   │
│ • Append-only         │ │ ├── memories/      │ │ • Semantic search        │
│ • Per-user + shared   │ │ │   ├── alice.mv2  │ │ • ~30ms latency          │
│ • Sub-5ms retrieval   │ │ │   ├── bob.mv2    │ │ • Auto-reindex           │
│                       │ │ │   └── shared.mv2 │ │                          │
│ alice.mv2             │ │ ├── shared/        │ │ Points to:               │
│ bob.mv2               │ │ │   └── lists/     │ │ r2://andee-snapshots/    │
│ shared.mv2            │ │ │       ├── MENU.JSON   │     latest/           │
│                       │ │ │       ├── recipes/                            │
│                       │ │ │       │   ├── pasta-carbonara-a1b2.md         │
│                       │ │ │       │   └── thai-curry-c3d4.md              │
│                       │ │ │       ├── grocery/                            │
│                       │ │ │       │   └── weekly-groceries-e5f6.md        │
│                       │ │ │       └── movies/                             │
│                       │ │ │           └── to-watch-g7h8.md                │
│                       │ │ └── secret/        │ │                          │
│                       │ │     └── alice/     │ │                          │
│                       │ │         └── lists/ │ │                          │
│                       │ │             ├── MENU.JSON                       │
│                       │ │             └── ...│ │                          │
└───────────────────────┘ └────────┬───────────┘ └───────────────────────────┘
                                   │
                                   ▼ (automatic)
                          ┌───────────────────┐
                          │   R2 SNAPSHOTS    │
                          │                   │
                          │ andee-snapshots/  │
                          │ ├── latest/       │◄── AI Search indexes this
                          │ ├── 2026-01-06/   │
                          │ └── ...           │
                          └───────────────────┘
```

---

## Component Details

### 1. Memvid Conversation Memory

**Purpose**: Store all conversation history with hybrid search capability.

**Why Memvid makes sense here**:
- Conversations are truly append-only — you never edit what was said
- Hybrid search (BM25 + semantic) helps find "that Italian recipe we talked about last week"
- Sub-5ms retrieval keeps Andee feeling fast
- Single portable .mv2 files per user/scope

**File Structure**:
```
/home/claude/memories/
├── alice.mv2          # Alice's private conversations
├── bob.mv2            # Bob's private conversations  
└── shared.mv2         # Conversations in "us" mode
```

**What gets stored** (each conversation turn):
```typescript
interface ConversationTurn {
  timestamp: number;
  user_id: 'alice' | 'bob' | 'shared';
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: {
    tool: string;
    input: Record<string, any>;
    output: string;
  }[];
  artifacts_created?: string[];   // UUIDs of files created this turn
  artifacts_referenced?: string[]; // UUIDs of files mentioned/read
}
```

**Appending to memory** (after each conversation turn):
```typescript
import { open } from '@memvid/sdk';

async function appendConversation(
  scope: 'alice' | 'bob' | 'shared',
  turn: ConversationTurn
) {
  const mem = await open(`/home/claude/memories/${scope}.mv2`);
  
  // Build searchable text from the turn
  const searchableText = buildSearchableText(turn);
  
  await mem.put({
    title: `${turn.role} @ ${new Date(turn.timestamp).toISOString()}`,
    label: 'conversation',
    text: searchableText,
    metadata: {
      timestamp: turn.timestamp,
      user_id: turn.user_id,
      role: turn.role,
      artifacts_created: turn.artifacts_created,
      artifacts_referenced: turn.artifacts_referenced
    }
  });
  
  await mem.commit();
}

function buildSearchableText(turn: ConversationTurn): string {
  let text = turn.content;
  
  // Include tool calls in searchable text so we can find
  // "when did I create that pasta recipe" by searching for
  // the tool output that includes the UUID
  if (turn.tool_calls) {
    for (const call of turn.tool_calls) {
      text += `\n[Tool: ${call.tool}]\n${JSON.stringify(call.input)}\n${call.output}`;
    }
  }
  
  return text;
}
```

**Searching conversation history**:
```typescript
async function searchConversations(
  userId: string,
  query: string,
  options: { mode?: 'lex' | 'sem' | 'hybrid'; k?: number } = {}
) {
  const scopes = getScopesForUser(userId); // ['alice', 'shared'] or ['bob', 'shared']
  
  const results = await Promise.all(
    scopes.map(async (scope) => {
      const mem = await open(`/home/claude/memories/${scope}.mv2`);
      return mem.find(query, { 
        k: options.k || 20, 
        mode: options.mode || 'hybrid' 
      });
    })
  );
  
  // Merge and sort by score
  return results.flatMap(r => r.hits).sort((a, b) => b.score - a.score);
}
```

---

### 2. Artifact Storage (Flat Files)

**Purpose**: Store recipes, lists, notes, and other artifacts as human-readable files.

**Key Design Decisions**:
1. **Shared by default** — Everything goes to `shared/` unless user explicitly says "secret" or "private"
2. **Organized by artifact type** — `shared/lists/recipes/`, `shared/lists/movies/`, etc.
3. **MENU.JSON at lists/ level** — Single file tracking schema and all known tag/metadata values for all artifact types

---

#### Directory Structure

```
/home/claude/
├── memories/
│   ├── alice.mv2
│   ├── bob.mv2
│   └── shared.mv2
├── shared/
│   └── lists/
│       ├── MENU.JSON                      # Schema + vocabularies for ALL shared artifact types
│       ├── recipes/
│       │   ├── pasta-carbonara-a1b2c3d4.md
│       │   ├── thai-green-curry-e5f6g7h8.md
│       │   └── chicken-tikka-i9j0k1l2.md
│       ├── movies/
│       │   ├── to-watch-m3n4o5p6.md
│       │   └── favorites-q7r8s9t0.md
│       ├── grocery/
│       │   └── weekly-groceries-u1v2w3x4.md
│       └── books/
│           └── reading-list-y5z6a7b8.md
└── secret/
    ├── alice/
    │   └── lists/
    │       ├── MENU.JSON                  # Schema + vocabularies for Alice's secret artifacts
    │       └── recipes/
    │           └── secret-family-recipe-c9d0e1f2.md
    └── bob/
        └── lists/
            ├── MENU.JSON                  # Schema + vocabularies for Bob's secret artifacts
            └── ...
```

**Path patterns**:
```
# Shared artifacts (default)
/home/claude/shared/lists/{artifact_type}/{name}-{uuid}.md

# Secret/private artifacts (explicit request only)
/home/claude/private/{owner}/lists/{artifact_type}/{name}-{uuid}.md

# MENU.JSON locations
/home/claude/shared/lists/MENU.JSON
/home/claude/private/{owner}/lists/MENU.JSON
```

---

#### MENU.JSON — Schema & Vocabulary Tracking

Each `lists/` folder has a single `MENU.JSON` file that serves as:
1. **Registry of all artifact types** — What kinds of lists exist (recipes, movies, grocery, etc.)
2. **Schema definitions** — What frontmatter fields are expected for each type
3. **Vocabulary registry** — All tag values ever used per type (prevents "italian" vs "italian-food" duplication)
4. **Searchability guide** — Tells Andee what can be queried with yq

**Example: `/home/claude/shared/lists/MENU.JSON`**
```json
{
  "description": "Shared lists for the household",
  "created_at": "2026-01-06T14:00:00Z",
  "last_updated": "2026-01-06T16:30:00Z",
  
  "artifact_types": {
    "recipes": {
      "description": "Recipes for cooking",
      "folder": "recipes",
      "schema": {
        "required": ["uuid", "type", "title", "created_at", "created_by", "status"],
        "optional": ["cuisine", "difficulty", "prep_time", "cook_time", "servings", "tags"]
      },
      "vocabularies": {
        "cuisine": {
          "description": "The cuisine or cultural origin of the recipe",
          "values": {
            "italian": "Italian cuisine - pasta, risotto, pizza, Mediterranean flavors",
            "thai": "Thai cuisine - curries, stir-fries, rice noodles, fish sauce, lime, chilies",
            "indian": "Indian cuisine - curries, dal, naan, rice dishes, complex spice blends",
            "mexican": "Mexican cuisine - tacos, enchiladas, beans, chilies, lime, cilantro",
            "japanese": "Japanese cuisine - sushi, ramen, teriyaki, miso, clean flavors",
            "french": "French cuisine - sauces, pastries, refined techniques",
            "american": "American cuisine - comfort food, BBQ, burgers, regional dishes",
            "chinese": "Chinese cuisine - stir-fries, dumplings, noodles, regional styles"
          }
        },
        "difficulty": {
          "description": "How hard the recipe is to make",
          "values": {
            "easy": "Simple recipes with few ingredients, minimal technique, under 30 min active time",
            "medium": "Moderate complexity, some technique required, 30-60 min active time",
            "hard": "Complex recipes requiring advanced techniques, multiple components, or 60+ min"
          }
        },
        "tags": {
          "description": "Flexible tags for categorization - can have multiple",
          "values": {
            "pasta": "Recipes featuring pasta as the main component",
            "quick": "Can be made in 30 minutes or less total time",
            "comfort-food": "Warm, satisfying, nostalgic dishes",
            "vegetarian": "No meat or fish (may contain dairy/eggs)",
            "vegan": "No animal products at all",
            "gluten-free": "No wheat, barley, rye, or gluten-containing ingredients",
            "spicy": "Contains significant heat from chilies or pepper",
            "healthy": "Lower calorie, nutritious, or whole-food focused",
            "dessert": "Sweet dishes and baked goods",
            "breakfast": "Morning meals and brunch dishes",
            "weeknight": "Practical for busy weeknight cooking",
            "meal-prep": "Good for batch cooking and storing"
          }
        }
      },
      "example_queries": [
        ".cuisine == \"italian\"",
        ".tags[] == \"vegetarian\"",
        ".difficulty == \"easy\" and .prep_time == \"10min\""
      ]
    },
    
    "movies": {
      "description": "Movies to watch or remember",
      "folder": "movies",
      "schema": {
        "required": ["uuid", "type", "title", "created_at", "created_by", "status"],
        "optional": ["genre", "year", "rating", "watched", "tags"]
      },
      "vocabularies": {
        "genre": {
          "description": "Primary movie genre",
          "values": {
            "action": "Action-focused films with stunts, fights, chases",
            "comedy": "Films primarily intended to make you laugh",
            "drama": "Character-driven emotional narratives",
            "horror": "Scary films intended to frighten",
            "sci-fi": "Science fiction - futuristic, space, technology themes",
            "documentary": "Non-fiction films about real subjects",
            "animation": "Animated films (any style)",
            "thriller": "Suspenseful, tension-building narratives"
          }
        },
        "rating": {
          "description": "Our personal rating after watching",
          "values": {
            "loved": "Absolutely loved it, would watch again, highly recommend",
            "liked": "Enjoyed it, glad we watched, solid recommendation",
            "meh": "It was okay, neither good nor bad",
            "disliked": "Did not enjoy, would not recommend"
          }
        },
        "watched": {
          "description": "Have we watched this movie?",
          "values": {
            "true": "We have watched this movie",
            "false": "We haven't watched this yet - it's on our list"
          }
        },
        "tags": {
          "description": "Flexible tags for categorization - can have multiple",
          "values": {
            "date-night": "Good for a romantic evening together",
            "family-friendly": "Appropriate and enjoyable for all ages",
            "mind-bending": "Complex plots, twists, makes you think",
            "classic": "Older films that are timeless",
            "foreign": "Non-English language films",
            "oscar-winner": "Won major Academy Awards"
          }
        }
      },
      "example_queries": [
        ".watched == false",
        ".genre == \"sci-fi\" and .rating == \"loved\""
      ]
    },
    
    "grocery": {
      "description": "Grocery and shopping lists",
      "folder": "grocery",
      "schema": {
        "required": ["uuid", "type", "title", "created_at", "created_by", "status"],
        "optional": ["store", "tags"]
      },
      "vocabularies": {
        "store": {
          "description": "Which store to shop at",
          "values": {
            "costco": "Costco - bulk items, good for stocking up",
            "trader-joes": "Trader Joe's - unique items, good prices, smaller quantities",
            "whole-foods": "Whole Foods - organic, specialty items, higher quality",
            "safeway": "Safeway - general grocery, convenient locations",
            "target": "Target - groceries plus household items"
          }
        },
        "tags": {
          "description": "Flexible tags for categorization",
          "values": {
            "weekly": "Regular weekly shopping list",
            "party": "Shopping for a party or gathering",
            "holiday": "Holiday-specific shopping",
            "staples": "Pantry staples to always keep stocked"
          }
        }
      },
      "example_queries": [
        ".store == \"costco\"",
        ".tags[] == \"weekly\""
      ]
    },
    
    "books": {
      "description": "Books to read or remember",
      "folder": "books",
      "schema": {
        "required": ["uuid", "type", "title", "created_at", "created_by", "status"],
        "optional": ["author", "genre", "rating", "read", "tags"]
      },
      "vocabularies": {
        "genre": {
          "description": "Book genre",
          "values": {
            "fiction": "Fictional narratives and novels",
            "non-fiction": "Factual books about real topics",
            "sci-fi": "Science fiction novels",
            "fantasy": "Fantasy worlds, magic, mythical creatures",
            "biography": "Life stories of real people",
            "self-help": "Personal development and improvement",
            "history": "Historical accounts and analysis",
            "mystery": "Mysteries and detective stories"
          }
        },
        "rating": {
          "description": "Our personal rating after reading",
          "values": {
            "loved": "Couldn't put it down, highly recommend",
            "liked": "Enjoyed reading, would recommend",
            "meh": "It was fine, nothing special",
            "disliked": "Did not enjoy, would not recommend"
          }
        },
        "read": {
          "description": "Have we read this book?",
          "values": {
            "true": "We have read this book",
            "false": "On our reading list, haven't started"
          }
        },
        "tags": {
          "description": "Flexible tags for categorization - can have multiple",
          "values": {
            "book-club": "Selected for or discussed in book club",
            "classic": "Classic literature, timeless works",
            "quick-read": "Can be finished quickly, light reading",
            "dense": "Complex, requires focus and time",
            "recommended": "Recommended by someone we trust"
          }
        }
      },
      "example_queries": [
        ".read == false",
        ".genre == \"sci-fi\""
      ]
    }
  }
}
```

**Key benefits of single MENU.JSON with value descriptions**:
- One place to see all artifact types that exist
- **Each vocabulary value has context** — AI understands what "quick" means vs "weeknight"
- Prevents duplicate/redundant tags (AI can see "vegetarian" exists before creating "veggie")
- Andee can list "what kinds of lists do we have?" by reading one file
- Vocabularies stay consistent within each type

---

#### Updating MENU.JSON

When Andee adds a new vocabulary value, it should update the MENU.JSON with the value AND its description:

```bash
#!/bin/bash
# /home/claude/scripts/update-menu-vocab.sh
#
# Adds a new value with description to a vocabulary in MENU.JSON
# Usage: update-menu-vocab.sh <artifact_type> <vocabulary> <new_value> <description> [secret]
# Example: update-menu-vocab.sh recipes cuisine korean "Korean cuisine - kimchi, BBQ, fermented flavors, gochujang"
# Example: update-menu-vocab.sh recipes tags keto "Ketogenic diet friendly - low carb, high fat" secret

ARTIFACT_TYPE=$1
VOCAB=$2
NEW_VALUE=$3
DESCRIPTION=$4
IS_SECRET=${5:-""}

if [ "$IS_SECRET" = "secret" ] && [ -n "$SENDER_ID" ]; then
  MENU_FILE="/home/claude/private/${SENDER_ID}/lists/MENU.JSON"
else
  MENU_FILE="/home/claude/shared/lists/MENU.JSON"
fi

# Check if value already exists
if jq -e ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}.values.\"${NEW_VALUE}\"" "$MENU_FILE" > /dev/null 2>&1; then
  echo "Value '${NEW_VALUE}' already exists in ${ARTIFACT_TYPE}.${VOCAB}"
  exit 0
fi

# Add the new value with its description and update timestamp
jq ".artifact_types.${ARTIFACT_TYPE}.vocabularies.${VOCAB}.values.\"${NEW_VALUE}\" = \"${DESCRIPTION}\" | .last_updated = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" \
  "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"

echo "Added '${NEW_VALUE}': '${DESCRIPTION}' to ${ARTIFACT_TYPE}.${VOCAB} vocabulary"
```

**Adding a new artifact type**:
```bash
#!/bin/bash
# /home/claude/scripts/add-artifact-type.sh
#
# Adds a new artifact type to MENU.JSON
# Usage: add-artifact-type.sh <type_name> <description>
# Example: add-artifact-type.sh restaurants "Restaurants to try or remember"

TYPE_NAME=$1
DESCRIPTION=$2
MENU_FILE="/home/claude/shared/lists/MENU.JSON"

# Check if type already exists
if jq -e ".artifact_types.${TYPE_NAME}" "$MENU_FILE" > /dev/null 2>&1; then
  echo "Artifact type '${TYPE_NAME}' already exists"
  exit 0
fi

# Add the new artifact type with default schema
jq ".artifact_types.${TYPE_NAME} = {
  \"description\": \"${DESCRIPTION}\",
  \"folder\": \"${TYPE_NAME}\",
  \"schema\": {
    \"required\": [\"uuid\", \"type\", \"title\", \"created_at\", \"created_by\", \"status\"],
    \"optional\": [\"tags\"]
  },
  \"vocabularies\": {
    \"tags\": {
      \"description\": \"Flexible tags for categorization\",
      \"values\": {}
    }
  },
  \"example_queries\": []
} | .last_updated = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" \
  "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"

# Create the folder
mkdir -p "/home/claude/shared/lists/${TYPE_NAME}"

echo "Added artifact type '${TYPE_NAME}'"
```

**Before adding a tag, Andee should check the MENU:**
```bash
# What cuisines are available? (keys are the values, values are descriptions)
jq -r '.artifact_types.recipes.vocabularies.cuisine.values | keys[]' /home/claude/shared/lists/MENU.JSON

# Get cuisine options with their descriptions (for prompting the AI)
jq '.artifact_types.recipes.vocabularies.cuisine.values' /home/claude/shared/lists/MENU.JSON

# What tags are available for recipes?
jq -r '.artifact_types.recipes.vocabularies.tags.values | keys[]' /home/claude/shared/lists/MENU.JSON
```

---

### Artifact Creation Workflow (Sub-Agent with Structured Output)

When a user asks Andee to create an artifact (e.g., "save this recipe"), Andee uses a **sub-agent pattern** with structured outputs to ensure consistent metadata and vocabulary management.

#### Overview Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. USER REQUEST                                                            │
│     "Save the pasta carbonara recipe we just discussed"                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. ANDEE DETERMINES ARTIFACT TYPE                                          │
│     → Reads MENU.JSON to see available types                                │
│     → Identifies this is a "recipe" artifact                                │
│     → Loads recipe schema and vocabularies                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. SUB-AGENT: GENERATE ARTIFACT (Structured Output)                        │
│     → Receives: conversation context + vocabularies with descriptions       │
│     → Generates: content + metadata selection + any new vocabulary values   │
│     → Returns: structured JSON with all artifact data                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. UPDATE MENU.JSON (if new vocabulary values)                             │
│     → If sub-agent created new tags/values, add them to MENU.JSON           │
│     → Each new value includes its description                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. CREATE ARTIFACT FILE                                                    │
│     → Generate UUID                                                         │
│     → Write markdown file with YAML frontmatter                             │
│     → Store in appropriate location (shared or secret)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. APPEND TO CONVERSATION MEMORY                                           │
│     → Log the creation with UUID reference                                  │
│     → Stored in Memvid for future retrieval                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

#### Step 1: Load Schema and Vocabularies

Before generating content, Andee loads the artifact type's schema and vocabularies from MENU.JSON:

```typescript
interface VocabularyWithDescriptions {
  description: string;
  values: Record<string, string>; // value -> description
}

interface ArtifactTypeSchema {
  description: string;
  folder: string;
  schema: {
    required: string[];
    optional: string[];
  };
  vocabularies: Record<string, VocabularyWithDescriptions>;
}

async function loadArtifactSchema(
  artifactType: string, 
  isSecret: boolean,
  userId?: string
): Promise<ArtifactTypeSchema> {
  const menuPath = isSecret 
    ? `/home/claude/private/${userId}/lists/MENU.JSON`
    : '/home/claude/shared/lists/MENU.JSON';
  
  const menu = JSON.parse(await fs.readFile(menuPath, 'utf-8'));
  return menu.artifact_types[artifactType];
}
```

---

#### Step 2: Sub-Agent Structured Output Schema

The sub-agent receives the vocabularies and returns structured data:

```typescript
// Input to the sub-agent
interface ArtifactGenerationInput {
  artifact_type: string;
  conversation_context: string;  // Relevant conversation history
  user_request: string;          // What the user asked for
  schema: ArtifactTypeSchema;    // From MENU.JSON
}

// Output from the sub-agent (structured output)
interface ArtifactGenerationOutput {
  // The actual content
  title: string;
  content: string;  // Markdown body of the artifact
  
  // Metadata using EXISTING vocabulary values
  metadata: {
    cuisine?: string;      // Must be from vocabularies.cuisine.values
    difficulty?: string;   // Must be from vocabularies.difficulty.values
    prep_time?: string;
    cook_time?: string;
    servings?: number;
    tags: string[];        // Each must be from vocabularies.tags.values OR new_vocabulary_values
    // ... other fields based on schema.optional
  };
  
  // NEW vocabulary values to add (if existing ones don't fit)
  new_vocabulary_values: {
    vocabulary_name: string;  // e.g., "cuisine", "tags"
    value: string;            // e.g., "korean"
    description: string;      // e.g., "Korean cuisine - kimchi, BBQ, fermented flavors"
  }[];
}
```

---

#### Step 3: Sub-Agent Prompt Template

```typescript
function buildArtifactGenerationPrompt(input: ArtifactGenerationInput): string {
  const { artifact_type, conversation_context, user_request, schema } = input;
  
  // Format vocabularies with descriptions for the AI
  const vocabContext = Object.entries(schema.vocabularies)
    .map(([vocabName, vocab]) => {
      const valuesWithDesc = Object.entries(vocab.values)
        .map(([value, desc]) => `    - "${value}": ${desc}`)
        .join('\n');
      return `
  ${vocabName} (${vocab.description}):
${valuesWithDesc}`;
    })
    .join('\n');

  return `You are creating a ${artifact_type} artifact based on a conversation.

## Conversation Context
${conversation_context}

## User Request
${user_request}

## Available Vocabularies
Use these existing values when they fit. Only create NEW values if none of the existing ones are appropriate.
${vocabContext}

## Schema
Required fields: ${schema.schema.required.join(', ')}
Optional fields: ${schema.schema.optional.join(', ')}

## Instructions
1. Generate the ${artifact_type} content in markdown format
2. Select appropriate metadata from the existing vocabularies
3. If you need a tag/value that doesn't exist, add it to new_vocabulary_values with a clear description
4. Prefer existing vocabulary values over creating new ones
5. Return your response as structured JSON matching the output schema`;
}
```

---

#### Step 4: Call Sub-Agent with Structured Output

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function generateArtifact(
  input: ArtifactGenerationInput
): Promise<ArtifactGenerationOutput> {
  const prompt = buildArtifactGenerationPrompt(input);
  
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
    // Use tool_use for structured output
    tools: [{
      name: "create_artifact",
      description: "Create an artifact with content and metadata",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the artifact" },
          content: { type: "string", description: "Markdown content body" },
          metadata: {
            type: "object",
            properties: {
              cuisine: { type: "string" },
              difficulty: { type: "string" },
              prep_time: { type: "string" },
              cook_time: { type: "string" },
              servings: { type: "number" },
              tags: { type: "array", items: { type: "string" } }
            },
            required: ["tags"]
          },
          new_vocabulary_values: {
            type: "array",
            items: {
              type: "object",
              properties: {
                vocabulary_name: { type: "string" },
                value: { type: "string" },
                description: { type: "string" }
              },
              required: ["vocabulary_name", "value", "description"]
            }
          }
        },
        required: ["title", "content", "metadata", "new_vocabulary_values"]
      }
    }],
    tool_choice: { type: "tool", name: "create_artifact" }
  });

  // Extract the tool use result
  const toolUse = response.content.find(block => block.type === "tool_use");
  return toolUse.input as ArtifactGenerationOutput;
}
```

---

#### Step 5: Update MENU.JSON with New Vocabulary Values

```typescript
async function updateMenuWithNewVocabulary(
  artifactType: string,
  newValues: ArtifactGenerationOutput['new_vocabulary_values'],
  isSecret: boolean,
  userId?: string
): Promise<void> {
  if (newValues.length === 0) return;
  
  const menuPath = isSecret 
    ? `/home/claude/private/${userId}/lists/MENU.JSON`
    : '/home/claude/shared/lists/MENU.JSON';
  
  const menu = JSON.parse(await fs.readFile(menuPath, 'utf-8'));
  
  for (const newVal of newValues) {
    const vocab = menu.artifact_types[artifactType].vocabularies[newVal.vocabulary_name];
    if (vocab && !vocab.values[newVal.value]) {
      vocab.values[newVal.value] = newVal.description;
      console.log(`Added new ${newVal.vocabulary_name} value: "${newVal.value}"`);
    }
  }
  
  menu.last_updated = new Date().toISOString();
  await fs.writeFile(menuPath, JSON.stringify(menu, null, 2));
}
```

---

#### Step 6: Create the Artifact File

```typescript
async function createArtifactFile(
  artifactType: string,
  output: ArtifactGenerationOutput,
  createdBy: string,
  isSecret: boolean
): Promise<{ filepath: string; uuid: string }> {
  const uuid = crypto.randomUUID();
  const slug = output.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  const scope = isSecret ? 'secret' : 'shared';
  const dir = isSecret 
    ? `/home/claude/private/${createdBy}/lists/${artifactType}`
    : `/home/claude/shared/lists/${artifactType}`;
  
  await fs.mkdir(dir, { recursive: true });
  
  const filepath = `${dir}/${slug}-${uuid.slice(0, 8)}.md`;
  
  // Build frontmatter
  const frontmatter = {
    uuid,
    type: artifactType,
    title: output.title,
    created_at: new Date().toISOString(),
    created_by: createdBy,
    scope,
    status: 'active',
    ...output.metadata
  };
  
  // Build file content
  const fileContent = `---
${Object.entries(frontmatter)
  .map(([k, v]) => {
    if (Array.isArray(v)) {
      return `${k}:\n${v.map(item => `  - ${item}`).join('\n')}`;
    }
    return `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
  })
  .join('\n')}
---

${output.content}`;

  await fs.writeFile(filepath, fileContent);
  
  return { filepath, uuid };
}
```

---

#### Complete Artifact Creation Orchestration

```typescript
async function createArtifact(
  artifactType: string,
  conversationContext: string,
  userRequest: string,
  createdBy: string,
  isSecret: boolean = false
): Promise<{ filepath: string; uuid: string; title: string }> {
  
  // 1. Load schema and vocabularies from MENU.JSON
  const schema = await loadArtifactSchema(artifactType, isSecret, createdBy);
  
  // 2. Generate artifact using sub-agent with structured output
  const output = await generateArtifact({
    artifact_type: artifactType,
    conversation_context: conversationContext,
    user_request: userRequest,
    schema
  });
  
  // 3. Update MENU.JSON with any new vocabulary values
  await updateMenuWithNewVocabulary(
    artifactType, 
    output.new_vocabulary_values, 
    isSecret, 
    createdBy
  );
  
  // 4. Create the artifact file
  const { filepath, uuid } = await createArtifactFile(
    artifactType,
    output,
    createdBy,
    isSecret
  );
  
  // 5. Return info for conversation memory
  return { filepath, uuid, title: output.title };
}

// Example usage
const result = await createArtifact(
  'recipes',
  'User discussed wanting to make a traditional Roman pasta dish...',
  'Save that carbonara recipe',
  'alice',
  false  // shared
);

console.log(`Created: ${result.filepath} (${result.uuid})`);
// Output: Created: /home/claude/shared/lists/recipes/pasta-carbonara-a1b2c3d4.md (a1b2c3d4-...)
```

---

#### Example: Sub-Agent Input and Output

**Input to sub-agent:**
```json
{
  "artifact_type": "recipes",
  "conversation_context": "User: I want to make pasta carbonara tonight. What do I need?\nAssistant: For a classic carbonara you'll need guanciale, eggs, pecorino romano, black pepper, and pasta like spaghetti or rigatoni. The key is...",
  "user_request": "Save that carbonara recipe",
  "schema": {
    "description": "Recipes for cooking",
    "vocabularies": {
      "cuisine": {
        "description": "The cuisine or cultural origin",
        "values": {
          "italian": "Italian cuisine - pasta, risotto, pizza, Mediterranean flavors",
          "thai": "Thai cuisine - curries, stir-fries, rice noodles..."
        }
      },
      "difficulty": {
        "description": "How hard the recipe is to make",
        "values": {
          "easy": "Simple recipes, under 30 min active time",
          "medium": "Moderate complexity, 30-60 min",
          "hard": "Complex, 60+ min"
        }
      },
      "tags": {
        "description": "Flexible tags for categorization",
        "values": {
          "pasta": "Recipes featuring pasta as main component",
          "quick": "Can be made in 30 minutes or less",
          "comfort-food": "Warm, satisfying, nostalgic dishes"
        }
      }
    }
  }
}
```

**Output from sub-agent:**
```json
{
  "title": "Pasta Carbonara",
  "content": "# Pasta Carbonara\n\nA classic Roman pasta dish...\n\n## Ingredients\n\n- 400g spaghetti or rigatoni\n- 200g guanciale...\n\n## Instructions\n\n1. Bring a large pot of salted water to boil...",
  "metadata": {
    "cuisine": "italian",
    "difficulty": "medium",
    "prep_time": "10min",
    "cook_time": "20min",
    "servings": 4,
    "tags": ["pasta", "comfort-food", "classic-roman"]
  },
  "new_vocabulary_values": [
    {
      "vocabulary_name": "tags",
      "value": "classic-roman",
      "description": "Traditional dishes from Rome, Italy - carbonara, cacio e pepe, amatriciana"
    }
  ]
}
```

**Result**: 
1. MENU.JSON updated with new "classic-roman" tag and its description
2. File created at `/home/claude/shared/lists/recipes/pasta-carbonara-a1b2c3d4.md`
3. Frontmatter includes all metadata
4. UUID logged to conversation memory

---

#### Artifact Update Workflow

When updating an existing artifact, the same pattern applies:

```typescript
async function updateArtifact(
  filepath: string,
  conversationContext: string,
  userRequest: string,
  updatedBy: string
): Promise<void> {
  // 1. Read existing artifact
  const existingContent = await fs.readFile(filepath, 'utf-8');
  const { data: existingFrontmatter, content: existingBody } = matter(existingContent);
  
  // 2. Load schema and vocabularies
  const artifactType = existingFrontmatter.type;
  const isSecret = existingFrontmatter.scope === 'secret';
  const schema = await loadArtifactSchema(artifactType, isSecret, updatedBy);
  
  // 3. Generate updated artifact (sub-agent sees existing content)
  const output = await generateArtifact({
    artifact_type: artifactType,
    conversation_context: `Existing artifact:\n${existingContent}\n\n${conversationContext}`,
    user_request: userRequest,
    schema
  });
  
  // 4. Update MENU.JSON with any new vocabulary values
  await updateMenuWithNewVocabulary(artifactType, output.new_vocabulary_values, isSecret, updatedBy);
  
  // 5. Update the file (preserve uuid, created_at, created_by)
  const updatedFrontmatter = {
    ...existingFrontmatter,
    ...output.metadata,
    title: output.title,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy
  };
  
  const updatedContent = `---
${yaml.stringify(updatedFrontmatter)}---

${output.content}`;

  await fs.writeFile(filepath, updatedContent);
}
```

---

#### Artifact Deletion Workflow

Soft delete updates the artifact and can add deletion-related metadata:

```typescript
async function deleteArtifact(
  filepath: string,
  deletedBy: string,
  reason?: string
): Promise<void> {
  const content = await fs.readFile(filepath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);
  
  // Soft delete - mark as deleted but keep file
  const updatedFrontmatter = {
    ...frontmatter,
    status: 'deleted',
    deleted_at: new Date().toISOString(),
    deleted_by: deletedBy,
    deletion_reason: reason
  };
  
  const updatedContent = `---
${yaml.stringify(updatedFrontmatter)}---

${body}`;

  await fs.writeFile(filepath, updatedContent);
}
```

---

#### Shared vs Secret Access Rules

**Default behavior**: Everything is shared unless the user explicitly says otherwise.

| User says... | Goes to... |
|-------------|------------|
| "Save this recipe" | `shared/lists/recipes/` |
| "Add to our movie list" | `shared/lists/movies/` |
| "Remember this grocery list" | `shared/lists/grocery/` |
| "Make a **secret** recipe for my surprise" | `secret/alice/lists/recipes/` |
| "Add to my **private** reading list" | `secret/alice/lists/books/` |
| "Update the **secret family** recipe" | `secret/alice/lists/recipes/` (looks for existing) |

**Key insight**: The word "secret" or "private" in the request triggers private storage. Otherwise, assume shared.

---

#### Artifact File Format

**File format** (Markdown with YAML frontmatter):
```markdown
---
uuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
type: recipe
title: Pasta Carbonara
created_at: 2026-01-06T14:30:00Z
created_by: alice
scope: shared
tags:
  - italian
  - pasta
  - quick
  - comfort-food
cuisine: italian
difficulty: medium
prep_time: 10min
cook_time: 20min
status: active
---

# Pasta Carbonara

A classic Roman pasta dish...

## Ingredients

- 400g spaghetti or rigatoni
- 200g guanciale (or pancetta)
- 4 egg yolks + 2 whole eggs
- 100g Pecorino Romano, finely grated
- Freshly ground black pepper

## Instructions

1. Bring a large pot of salted water to boil...
```

---

#### Creating an Artifact (Andee Skill)

```bash
#!/bin/bash
# /home/claude/scripts/create-artifact.sh
#
# Usage: create-artifact.sh <artifact_type> <name> <created_by> [secret]
# Examples:
#   create-artifact.sh recipes "Pasta Carbonara" alice
#   create-artifact.sh recipes "Secret Family Recipe" alice secret

ARTIFACT_TYPE=$1
NAME=$2
CREATED_BY=$3
IS_SECRET=${4:-""}  # Optional: pass "secret" for private

# Generate UUID
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Slugify name
SLUG=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

# Determine path based on secret flag
if [ "$IS_SECRET" = "secret" ]; then
  SCOPE="secret"
  DIR="/home/claude/private/${CREATED_BY}/lists/${ARTIFACT_TYPE}"
  LISTS_DIR="/home/claude/private/${CREATED_BY}/lists"
else
  SCOPE="shared"
  DIR="/home/claude/shared/lists/${ARTIFACT_TYPE}"
  LISTS_DIR="/home/claude/shared/lists"
fi

# Create directories if needed
mkdir -p "$DIR"

# Ensure MENU.JSON exists at lists/ level
MENU_FILE="${LISTS_DIR}/MENU.JSON"
if [ ! -f "$MENU_FILE" ]; then
  cat > "$MENU_FILE" << MENUJSON
{
  "description": "Lists and artifacts",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "last_updated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifact_types": {}
}
MENUJSON
fi

# Ensure this artifact type exists in MENU.JSON
if ! jq -e ".artifact_types.${ARTIFACT_TYPE}" "$MENU_FILE" > /dev/null 2>&1; then
  jq ".artifact_types.${ARTIFACT_TYPE} = {
    \"description\": \"${ARTIFACT_TYPE}\",
    \"folder\": \"${ARTIFACT_TYPE}\",
    \"schema\": {
      \"required\": [\"uuid\", \"type\", \"title\", \"created_at\", \"created_by\", \"status\"],
      \"optional\": [\"tags\"]
    },
    \"vocabularies\": {
      \"tags\": {
        \"description\": \"Flexible tags for categorization\",
        \"values\": {}
      }
    }
  } | .last_updated = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" "$MENU_FILE" > "${MENU_FILE}.tmp" && mv "${MENU_FILE}.tmp" "$MENU_FILE"
fi

# Create file path
FILEPATH="${DIR}/${SLUG}-${UUID:0:8}.md"

# Generate frontmatter
cat > "$FILEPATH" << EOF
---
uuid: ${UUID}
type: ${ARTIFACT_TYPE}
title: ${NAME}
created_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
created_by: ${CREATED_BY}
scope: ${SCOPE}
tags: []
status: active
---

# ${NAME}

EOF

# Return the path and UUID for the conversation log
echo "CREATED: ${FILEPATH}"
echo "UUID: ${UUID}"
echo "SCOPE: ${SCOPE}"
```

---

#### The UUID → Conversation → File Loop

```
1. User: "Save that carbonara recipe we just discussed"

2. Andee calls: create-artifact.sh recipes "Pasta Carbonara" alice
   Output: "CREATED: /home/claude/shared/lists/recipes/pasta-carbonara-a1b2c3d4.md"
           "UUID: a1b2c3d4-..."
           "SCOPE: shared"

3. Andee writes the recipe content to the file

4. Andee checks MENU.JSON for existing tags, adds "italian" to cuisine vocabulary if new

5. Andee responds: "I've saved the Pasta Carbonara recipe! 
                    (ref: a1b2c3d4)"

6. This entire exchange (including the UUID) is appended to shared.mv2

7. Later, user asks: "What was that Italian recipe from last week?"

8. Andee searches shared.mv2, finds the conversation containing 
   "pasta carbonara" and "a1b2c3d4"

9. Andee uses the UUID to locate and read the actual file:
   /home/claude/shared/lists/recipes/pasta-carbonara-a1b2c3d4.md
```

**Secret artifact flow**:
```
1. User: "Save my secret family cookie recipe"

2. Andee detects "secret" → calls: create-artifact.sh recipes "Family Cookie Recipe" alice secret
   Output: "CREATED: /home/claude/private/alice/lists/recipes/family-cookie-recipe-x1y2z3.md"
           "SCOPE: secret"

3. This goes in alice.mv2 (private conversation memory), NOT shared.mv2

4. Bob cannot see or search for this recipe
```

---

### 3. AI Search (Future Enhancement)

**Purpose**: Semantic search across ALL artifacts when conversation history and tag queries aren't enough.

**Status**: Not implemented. This is a future enhancement that could provide semantic similarity search across artifacts by indexing R2 snapshots with Cloudflare AI Search.

**When to consider adding**:
- When tag-based queries (yq) become insufficient
- When users need semantic similarity ("find recipes similar to...")
- When artifact volume grows large enough to benefit from vector search

For now, use:
- **Memvid** for conversation memory search
- **yq** for tag-based artifact queries (see section 4)

---

### 4. Tag-Based Lookups with yq

**The problem**: "Show me all Italian recipes" requires filtering by tag, not semantic search.

**The solution**: Use `yq` — a portable YAML processor (like `jq` for JSON) with native frontmatter support.

**Why not grep?** Grep works for simple scalar fields (`cuisine: italian`) but fails with YAML arrays:

```yaml
tags:
  - italian
  - pasta
  - quick
```

You can't grep for "files where tags contains italian" because `italian` isn't on the same line as `tags:`.

**yq handles this natively:**

```bash
# Find files where tags array contains "italian"
yq --front-matter=extract 'select(.tags[] == "italian")' /home/claude/shared/lists/recipes/*.md

# Compound: Italian AND quick
yq --front-matter=extract \
  'select((.tags | contains(["italian"])) and (.tags | contains(["quick"])))' \
  /home/claude/shared/lists/recipes/*.md

# Compound: Italian OR Mexican
yq --front-matter=extract \
  'select(.tags[] == "italian" or .tags[] == "mexican")' \
  /home/claude/shared/lists/recipes/*.md

# Mixed: cuisine is italian AND difficulty is easy
yq --front-matter=extract \
  'select(.cuisine == "italian" and .difficulty == "easy")' \
  /home/claude/shared/lists/recipes/*.md
```

---

#### Using MENU.JSON to Guide Queries

Before querying, Andee should check the MENU.JSON to see what's searchable:

```bash
# What artifact types are available?
jq -r '.artifact_types | keys[]' /home/claude/shared/lists/MENU.JSON
# Output: recipes, movies, grocery, books

# What cuisines are available for recipes? (keys are the values)
jq -r '.artifact_types.recipes.vocabularies.cuisine.values | keys[]' /home/claude/shared/lists/MENU.JSON
# Output: italian, thai, indian, mexican, japanese, french, american, chinese

# What tags exist for recipes?
jq -r '.artifact_types.recipes.vocabularies.tags.values | keys[]' /home/claude/shared/lists/MENU.JSON
# Output: pasta, quick, comfort-food, vegetarian, vegan, gluten-free, spicy...

# Get a specific tag's description (to understand what it means)
jq -r '.artifact_types.recipes.vocabularies.tags.values["comfort-food"]' /home/claude/shared/lists/MENU.JSON
# Output: Warm, satisfying, nostalgic dishes

# Get ALL tags with their descriptions (useful for prompting the AI)
jq '.artifact_types.recipes.vocabularies.tags.values' /home/claude/shared/lists/MENU.JSON
# Output: { "pasta": "Recipes featuring pasta...", "quick": "Can be made in 30 min...", ... }

# Get example queries for recipes
jq -r '.artifact_types.recipes.example_queries[]' /home/claude/shared/lists/MENU.JSON
```

This prevents queries like `.cuisine == "Italien"` (wrong spelling) or `.category == "pasta"` (wrong field name).

---

#### Andee Skill for Tag Search

```bash
#!/bin/bash
# /home/claude/scripts/find-by-tag.sh
#
# Usage: find-by-tag.sh <artifact_type> <expression> [include_secret]
# Examples:
#   find-by-tag.sh recipes '.tags[] == "italian"'
#   find-by-tag.sh recipes '.cuisine == "italian" and .difficulty == "easy"'
#   find-by-tag.sh movies '.watched == false'
#   find-by-tag.sh recipes '.tags[] == "vegetarian"' include_secret  # Also search alice's secrets

ARTIFACT_TYPE=$1
EXPR=$2
INCLUDE_SECRET=${3:-""}

# Always search shared
SEARCH_PATHS="/home/claude/shared/lists/${ARTIFACT_TYPE}"

# Optionally include secret (requires knowing the user)
if [ "$INCLUDE_SECRET" = "include_secret" ] && [ -n "$SENDER_ID" ]; then
  SEARCH_PATHS="$SEARCH_PATHS /home/claude/private/${SENDER_ID}/lists/${ARTIFACT_TYPE}"
fi

# Use yq to filter files by frontmatter expression
for dir in $SEARCH_PATHS; do
  [ -d "$dir" ] || continue
  find "$dir" -name "*.md" -exec sh -c '
    result=$(yq --front-matter=extract "select('"$EXPR"')" "$1" 2>/dev/null)
    [ -n "$result" ] && echo "$1"
  ' _ {} \;
done
```

---

#### Returning Structured Results

```bash
#!/bin/bash
# /home/claude/scripts/query-artifacts.sh
#
# Returns JSON array of matching artifacts
# Usage: query-artifacts.sh <artifact_type> '<expression>'
# Example: query-artifacts.sh recipes '.tags[] == "italian"'

ARTIFACT_TYPE=$1
EXPR=$2

SEARCH_DIR="/home/claude/shared/lists/${ARTIFACT_TYPE}"

echo "["
FIRST=true

for file in "$SEARCH_DIR"/*.md; do
  [ -f "$file" ] || continue
  
  # Check if file matches expression
  match=$(yq --front-matter=extract "select($EXPR)" "$file" 2>/dev/null)
  if [ -n "$match" ]; then
    # Extract key fields for the result
    result=$(yq --front-matter=extract \
      '{uuid: .uuid, title: .title, type: .type, path: "'"$file"'", tags: .tags, cuisine: .cuisine, status: .status}' \
      "$file" 2>/dev/null)
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      echo ","
    fi
    echo "$result"
  fi
done

echo "]"
```

---

#### Common Queries Andee Might Run

```bash
# All Italian recipes
./query-artifacts.sh recipes '.cuisine == "italian"'

# Quick vegetarian meals
./query-artifacts.sh recipes '(.tags | contains(["quick"])) and (.tags | contains(["vegetarian"]))'

# Easy recipes with short prep time
./query-artifacts.sh recipes '.difficulty == "easy" and .prep_time == "10min"'

# Unwatched movies
./query-artifacts.sh movies '.watched == false'

# Sci-fi movies we loved
./query-artifacts.sh movies '.genre == "sci-fi" and .rating == "loved"'

# All active items (not deleted)
./query-artifacts.sh recipes '.status == "active"'
```

**Performance notes**:
- yq is fast: ~5-10ms per file to parse frontmatter
- 100 files: ~0.5-1 second (imperceptible)
- 1,000 files: ~5-10 seconds (noticeable but acceptable)
- 10,000+ files: Rare for personal use; if needed, consider parallel processing or partitioning by artifact type

**Pros**: 
- Zero infrastructure beyond yq binary
- Works offline
- Files are the source of truth
- Supports complex compound queries
- Human can also use it directly
- MENU.JSON provides query guidance and prevents tag fragmentation

**Cons**:
- O(n) scan of all files per query
- Gets slower with thousands of files (acceptable for personal use)

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER SAYS SOMETHING                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ANDEE PROCESSES                                │
│                                                                             │
│  1. Check if this needs memory lookup:                                      │
│     → Search Memvid for relevant conversation history                       │
│     → Search AI Search for relevant artifacts (if needed)                   │
│                                                                             │
│  2. Determine scope (shared vs secret):                                     │
│     → Default: shared/lists/{artifact_type}/                                │
│     → If user says "secret"/"private": secret/{user}/lists/{type}/          │
│                                                                             │
│  3. For artifact creation/update (sub-agent workflow):                      │
│     → Load MENU.JSON schema and vocabularies with descriptions              │
│     → Call sub-agent with structured output schema                          │
│     → Sub-agent generates: content + metadata + new vocabulary values       │
│     → If new vocabulary values created, update MENU.JSON first              │
│     → Then create/update the artifact file                                  │
│                                                                             │
│  4. For queries:                                                            │
│     → Use yq for tag-based lookups on frontmatter                           │
│     → Check MENU.JSON for available vocabulary values                       │
│                                                                             │
│  5. Generate response                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPEND TO CONVERSATION MEMORY                       │
│                                                                             │
│  → User message + Andee response + tool calls + artifact UUIDs              │
│  → Appended to shared.mv2 (or alice.mv2/bob.mv2 for secret artifacts)       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTOMATIC R2 SNAPSHOT                               │
│                                                                             │
│  → Sandbox filesystem snapshotted to R2                                     │
│  → "latest/" folder updated                                                 │
│  → AI Search reindexes (on schedule or trigger)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User Identity Model

**Reality**: Andee runs on Telegram. Users are identified by numeric Telegram `senderId` (e.g., `123456789`).

**Documentation convention**: Examples in this document use "alice" and "bob" for readability. In production, these map to actual Telegram sender IDs.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SENDERD MAPPING                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  In examples:     In reality:                                               │
│  alice        →   123456789 (Telegram sender ID)                            │
│  bob          →   987654321 (Telegram sender ID)                            │
│  shared       →   shared (literal string for group/shared context)          │
│                                                                             │
│  Path examples:                                                             │
│  /home/claude/private/alice/    →   /home/claude/private/123456789/         │
│  /home/claude/private/bob/      →   /home/claude/private/987654321/         │
│                                                                             │
│  Memory file context comes from Telegram message:                           │
│  • Private chat (isGroup=false): Uses senderId for private memory           │
│  • Group chat (isGroup=true): Uses shared.mv2 for group conversations       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Environment variable**: Scripts receive `SENDER_ID` from the calling context (persistent-server.script.js).

---

## Multi-User Access Model

**Default: Shared by default**. All artifacts go to `shared/` unless explicitly marked as secret.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHARED (Default for all)                            │
│                                                                             │
│  /home/claude/shared/lists/recipes/*       All users can access             │
│  /home/claude/shared/lists/movies/*        All users can access             │
│  /home/claude/shared/lists/grocery/*       All users can access             │
│  /home/claude/shared/shared.mv2            Shared conversation memory       │
│                                                                             │
│  → This is where 99% of artifacts live                                      │
│  → Created unless user explicitly says "secret" or "private"                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRIVATE (Per-User)                                  │
│                                                                             │
│  /home/claude/private/{senderId}/lists/*   Only that user can access        │
│  /home/claude/private/{senderId}/memory.mv2  User's private conversations   │
│                                                                             │
│  Example: /home/claude/private/123456789/lists/recipes/                     │
│                                                                             │
│  → Created only when user says "secret" or "private"                        │
│  → Other users cannot see or search these                                   │
│  → Directory created dynamically on first private artifact                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Access control implementation**:
```javascript
// senderId is the numeric Telegram user ID (e.g., "123456789")
function getAccessiblePaths(senderId) {
  const paths = [
    '/home/claude/shared/',                  // Everyone gets shared
    '/home/claude/shared/shared.mv2'         // Shared conversation memory
  ];

  // Add user's private area (senderId is always available from Telegram context)
  if (senderId) {
    paths.push(`/home/claude/private/${senderId}/`);
  }

  return paths;
}

function canAccessPath(senderId, path) {
  // Shared is always accessible
  if (path.includes('/shared/')) return true;

  // Private paths require ownership: /private/{senderId}/...
  const privateMatch = path.match(/\/private\/(\d+)\//);
  if (privateMatch) {
    return privateMatch[1] === String(senderId);
  }

  return false;
}
```

**Detecting secret intent** (in Andee's processing):
```javascript
function shouldBeSecret(userMessage) {
  const secretIndicators = [
    /\bsecret\b/i,
    /\bprivate\b/i,
    /\bjust for me\b/i,
    /\bdon't share\b/i,
    /\bmy own\b/i,
    /\bhidden\b/i
  ];

  return secretIndicators.some(pattern => pattern.test(userMessage));
}
```

---

## Open Questions

### 1. ~~Tag-Based Filtering Strategy~~ ✅ RESOLVED

**Decision**: Use `yq` with `--front-matter=extract` for tag-based queries.

- Supports compound queries (`and`, `or`, array contains)
- Zero infrastructure beyond yq binary  
- Works offline, files are source of truth
- MENU.JSON tracks vocabularies to prevent tag fragmentation

See "Tag-Based Lookups with yq" section above for implementation details.

### 2. ~~AI Search Sync Timing~~ N/A

AI Search is a future enhancement. See section 3 above.

### 3. Soft Delete Implementation

**Question**: How to handle "deleted" artifacts?

**Proposed approach**:
```yaml
# In frontmatter
status: deleted
deleted_at: 2026-01-07T10:00:00Z
deleted_by: alice
```

- Files stay in place but have `status: deleted`
- Queries filter by `status: active`
- Periodic cleanup job can actually remove old deleted files
- Conversation history retains references (audit trail)

### 4. UUID Immutability

**Question**: How to ensure UUIDs never change?

**Approach**:
- UUID is generated once at file creation
- UUID is embedded in both filename AND frontmatter
- Scripts that move/rename files must preserve the UUID suffix
- Validation script can check filename UUID matches frontmatter UUID

```bash
# Validation script
find /home/claude -name "*.md" | while read file; do
  FILENAME_UUID=$(basename "$file" | grep -oE '[a-f0-9]{8}' | tail -1)
  FRONTMATTER_UUID=$(grep "^uuid:" "$file" | cut -d' ' -f2 | cut -c1-8)
  
  if [ "$FILENAME_UUID" != "$FRONTMATTER_UUID" ]; then
    echo "MISMATCH: $file"
  fi
done
```

### 5. Conversation Memory Compaction

**Question**: What happens when .mv2 files get huge?

Memvid files grow over time. Options:
- **Archive old conversations** — Move conversations older than N months to archive.mv2
- **Summarization** — Use AI to summarize old conversations, store summaries
- **Just let it grow** — Memvid handles millions of entries; may not be a problem

### 6. Concurrent Access

**Question**: What if Alice and Bob are both chatting with Andee simultaneously?

**Memvid limitation**: Single writer only.

**Mitigation options**:
- Queue writes to each .mv2 file
- Accept eventual consistency (slight delay in cross-user visibility)
- Use Durable Objects to serialize writes per memory file

---

## Implementation Phases

### Phase 1: Core Memory & Memvid
- [ ] **Dockerfile**: Install memvid CLI (`npm install -g memvid`)
- [ ] **Dockerfile**: Pre-create directories (`/home/claude/shared/`, `/home/claude/private/`)
- [ ] **persistent-server.script.js**: Add Memvid append hook after `msg.type === "result"`
- [ ] **searching-memories skill**: Create skill for conversation memory search
  - `claude-sandbox-worker/.claude/skills/searching-memories/SKILL.md`
  - Documents memvid CLI usage for memory search
  - Search modes: lex, sem, hybrid

### Phase 2: Artifact System & yq
- [ ] **Dockerfile**: Install yq for YAML frontmatter queries
- [ ] **managing-artifacts skill**: Create skill for artifact CRUD operations
  - `claude-sandbox-worker/.claude/skills/managing-artifacts/SKILL.md`
  - `claude-sandbox-worker/.claude/skills/managing-artifacts/MENU_SCHEMA.md`
  - `claude-sandbox-worker/.claude/skills/managing-artifacts/scripts/*.sh`
  - `claude-sandbox-worker/.claude/skills/managing-artifacts/templates/artifact.md.template`
- [ ] Implement create/read/soft-delete scripts with shared-by-default behavior
- [ ] Test UUID → conversation → file lookup flow

### Phase 3: Polish & Testing
- [ ] Test end-to-end memory append flow
- [ ] Test artifact creation with vocabulary updates
- [ ] Add validation scripts for UUID integrity
- [ ] Test snapshot persistence (artifacts survive container sleep)

---

## Summary

This architecture gives Andee:

1. **Fast conversation memory** via Memvid with hybrid search
2. **Human-readable artifacts** as markdown files with YAML frontmatter
3. **Shared by default** — Everything is shared unless user explicitly says "secret" or "private"
4. **MENU.JSON at lists/ level** — Single file tracking schema and all vocabulary values with descriptions
5. **UUID-based linking** between conversations and artifacts
6. **Automatic backup** via R2 snapshots
7. **Multi-user privacy** with private/{senderId}/ paths for private artifacts
8. **Tag-based filtering** via yq on YAML frontmatter
9. **Two Claude skills** for memory search and artifact management

**Key insights**:
- **Vocabulary descriptions guide the AI** — Each tag value has context (e.g., "quick" = "Can be made in 30 minutes or less") so the AI picks the right ones
- **yq gives us jq-like power** for YAML frontmatter queries without any infrastructure
- **Shared-by-default** means users don't have to think about privacy unless they explicitly want it
- **Files remain the source of truth**, with clear paths: `shared/lists/{type}/` for normal, `private/{senderId}/lists/{type}/` for private
- **persistent-server.script.js is the integration point** — Memvid append hook lives there