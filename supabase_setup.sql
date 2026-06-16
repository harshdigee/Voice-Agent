-- Run this ONCE in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qmpleirkfyehhumybakm/sql

-- 1. Enable vector extension (if not already enabled)
create extension if not exists vector;

-- 2. Create the match_documents function for semantic search
create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  content text,
  category text,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.category,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;
