---
name: managing-artifacts
description: Create, update, and query artifacts like recipes, lists, and notes. Use when user wants to save, find, or modify stored content. Handles MENU.JSON vocabularies and yq-based tag queries. Use for "save this recipe", "find Italian dishes", "update the grocery list", or "what movies did we add".
---

# Managing Artifacts

Use this skill to create, query, and manage artifacts (recipes, lists, notes, etc.) stored as markdown files with YAML frontmatter.

## When to Use

- User says "save this recipe", "add to our list", "remember this"
- User asks "show me Italian recipes", "what movies are on our list"
- User wants to update or modify an existing artifact
- User asks about what lists/artifacts exist

## The Schema-First Principle

**MENU.JSON is the source of truth for artifact schemas.**

Before creating ANY artifact, you must check MENU.JSON to understand:
- What artifact types exist
- What vocabularies (fields) are defined for each type
- What values exist for each vocabulary

This ensures consistency and enables meaningful queries/filters.

---

## Creating Artifacts: The Introspective Workflow

### MANDATORY: Read-Draft-Check-Extend-Create

**NEVER create an artifact without first checking MENU.JSON.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ARTIFACT CREATION WORKFLOW                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. READ MENU.JSON                                                      │
│     └── What types, vocabularies, and values exist?                     │
│                           │                                             │
│                           ▼                                             │
│  2. DRAFT ARTIFACT (mentally)                                           │
│     └── What fields would best capture this?                            │
│                           │                                             │
│                           ▼                                             │
│  3. INTROSPECT                                                          │
│     └── Are there fields I need that don't exist in MENU.JSON?          │
│                           │                                             │
│                    ┌──────┴──────┐                                      │
│                    ▼             ▼                                      │
│              Missing?       Complete?                                   │
│                 │               │                                       │
│                 ▼               │                                       │
│  4. EXTEND MENU.JSON            │                                       │
│     └── Add vocabularies/values │                                       │
│                 │               │                                       │
│                 └───────┬───────┘                                       │
│                         ▼                                               │
│  5. CREATE ARTIFACT                                                     │
│     └── Using MENU.JSON as the authoritative schema                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Read MENU.JSON

```bash
cat /home/claude/shared/lists/MENU.JSON
```

Note:
- What artifact types exist
- What vocabularies are defined for the target type
- What values exist in each vocabulary

### Step 2: Draft the Artifact (mentally)

Think about what fields would best capture this artifact:
- What's the title?
- What categorical fields make sense? (cuisine, genre, difficulty, price-range...)
- What boolean fields? (visited, watched, read, completed...)
- What free-text fields? (notes, description, source...)

### Step 3: Introspection Check

**Ask yourself:** "Does this draft capture all the details we'd want from this artifact?"

Compare your draft fields against MENU.JSON:
- Are there fields in my draft that don't exist as vocabularies in MENU.JSON?
- Are there values I want to use that aren't defined?
- Should I add descriptions to help future lookups?

### Step 4: Extend MENU.JSON (if needed)

If new vocabularies are needed:
```bash
/home/claude/.claude/skills/managing-artifacts/scripts/add-vocabulary.sh TYPE VOCAB "Description"
```

If new values for existing vocabularies:
```bash
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh TYPE VOCAB value "Description"
```

### Step 5: Create Artifact

NOW create the artifact, using MENU.JSON as the authoritative source for what fields to include.

```bash
# First, get the sender ID
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)

# Create the artifact
/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh TYPE "Title" "$SENDER_ID"
```

Then edit the file to add all the frontmatter fields from your draft.

---

## Action vs Clarification

**CRITICAL**: When the user's request is unambiguous, execute it directly. Do NOT ask for confirmation.

### Recognize Direct Instructions

| User Says | This Means | DO |
|-----------|------------|-----|
| "Add this recipe" | Direct instruction | Create the artifact immediately |
| "Save these to my list" | Direct instruction | Create artifacts for ALL items |
| "Add all these recipes" | Direct instruction + scope | Create artifacts for EVERY recipe shown |
| "Put this on the grocery list" | Direct instruction | Add to grocery list now |

### Do NOT Ask For Confirmation When:

- User uses imperative verbs: "add", "save", "create", "put", "remember", "store"
- User specifies scope: "all these", "both of these", "this recipe"
- User's intent is clear from context + language

**WRONG response to "Add all these recipes":**
```
Would you like me to save this to your recipe collection?
```

**CORRECT response to "Add all these recipes":**
```
*Immediately creates artifacts for each recipe*

Added 9 recipes to your collection:
• Nước Chấm (uuid: abc123)
• Som Tum - Papaya Salad (uuid: def456)
...
```

### When to Ask for Clarification

Only ask when genuinely ambiguous:

| User Says | Why Ambiguous | Ask |
|-----------|---------------|-----|
| "That looks good" | Not an instruction | "Would you like me to save this recipe?" |
| "The carbonara one" | Multiple could match | "Do you mean the classic or the bacon version?" |
| "Add it" | No clear referent | "Which recipe would you like me to add?" |
| "Make it private" | Which artifact? | "Which item should be private?" |

---

## Directory Structure

```
/home/claude/shared/                    # Default for all artifacts
├── lists/
│   ├── MENU.JSON                       # Schema + vocabulary registry
│   ├── recipes/                        # Artifact type directories
│   │   └── {name}-{uuid}.md
│   ├── movies/
│   └── restaurants/

/home/claude/private/{senderId}/        # Private artifacts (explicit request only)
└── lists/
    ├── MENU.JSON
    └── recipes/
```

### Shared vs Private Decision

| User Says | Storage Location |
|-----------|------------------|
| "Save this recipe" | `shared/lists/recipes/` |
| "Add to our movie list" | `shared/lists/movies/` |
| "**Secret** recipe" | `private/{senderId}/lists/recipes/` |
| "My **private** notes" | `private/{senderId}/lists/notes/` |

**Default**: Always use `shared/` unless user explicitly says "secret", "private", "just for me", or "hidden".

---

## Vocabulary Types

Not all vocabularies need enumerated values. There are three types:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  VOCABULARY TYPES                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ENUMERATED: Known set of values to track                               │
│  ├── Examples: tags, cuisine, neighborhood, specialties                 │
│  ├── Values discovered and stored in MENU.JSON                          │
│  └── Use update-menu-vocab.sh to add values                             │
│                                                                         │
│  CUSTOM: Free-form values unique per artifact                           │
│  ├── Examples: address, phone, website, hours, notes                    │
│  ├── Vocabulary exists in MENU.JSON but values = {} (empty)             │
│  └── Don't enumerate - each artifact has its own value                  │
│                                                                         │
│  BOOLEAN: true/false fields                                             │
│  ├── Examples: visited, favorite, to_try                                │
│  ├── Vocabulary exists with description only                            │
│  └── No need to add true/false as values                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Example Vocabularies in MENU.JSON

```json
{
  "neighborhood": {
    "description": "Area or district where the place is located",
    "values": {
      "Chinatown": "Synced",
      "North End": "Synced"
    }
  },
  "address": {
    "description": "Street address (custom per artifact)",
    "values": {}
  },
  "visited": {
    "description": "Whether this place has been visited (true/false)",
    "values": {}
  }
}
```

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `create-artifact.sh` | Create new artifact with UUID |
| `add-vocabulary.sh` | Add a new vocabulary (field) to MENU.JSON |
| `update-menu-vocab.sh` | Add new values to an existing vocabulary |
| `sync-from-artifacts.sh` | Sync artifacts → MENU.JSON (discovers fields, skips system/custom fields) |
| `find-by-tag.sh` | Find files matching yq expression |
| `query-artifacts.sh` | Return JSON array of matching artifacts |

All scripts are at: `/home/claude/.claude/skills/managing-artifacts/scripts/`

### When to Run sync-from-artifacts.sh

- After deploying to sync existing production data
- After manual artifact creation via IDE
- Periodically to catch drift between artifacts and MENU.JSON

The script:
- Skips system fields (media_paths)
- Doesn't enumerate custom field values (address, phone, hours, etc.)
- Generates smart descriptions based on field names

---

## Querying Artifacts

### Find by Tag (yq)

```bash
# Find Italian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.cuisine == "italian"'

# Find vegetarian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.tags[] == "vegetarian"'

# Find easy Italian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.cuisine == "italian" and .difficulty == "easy"'

# Find unvisited restaurants
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh restaurants '.visited == false'
```

### Check Available Vocabularies

```bash
# What artifact types exist?
jq -r '.artifact_types | keys[]' /home/claude/shared/lists/MENU.JSON

# What vocabularies exist for restaurants?
jq -r '.artifact_types.restaurants.vocabularies | keys[]' /home/claude/shared/lists/MENU.JSON

# What cuisine values are defined?
jq '.artifact_types.recipes.vocabularies.cuisine.values' /home/claude/shared/lists/MENU.JSON
```

---

## Workflow Examples

### Example 1: Adding a Restaurant

User: "Add Pizzeria Regina to my want-to-try list"

**Step 1: Read MENU.JSON**
```bash
cat /home/claude/shared/lists/MENU.JSON
```
Result: "restaurants" type exists but only has "tags" vocabulary.

**Step 2: Draft artifact mentally**
- title: Pizzeria Regina
- cuisine: italian
- neighborhood: north-end
- visited: false
- notes: "Famous brick oven pizza"

**Step 3: Introspect**
Missing from MENU.JSON: cuisine, neighborhood, visited vocabularies.

**Step 4: Extend MENU.JSON**
```bash
# Add vocabularies (cuisine = enumerated, neighborhood = enumerated, visited = boolean)
/home/claude/.claude/skills/managing-artifacts/scripts/add-vocabulary.sh restaurants cuisine "The cuisine type"
/home/claude/.claude/skills/managing-artifacts/scripts/add-vocabulary.sh restaurants neighborhood "Boston area/neighborhood"
/home/claude/.claude/skills/managing-artifacts/scripts/add-vocabulary.sh restaurants visited "Whether we've been to this place (true/false)"

# Only add values for ENUMERATED vocabularies (not booleans like visited)
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh restaurants cuisine italian "Italian cuisine"
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh restaurants neighborhood north-end "North End"
```

**Step 5: Create artifact**
```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh restaurants "Pizzeria Regina" "$SENDER_ID"
```

Then edit the file with frontmatter including all the fields.

### Example 2: Simple Recipe (Type Already Set Up)

User: "Save that pad thai recipe"

**Step 1: Read MENU.JSON** - recipes type has cuisine, difficulty, tags vocabularies.

**Step 2: Draft** - title: Pad Thai, cuisine: thai, difficulty: medium, tags: [noodles, quick]

**Step 3: Introspect** - "thai" cuisine exists, "medium" difficulty exists, need to add "quick" and "noodles" tags.

**Step 4: Extend**
```bash
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh recipes tags noodles "Noodle-based dishes"
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh recipes tags quick "Ready in 30 minutes or less"
```

**Step 5: Create**
```bash
SENDER_ID=$(jq -r .senderId /tmp/protected/telegram_context/context.json)
/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh recipes "Pad Thai" "$SENDER_ID"
```

---

## Artifact File Format

```yaml
---
uuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
type: recipe
title: Pasta Carbonara
created_at: 2026-01-06T14:30:00Z
created_by: 123456789
scope: shared
status: active
cuisine: italian
difficulty: medium
prep_time: 10min
cook_time: 20min
tags:
  - pasta
  - comfort-food
notes: Classic Roman dish - no cream!
---

# Pasta Carbonara

A classic Roman pasta dish...

## Ingredients

- 400g spaghetti
- 200g guanciale
...
```

---

## Important Notes

- **MENU.JSON is authoritative** - Always read it first when creating artifacts
- **Extend before create** - Add missing vocabularies/values BEFORE creating the artifact
- **Use existing values** when possible to prevent duplication
- **UUID links conversations to artifacts** - Always mention UUID when creating
- **Private directories created dynamically** when first private artifact is created
