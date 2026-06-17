-- FILE: supabase_setup.sql
-- Run this in your Supabase SQL Editor to enable semantic search
-- Path: Supabase Dashboard → SQL Editor → New Query → Paste this entire file
--
-- Compatible with existing digeesell-chatbot schema:
--   documents(id, content, embedding, category, created_at)
-- If your table was created by an older script with a "metadata" column, that
-- still works — the functions below handle both layouts.

-- ============================================================================
-- 1. ENABLE VECTOR EXTENSION
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. ENSURE DOCUMENTS TABLE EXISTS (matches your live schema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id         BIGSERIAL PRIMARY KEY,
  content    TEXT NOT NULL,
  embedding  vector(1536),
  category   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add category column if an older table exists without it
ALTER TABLE documents ADD COLUMN IF NOT EXISTS category TEXT;

-- Optional: add metadata JSONB for scripts that store {title, category} together
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON TABLE documents IS 'DigeeSell Knowledge Base — KB chunks with embeddings for semantic search';

-- ============================================================================
-- 3. CREATE INDEX FOR FAST VECTOR SEARCH
-- ============================================================================
-- ivfflat needs some rows first; safe to run even on empty table
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS documents_category_idx ON documents (category);

-- ============================================================================
-- 4. SEMANTIC SEARCH RPC (called from knowledge.js)
-- ============================================================================
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id bigint,
  content text,
  category text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.category,
    (1 - (documents.embedding <=> query_embedding))::float AS similarity
  FROM documents
  WHERE documents.embedding IS NOT NULL
    AND (1 - (documents.embedding <=> query_embedding)) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_documents(vector, float, int) IS
  'Semantic search: returns top KB chunks above similarity threshold.';

-- ============================================================================
-- 5. TEXT SEARCH FALLBACK (keyword lookup when embeddings unavailable)
-- ============================================================================
CREATE OR REPLACE FUNCTION search_documents_text(
  search_query text,
  limit_count int DEFAULT 5
)
RETURNS TABLE (
  id bigint,
  content text,
  category text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.category
  FROM documents
  WHERE documents.content ILIKE ('%' || search_query || '%')
     OR documents.category ILIKE ('%' || search_query || '%')
  ORDER BY LENGTH(documents.content) ASC
  LIMIT limit_count;
$$;

COMMENT ON FUNCTION search_documents_text(text, int) IS
  'Keyword fallback search on content and category columns.';

-- ============================================================================
-- 6. ROW LEVEL SECURITY (optional — uncomment if you need auth)
-- ============================================================================
-- ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow read access" ON documents FOR SELECT USING (true);
-- CREATE POLICY "Allow insert for service role" ON documents FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 7. VERIFICATION (run manually after this script)
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'documents'
-- ORDER BY ordinal_position;
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_name IN ('match_documents', 'search_documents_text');
--
-- SELECT id, category, LEFT(content, 60) FROM documents LIMIT 5;

-- ============================================================================
-- NEXT STEPS:
-- ============================================================================
-- 1. Run this entire SQL file in Supabase SQL Editor  ← you are here
-- 2. Your table already has 10 rows — no re-seed needed unless you want fresh data
-- 3. To re-seed: node scripts/seedKnowledge.js
-- 4. Test a call — agent will use match_documents for semantic KB lookup
