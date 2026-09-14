-- Drops the inline-bytes column. The second storage driver it existed for
-- (STORAGE_DRIVER=postgres) was never enabled in any environment, and storing
-- file bytes in the documents row is the wrong answer for real volume anyway —
-- object storage is. Files live on disk behind the FileStorage interface, which
-- is where an S3 driver would slot in.
ALTER TABLE "documents" DROP COLUMN IF EXISTS "file_data";
