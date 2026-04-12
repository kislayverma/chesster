-- Add journey_state column to profiles table.
-- Stores the player's progression/calibration state as jsonb.
-- Safe to re-run: uses IF NOT EXISTS via a DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'journey_state'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN journey_state jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END
$$;
