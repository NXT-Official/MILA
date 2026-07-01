ALTER TABLE public.profiles
ADD COLUMN username TEXT UNIQUE;

-- Recreate the insert policy so new profiles must supply a valid username
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
ON public.profiles
FOR INSERT
WITH CHECK (
  auth.uid() = id
  AND username IS NOT NULL
  AND length(trim(username)) >= 3
  AND length(trim(username)) <= 30
  AND username ~ '^[a-zA-Z0-9_-]+$'
);

-- Recreate the update policy so a username (when provided) must be valid
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND (
    username IS NULL
    OR (
      length(trim(username)) >= 3
      AND length(trim(username)) <= 30
      AND username ~ '^[a-zA-Z0-9_-]+$'
    )
  )
);

-- Regrant column-level permissions on the new username field
GRANT SELECT(username), INSERT(username), UPDATE(username) ON public.profiles TO authenticated;
GRANT SELECT(username), INSERT(username), UPDATE(username) ON public.profiles TO service_role;