ALTER TABLE public.emergency_schedule 
ADD COLUMN proposed_user_id uuid REFERENCES auth.users(id),
ADD COLUMN swap_status text,
ADD COLUMN swap_requested_at timestamp with time zone;
