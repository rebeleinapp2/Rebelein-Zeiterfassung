-- Add columns for late entry approval workflow
ALTER TABLE time_entries
ADD COLUMN late_reason text,
ADD COLUMN rejection_reason text,
ADD COLUMN rejected_by uuid,
ADD COLUMN rejected_at timestamp with time zone;
