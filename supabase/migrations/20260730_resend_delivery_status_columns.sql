-- delivery_queue.status only ever reflected whether resend.emails.send()
-- was ACCEPTED by the Resend API, not whether the email actually reached
-- the inbox. Adding a new Resend webhook handler (api/resend-webhook.js)
-- that receives real delivery events (delivered/bounced/complained/delayed)
-- and needs somewhere to store the outcome, plus Resend's own email_id so
-- incoming webhook events can be matched back to the right delivery_queue
-- row (captured at send time in api/process-pending.js).

ALTER TABLE delivery_queue
ADD COLUMN IF NOT EXISTS resend_email_id text;

ALTER TABLE delivery_queue
ADD COLUMN IF NOT EXISTS actual_delivery_status text;
