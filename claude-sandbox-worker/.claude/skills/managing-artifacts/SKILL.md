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

## Core Concepts

### Directory Structure

```
/home/claude/shared/                    # Default for all artifacts
├── lists/
│   ├── MENU.JSON                       # Schema + vocabulary registry
│   ├── recipes/                        # Artifact type directories
│   │   └── {name}-{uuid}.md
│   ├── movies/
│   └── grocery/

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

## Creating Artifacts

### Step 1: Create the File

```bash
# Shared artifact (default)
/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh recipes "Pasta Carbonara" ${SENDER_ID}

# Private artifact
/home/claude/.claude/skills/managing-artifacts/scripts/create-artifact.sh recipes "Secret Family Recipe" ${SENDER_ID} private
```

**Output**:
```
CREATED: /home/claude/shared/lists/recipes/pasta-carbonara-a1b2c3d4.md
UUID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
SCOPE: shared
```

### Step 2: Write Content to the File

After creating, edit the file to add content:
1. Add metadata to frontmatter (cuisine, tags, difficulty, etc.)
2. Write the markdown body content

### Step 3: Update MENU.JSON (if new vocabulary values)

```bash
# Add a new cuisine value
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh recipes cuisine korean "Korean cuisine - kimchi, BBQ, fermented flavors"

# Add a new tag
/home/claude/.claude/skills/managing-artifacts/scripts/update-menu-vocab.sh recipes tags meal-prep "Good for batch cooking and storing"
```

## Querying Artifacts

### Find by Tag (yq)

```bash
# Find Italian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.cuisine == "italian"'

# Find vegetarian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.tags[] == "vegetarian"'

# Find easy Italian recipes
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh recipes '.cuisine == "italian" and .difficulty == "easy"'

# Find unwatched movies
/home/claude/.claude/skills/managing-artifacts/scripts/find-by-tag.sh movies '.watched == false'
```

### Get Structured Results (JSON)

```bash
# Returns JSON array of matching artifacts
/home/claude/.claude/skills/managing-artifacts/scripts/query-artifacts.sh recipes '.tags[] == "italian"'
```

### Check Available Vocabularies

```bash
# What artifact types exist?
jq -r '.artifact_types | keys[]' /home/claude/shared/lists/MENU.JSON

# What cuisines are available?
jq -r '.artifact_types.recipes.vocabularies.cuisine.values | keys[]' /home/claude/shared/lists/MENU.JSON

# Get cuisine with descriptions
jq '.artifact_types.recipes.vocabularies.cuisine.values' /home/claude/shared/lists/MENU.JSON
```

## Available Scripts

| Script | Purpose |
|--------|---------|
| `create-artifact.sh` | Create new artifact with UUID |
| `update-menu-vocab.sh` | Add new vocabulary values to MENU.JSON |
| `find-by-tag.sh` | Find files matching yq expression |
| `query-artifacts.sh` | Return JSON array of matching artifacts |

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
---

# Pasta Carbonara

A classic Roman pasta dish...

## Ingredients

- 400g spaghetti
- 200g guanciale
...
```

## Workflow Examples

### Save a Recipe

1. User: "Save that pasta carbonara recipe we discussed"
2. Create artifact: `create-artifact.sh recipes "Pasta Carbonara" ${SENDER_ID}`
3. Check MENU.JSON for available cuisines/tags
4. Edit file to add frontmatter metadata and content
5. If new tag needed: `update-menu-vocab.sh recipes tags classic-roman "Traditional Roman dishes"`
6. Confirm to user with UUID reference

### Find Artifacts

1. User: "Show me Italian recipes"
2. Check MENU.JSON: cuisine "italian" exists
3. Query: `find-by-tag.sh recipes '.cuisine == "italian"'`
4. Return matching files to user

### Update Existing Artifact

1. User: "Add garlic to the carbonara recipe"
2. Search for artifact (by UUID or title)
3. Edit the file content
4. Update `updated_at` in frontmatter

## Important Notes

- **Always check MENU.JSON** before using vocabulary values
- **Use existing tags** when possible to prevent duplication
- **UUID links conversations to artifacts** - always mention UUID when creating
- **Private directories created dynamically** when first private artifact is created
