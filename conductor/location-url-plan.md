# Objective
Add an exact Google Maps location URL to the database for future SMS emergency alerts without breaking existing Map UI components.

# Key Files & Context
- `supabase_production_full_setup.sql.txt` (or Supabase SQL Editor)
- `profiles` table

# Implementation Steps
1. Run the following SQL command in the Supabase SQL Editor to add a generated `location_url` column to the `profiles` table. This column will automatically concatenate the existing `latitude` and `longitude` into a clickable Google Maps link.

```sql
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS location_url text GENERATED ALWAYS AS (
  'https://maps.google.com/?q=' || latitude::text || ',' || longitude::text
) STORED;
```

# Verification & Testing
1. Ensure the SQL command executes successfully in Supabase.
2. Verify that existing app map functionalities (Login, Settings, Dashboard) continue to work normally because `latitude` and `longitude` are untouched.
3. Check the Supabase `profiles` table data viewer to confirm the `location_url` column is populated correctly (e.g., `https://maps.google.com/?q=14.5995,120.9842`).