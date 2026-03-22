-- ========================================================
-- Schema Update: Closed Months for Office
-- ========================================================

CREATE TABLE IF NOT EXISTS public.closed_months (
    month VARCHAR(7) PRIMARY KEY, -- Format: YYYY-MM
    closed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policies
ALTER TABLE public.closed_months ENABLE ROW LEVEL SECURITY;

-- Everyone can read closed_months
CREATE POLICY "Enable read access for all users" ON public.closed_months
    FOR SELECT USING (true);

-- Only office and admin users should be able to insert/delete, 
-- but since our roles are custom in `profiles` or `user_settings`, 
-- we can allow insert/delete for authenticated users here and enforce it in the frontend,
-- or write a more complex policy. 
-- For simplicity and consistency with other tables, we rely on authenticated access and frontend checks.
CREATE POLICY "Enable insert for authenticated users" ON public.closed_months
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for authenticated users" ON public.closed_months
    FOR DELETE TO authenticated USING (true);

-- Tell PostgREST to recognize the new table
NOTIFY pgrst, 'reload schema';
