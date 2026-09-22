-- outfits.match_score had no bounds check, despite the only producer
-- (outfit-analysis.ts's AI schema) constraining it to 0-100. Since the
-- client legitimately INSERTs this row itself (app-shell.tsx runLensCapture,
-- after calling the server-side analyze function), RLS ownership alone can't
-- stop a client from writing an out-of-range value. This closes the
-- easy/cheap part of that gap; it does not stop a client from writing an
-- in-range but fabricated score — that requires moving the insert
-- server-side, tracked separately, not done in this migration.
ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_match_score_range
  CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 100));
