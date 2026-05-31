# Question Clustering Setup Guide

## Overview
The question clustering module uses **LanceDB** for vector similarity search with metadata filtering to automatically:
- Find similar questions across different years with metadata filters
- Calculate appearance frequency
- Group questions by topic/concept using HDBSCAN
- Populate `similarQuestionIds` and `appearanceFrequency` fields
- Enable complex queries (e.g., "similar questions in same subject from 2022-2024")

## Why LanceDB?

### Advantages Over FAISS
1. **Persistent Storage** - No rebuilding index on restart
2. **Metadata Filtering** - Filter by subject, year, semester during search
3. **SQL-like Queries** - Complex queries on both vectors and metadata
4. **Serverless** - Embedded database, no separate server
5. **Production Ready** - Built for real applications, not just research

### Use Cases
```python
# Find similar questions in same subject
similar = table.search(vector).where("subject = 'Computer Networks'").limit(5)

# Find similar questions from specific years
similar = table.search(vector).where("year IN ('2022', '2023', '2024')").limit(10)

# Cross-year pattern analysis
all_matches = table.search(vector).where("semester = '5'").limit(100)
```

## Installation

### 1. Install Python Dependencies

```bash
cd ai_pipeline
pip install lancedb hdbscan pyarrow
```

Or install all requirements:
```bash
pip install -r requirements-ocr.txt
```

### 2. Verify Installation

```bash
python -c "import lancedb, hdbscan; print('✓ Dependencies installed')"
```

### 3. Configure Storage (Optional)

By default, LanceDB stores data in `./lancedb_data`. To change:

```bash
export LANCEDB_PATH="/path/to/lancedb/storage"
```

Or edit `ai_pipeline/src/question_clustering.py`:
```python
LANCEDB_PATH = "./my_custom_path"
```

## How It Works

### Architecture
```
Organized Output (S3)
    ↓
Load All Questions
    ↓
Generate Embeddings (AWS Bedrock Titan)
    ↓
Store in LanceDB (Vectors + Metadata)
    ↓
Vector Search with Metadata Filters
    ↓
HDBSCAN Topic Clustering
    ↓
Calculate Appearance Frequency
    ↓
Update Questions in S3
```

### Key Features

1. **Embedding Generation**
   - Uses AWS Bedrock Titan Embeddings (512-dim)
   - Combines question text + keywords for better matching
   - Normalized for cosine similarity

2. **LanceDB Vector Search**
   - Fast approximate nearest neighbor (ANN) search with HNSW
   - Metadata filtering during search
   - Persistent storage (survives restarts)
   - SQL-like query interface

3. **HDBSCAN Clustering**
   - Density-based clustering (no need to specify k)
   - Automatically discovers topic groups
   - Handles noise (unclustered questions)

4. **Appearance Frequency**
   - Tracks how often similar questions appear
   - Lists years where similar questions were asked
   - Helps identify recurring patterns

## Configuration

Edit `ai_pipeline/src/question_clustering.py`:

```python
# Adjust these parameters
SIMILARITY_THRESHOLD = 0.85  # Lower = more similar questions found
MIN_CLUSTER_SIZE = 2         # Minimum questions to form a cluster
EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"  # AWS Bedrock model
```

## Usage

### Automatic Integration
The clustering stage runs automatically as **Stage 5** in the pipeline:
1. OCR (Textract)
2. Parsing
3. Enrichment
4. Organization
5. **Clustering** ← New!

### Manual Execution
Test clustering on an existing job:

```bash
cd ai_pipeline
python src/question_clustering.py <job_id> <filename>
```

Example:
```bash
python src/question_clustering.py ad4e0c87-52e7-41d9-81d5-46822f693e05 test.pdf
```

## Output

### Updated Question Fields
Each question gets three new fields:

```json
{
  "questionNumber": "1(a)",
  "questionText": "Explain TCP/IP protocol",
  "similarQuestionIds": ["2(b)", "5(a)"],  // Similar questions found
  "appearanceFrequency": {
    "count": 3,
    "years": [2022, 2023, 2024]
  },
  "clusterId": 5  // Topic cluster number
}
```

### Clustering Summary
Saved to S3: `jobs/{job_id}/clustering_summary.json`

```json
{
  "total_questions": 45,
  "total_similar_pairs": 12,
  "high_similarity_pairs": 3,
  "n_clusters": 8,
  "similarity_threshold": 0.85,
  "embedding_model": "amazon.titan-embed-text-v2:0"
}
```

## Benefits

1. **Student Study Aid**
   - See which questions appear frequently
   - Identify important topics

2. **Faculty Analysis**
   - Track question repetition patterns
   - Identify overused questions
   - Ensure diverse question coverage

3. **Question Bank Management**
   - Auto-detect duplicates
   - Organize questions by conceptual similarity
   - Build better question pools

## Cost Considerations

### AWS Bedrock Costs
- Titan Embeddings: ~$0.0001 per 1K input tokens
- For 100 questions (~500 words each): ~$0.05
- Cost is minimal for typical exams (20-50 questions)

### Performance
- Embedding generation: ~1 second per question (AWS Bedrock)
- LanceDB insertion: ~5ms per question
- Vector search: ~10-50ms per query (depends on dataset size)
- HDBSCAN clustering: ~1-2 seconds for 100 questions
- **Total overhead: ~35 seconds for 30-question exam**

### Storage
- LanceDB uses columnar storage (Parquet)
- ~1-2KB per question (vector + metadata)
- 1000 questions ≈ 1-2MB storage
- Persistent between runs (no rebuilding)

## Troubleshooting

### Module Not Available
If clustering is skipped:
```bash
pip install lancedb hdbscan pyarrow
```

### LanceDB Storage Issues
Check storage path and permissions:
```bash
ls -la lancedb_data/  # Linux/Mac
dir lancedb_data\     # Windows

# Or set custom path
export LANCEDB_PATH="/custom/path"
```

### Out of Memory
For large question sets (>10,000 questions):
- LanceDB handles this well automatically
- Adjust batch size for embedding generation
- Consider chunking large uploads

### Slow Search Performance
If searches become slow (>100ms):
```python
# In question_clustering.py, optimize index
table.create_index(
    metric="cosine",
    num_partitions=256,
    num_sub_vectors=96
)
```

### Poor Clustering Results
Adjust parameters:
- Lower `SIMILARITY_THRESHOLD` (e.g., 0.80) for more matches
- Adjust `MIN_CLUSTER_SIZE` for cluster granularity
- Use larger embedding dimensions (1024 instead of 512)

## Future Enhancements

- [ ] Advanced metadata filtering UI
- [ ] Cross-subject similarity detection
- [ ] Question difficulty clustering
- [ ] Temporal trend analysis (topic emergence over years)
- [ ] Question recommendation system
- [ ] Duplicate detection with automatic merging
- [ ] API endpoints for querying LanceDB directly
- [ ] Real-time similarity search as questions are created
