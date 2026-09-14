-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'RETRY_PENDING', 'PROCESSING', 'PROCESSED', 'VALIDATION_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FINANCIAL_STATEMENT', 'BANK_STATEMENT', 'REGISTRATION_CERTIFICATE', 'TAX_RETURN', 'OTHER');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "extracted_data" JSONB,
    "validation_errors" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "file_data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_events" (
    "id" BIGSERIAL NOT NULL,
    "document_id" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "attempt" INTEGER,
    "reason" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_content_hash_key" ON "documents"("content_hash");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_document_type_idx" ON "documents"("document_type");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at" DESC);

-- CreateIndex
CREATE INDEX "document_events_document_id_created_at_idx" ON "document_events"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
