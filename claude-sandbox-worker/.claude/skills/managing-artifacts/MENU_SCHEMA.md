# MENU.JSON Schema Reference

The MENU.JSON file serves as the **single source of truth** for artifact schemas:

1. Registry of all artifact types
2. Schema definitions (required/optional fields) for each type
3. Vocabulary registry with descriptions for each field
4. Query examples for filtering

## Core Principle: Schema-First

**MENU.JSON is authoritative.** Before creating any artifact:
1. Read MENU.JSON to understand existing types/vocabularies
2. Extend MENU.JSON if new fields are needed
3. Then create the artifact

This prevents schema drift and ensures artifacts can be meaningfully queried.

## Vocabulary Types

Not all vocabularies need enumerated values. There are three types:

| Type | Examples | Values in MENU.JSON | Description |
|------|----------|---------------------|-------------|
| **Enumerated** | tags, cuisine, neighborhood | Known set of values | Track all possible values for queries |
| **Custom** | address, phone, hours, notes | `{}` (empty) | Free-form, unique per artifact |
| **Boolean** | visited, favorite, to_try | `{}` (empty) | true/false fields, no need to enumerate |

### Enumerated Vocabulary Example
```json
"neighborhood": {
  "description": "Area or district where the place is located",
  "values": {
    "Chinatown": "Boston's Chinatown district",
    "North End": "Italian neighborhood in Boston"
  }
}
```

### Custom Vocabulary Example
```json
"address": {
  "description": "Street address (custom per artifact)",
  "values": {}
}
```

### Boolean Vocabulary Example
```json
"visited": {
  "description": "Whether this place has been visited (true/false)",
  "values": {}
}
```

## Location

- Shared: `/home/claude/shared/lists/MENU.JSON`
- Private: `/home/claude/private/{senderId}/lists/MENU.JSON`

## Structure

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
        "optional": ["cuisine", "difficulty", "prep_time", "cook_time", "servings", "tags", "notes"]
      },
      "vocabularies": {
        "cuisine": {
          "description": "The cuisine or cultural origin of the recipe",
          "values": {
            "italian": "Italian cuisine - pasta, risotto, pizza, Mediterranean flavors",
            "thai": "Thai cuisine - curries, stir-fries, rice noodles, fish sauce, lime, chilies"
          }
        },
        "difficulty": {
          "description": "How hard the recipe is to make",
          "values": {
            "easy": "Simple recipes with few ingredients, under 30 min active time",
            "medium": "Moderate complexity, 30-60 min active time",
            "hard": "Complex recipes requiring 60+ min active time"
          }
        },
        "tags": {
          "description": "Flexible tags for categorization - can have multiple",
          "values": {
            "pasta": "Recipes featuring pasta as main component",
            "quick": "Can be made in 30 minutes or less"
          }
        }
      },
      "example_queries": [
        ".cuisine == \"italian\"",
        ".tags[] == \"vegetarian\"",
        ".difficulty == \"easy\""
      ]
    }
  }
}
```

---

## Scripts

All scripts are at: `/home/claude/.claude/skills/managing-artifacts/scripts/`

### add-vocabulary.sh

**Purpose:** Add a new vocabulary (field) to an artifact type.

```bash
# Usage
./add-vocabulary.sh <artifact_type> <vocabulary_name> <description> [senderId]

# Examples
./add-vocabulary.sh restaurants visited "Whether we've visited this place"
./add-vocabulary.sh restaurants cuisine "The cuisine type or cultural origin"
./add-vocabulary.sh recipes source "Where the recipe came from" 123456789  # Private
```

**What it does:**
- Creates artifact type if it doesn't exist
- Adds vocabulary with description and empty values
- Adds field to `schema.optional`
- Updates `last_updated` timestamp

### update-menu-vocab.sh

**Purpose:** Add a new value to an existing vocabulary.

```bash
# Usage
./update-menu-vocab.sh <artifact_type> <vocabulary> <value> <description> [senderId]

# Examples
./update-menu-vocab.sh recipes cuisine korean "Korean cuisine - kimchi, BBQ, fermented flavors"
./update-menu-vocab.sh recipes tags keto "Ketogenic diet friendly - low carb, high fat"
./update-menu-vocab.sh restaurants visited false "On our list to try"
```

**What it does:**
- Validates artifact type and vocabulary exist
- Adds value with description
- Updates `last_updated` timestamp

### sync-from-artifacts.sh

**Purpose:** Sync existing artifacts to MENU.JSON - discovers fields and vocabularies.

```bash
# Usage
./sync-from-artifacts.sh [artifact_type] [senderId]

# Examples
./sync-from-artifacts.sh                    # Sync ALL types in shared
./sync-from-artifacts.sh restaurants        # Sync just restaurants
./sync-from-artifacts.sh restaurants 12345  # Sync private restaurants
```

**What it does:**
- Scans artifact files for frontmatter fields
- Skips system fields (media_paths)
- For each user-defined field:
  - If vocabulary doesn't exist → creates it with smart description
  - If value should be enumerated → adds to vocabulary values
- Does NOT enumerate values for custom fields (address, phone, hours, notes, etc.)
- Generates smart descriptions based on field names

**When to use:**
- After deploying to sync existing production data
- After manual artifact creation via IDE
- Periodically to catch drift between artifacts and MENU.JSON

### create-artifact.sh

**Purpose:** Create a new artifact file with UUID.

```bash
# Usage
./create-artifact.sh <artifact_type> <name> <created_by> [private]

# Examples
./create-artifact.sh recipes "Pasta Carbonara" 123456789
./create-artifact.sh recipes "Secret Recipe" 123456789 private
```

---

## Querying MENU.JSON

```bash
# List all artifact types
jq -r '.artifact_types | keys[]' MENU.JSON

# List all vocabularies for a type
jq -r '.artifact_types.restaurants.vocabularies | keys[]' MENU.JSON

# List all cuisine values
jq -r '.artifact_types.recipes.vocabularies.cuisine.values | keys[]' MENU.JSON

# Get full cuisine vocabulary with descriptions
jq '.artifact_types.recipes.vocabularies.cuisine.values' MENU.JSON

# Get example queries for recipes
jq -r '.artifact_types.recipes.example_queries[]' MENU.JSON
```

---

## The Introspective Workflow

When creating artifacts, follow this workflow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. READ MENU.JSON  →  What types/vocabularies/values exist?            │
│                                                                         │
│  2. DRAFT ARTIFACT  →  What fields would capture this item?             │
│                                                                         │
│  3. INTROSPECT      →  Are there fields I need that don't exist?        │
│                                                                         │
│  4. EXTEND MENU     →  add-vocabulary.sh + update-menu-vocab.sh         │
│                                                                         │
│  5. CREATE ARTIFACT →  create-artifact.sh + edit frontmatter            │
└─────────────────────────────────────────────────────────────────────────┘
```

This ensures MENU.JSON stays in sync with actual artifacts.

---

## Best Practices

1. **Always check existing values** before creating new vocabulary entries
2. **Use descriptive descriptions** - Help future lookups understand what each value means
3. **Keep vocabularies consistent** - Use lowercase, hyphens for multi-word values
4. **Don't duplicate** - "italian" not "Italian" or "italian-food"
5. **Extend before create** - Add new vocabularies/values BEFORE creating the artifact
6. **Run sync after manual edits** - If artifacts were created/edited manually via IDE
7. **Know your vocabulary types:**
   - **Enumerated** (tags, cuisine): Add values with `update-menu-vocab.sh`
   - **Custom** (address, phone): Just add vocabulary, leave values empty
   - **Boolean** (visited, favorite): Just add vocabulary with good description
8. **Don't enumerate custom values** - addresses, phone numbers, hours are unique per artifact

---

## Manual Editing via IDE

Edits to MENU.JSON via the Andee IDE will:
1. **Persist in snapshots** - `/home/claude/shared/lists/MENU.JSON` is backed up
2. **Be respected by Andee** - The workflow reads MENU.JSON first
3. **Guide future behavior** - Descriptions help Andee understand what values mean

Example: Adding a description to guide future artifact creation:
```json
"visited": {
  "description": "Whether we've been to this place (true/false)",
  "values": {}
}
```

Note: Boolean fields like `visited` don't need true/false enumerated as values - the description is sufficient.
