# MENU.JSON Schema Reference

The MENU.JSON file serves as:
1. Registry of all artifact types
2. Schema definitions for each type
3. Vocabulary registry with descriptions
4. Query guide for yq

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
        "optional": ["cuisine", "difficulty", "prep_time", "cook_time", "servings", "tags"]
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

## Key Benefits

1. **Single source of truth** for artifact types and vocabularies
2. **Descriptions provide context** - AI understands what each value means
3. **Prevents duplication** - Check existing values before creating new ones
4. **Query guidance** - Example queries show how to filter

## Default Artifact Types

When MENU.JSON doesn't exist, the create-artifact.sh script creates it with basic structure. Common types to pre-populate:

| Type | Description |
|------|-------------|
| recipes | Recipes for cooking |
| movies | Movies to watch or remember |
| grocery | Grocery and shopping lists |
| books | Books to read or remember |
| notes | General notes and reminders |

## Adding New Vocabulary Values

Use the update-menu-vocab.sh script:

```bash
# Add a new cuisine
./update-menu-vocab.sh recipes cuisine korean "Korean cuisine - kimchi, BBQ, fermented flavors, gochujang"

# Add a new tag
./update-menu-vocab.sh recipes tags keto "Ketogenic diet friendly - low carb, high fat"
```

The script:
1. Checks if value already exists
2. Adds value with description
3. Updates `last_updated` timestamp

## Querying MENU.JSON

```bash
# List all artifact types
jq -r '.artifact_types | keys[]' MENU.JSON

# List all cuisine values
jq -r '.artifact_types.recipes.vocabularies.cuisine.values | keys[]' MENU.JSON

# Get full cuisine vocabulary with descriptions
jq '.artifact_types.recipes.vocabularies.cuisine.values' MENU.JSON

# Get example queries for recipes
jq -r '.artifact_types.recipes.example_queries[]' MENU.JSON
```

## Best Practices

1. **Always check existing values** before creating new vocabulary entries
2. **Use descriptive descriptions** - Help future lookups understand what each value means
3. **Keep vocabularies consistent** - Use lowercase, hyphens for multi-word values
4. **Don't duplicate** - "italian" not "Italian" or "italian-food"
