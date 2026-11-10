-- Drafts name who changed them last (contracts/theming.openapi.yaml, Draft `updated_by`; #241).
-- Nullable: a draft is always written by a person, but rows from before this column have none.
ALTER TABLE theming_drafts ADD COLUMN updated_by text;
