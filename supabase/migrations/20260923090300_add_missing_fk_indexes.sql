-- Foreign key columns with no supporting index — each forces a sequential
-- scan on the referencing table for any join, admin/reporting query, or
-- ON DELETE cascade/SET NULL lookup against the referenced row.
CREATE INDEX IF NOT EXISTS posts_generated_look_id_idx
  ON public.posts(generated_look_id);

CREATE INDEX IF NOT EXISTS post_items_product_id_idx
  ON public.post_items(product_id);

CREATE INDEX IF NOT EXISTS subscriptions_plan_id_idx
  ON public.subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS ai_spend_log_user_id_idx
  ON public.ai_spend_log(user_id);
