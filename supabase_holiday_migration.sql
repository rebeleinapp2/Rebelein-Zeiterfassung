-- Migration: Add holiday_config to user_settings
-- Created: 2026-03-27

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS holiday_config JSONB DEFAULT '{}'::jsonb;

-- Optional: Update existing users with default config
-- UPDATE user_settings SET holiday_config = '{"neujahr": true, "h3k": true, "karfreitag": true, "ostermontag": true, "tag_der_arbeit": true, "christi_himmelfahrt": true, "pfingstmontag": true, "fronleichnam": true, "friedensfest": false, "mariae_himmelfahrt": true, "tag_der_deutschen_einheit": true, "allerheiligen": true, "weihnachten_1": true, "weihnachten_2": true}'::jsonb WHERE holiday_config = '{}'::jsonb;
