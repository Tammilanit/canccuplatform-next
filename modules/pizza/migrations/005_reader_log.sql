-- #789 items 11 and 12: every read logged with why it ended, what it used and what it cost, so
-- Admin → Integrations shows the month without the provider's Console. Columns only (additive).
-- `counted`: a read the provider answered with an error and billed nothing does not use up the
-- event's daily reads (D6); `outcome` gains the reasons a read can fail (the CHECK only widens).
ALTER TABLE pizza_reads
  ADD COLUMN reason text CHECK (char_length(reason) <= 200),
  ADD COLUMN pages integer NOT NULL DEFAULT 1 CHECK (pages BETWEEN 1 AND 6),
  ADD COLUMN input_tokens integer CHECK (input_tokens >= 0),
  ADD COLUMN output_tokens integer CHECK (output_tokens >= 0),
  ADD COLUMN cost_micro_usd integer CHECK (cost_micro_usd >= 0),
  ADD COLUMN ms integer CHECK (ms >= 0),
  ADD COLUMN counted boolean NOT NULL DEFAULT true;

ALTER TABLE pizza_reads DROP CONSTRAINT pizza_reads_outcome_check;
ALTER TABLE pizza_reads ADD CONSTRAINT pizza_reads_outcome_check CHECK (outcome IN (
  'ok', 'failed', 'rejected', 'timeout', 'service_down', 'rate_limited', 'out_of_credit',
  'declined', 'unreadable'
));
