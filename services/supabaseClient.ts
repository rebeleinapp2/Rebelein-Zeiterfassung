import { createClient } from '@supabase/supabase-js';

// Cloud Supabase Konfiguration (Migration)
export const SUPABASE_URL = 'https://akpgjparoigjkgwfqcqb.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrcGdqcGFyb2lnamtnd2ZxY3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Nzc2MTAsImV4cCI6MjA4NTU1MzYxMH0.9cnu7D8Myze9K2pqxn_pEo0vIQsUeqsnYADG8RHXQLw';
const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
    }
});

export const isSupabaseConfigured = true;
