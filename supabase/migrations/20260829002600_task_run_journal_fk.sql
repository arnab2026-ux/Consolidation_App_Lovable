-- Phase 5: a task run must not pin its journal in place.
--
-- Every engine is idempotent by deleting its previous document and writing a
-- fresh one. task_run.journal_id referenced journal_header with no ON DELETE
-- action, so as soon as a task run pointed at that document the delete was
-- refused:
--
--   update or delete on table "journal_header" violates foreign key constraint
--   "task_run_journal_id_fkey" on table "task_run"
--
-- Re-running any engine over a period that had already been closed therefore
-- failed - balance carry forward first, since it always targets period 0 and so
-- collides with any earlier close of the same year. Every previous test
-- re-seeded first, which deletes task_run before journal_header and hid it.
--
-- ON DELETE SET NULL is the right semantic: the task run is history and should
-- survive, it just stops pointing at a document that no longer exists. Fixing
-- the constraint once covers all five engines rather than patching each.

alter table public.task_run drop constraint if exists task_run_journal_id_fkey;
alter table public.task_run
  add constraint task_run_journal_id_fkey
  foreign key (journal_id) references public.journal_header(id) on delete set null;

-- upload_batch points at its document the same way, for the same reason.
alter table public.upload_batch drop constraint if exists upload_batch_journal_id_fkey;
alter table public.upload_batch
  add constraint upload_batch_journal_id_fkey
  foreign key (journal_id) references public.journal_header(id) on delete set null;
