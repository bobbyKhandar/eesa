# Manual Pipeline CLI

A **brutal, reliable pipeline** for processing 100k+ question papers with:

- ✅ **SQLite-based tracking** (no MongoDB dependency)
- ✅ **Manual phase-by-phase control** 
- ✅ **Comprehensive error tracking and retry**
- ✅ **Separate error storage** for easy recovery
- ✅ **Batch processing with resume capability**
- ✅ **Duplicate detection** via file hash

## Quick Start

```bash
cd ai_pipeline/src

# Check status
python manual_pipeline.py status

# Upload PDFs
python manual_pipeline.py upload /path/to/pdfs --recursive

# Process each phase manually
python manual_pipeline.py ocr --batch-size 10
python manual_pipeline.py parse --batch-size 10
python manual_pipeline.py enrich --batch-size 10
python manual_pipeline.py organize --batch-size 10

# Handle errors
python manual_pipeline.py retry-errors --phase parse
python manual_pipeline.py export-errors
```

## Pipeline Phases

```
┌─────────────────────────────────────────────────────────────────┐
│                     MANUAL PIPELINE FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌───────┐    ┌───────┐    ┌────────┐    ┌────┐ │
│  │  UPLOAD  │ →  │  OCR  │ →  │ PARSE │ →  │ ENRICH │ →  │ ORG │ │
│  └──────────┘    └───────┘    └───────┘    └────────┘    └────┘ │
│       │              │            │             │            │   │
│       ↓              ↓            ↓             ↓            ↓   │
│   [SQLite DB tracks state at every phase with retry support]    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1: Upload
- Scans directories for PDF files
- Calculates file hash for duplicate detection
- Uploads to S3 under `manual_pipeline/{job_id}/original/`
- Creates job record in SQLite

### Phase 2: OCR
- Uses AWS Textract async processing
- Polls for completion (max 10 min timeout)
- Extracts all text lines with confidence scores
- Saves to `manual_pipeline/{job_id}/ocr_output/`

### Phase 3: Parse
- Downloads OCR text
- Sends to AWS Bedrock (Gemma 27B model)
- Parses into structured exam/question format
- Saves to `manual_pipeline/{job_id}/parsed_output/`

### Phase 4: Enrich
- Downloads parsed questions
- Classifies with Bloom's taxonomy in batches of 10
- Each batch must return one entry per question. `bloomLevel` must be Recall, Understand, Apply, Analyze, Evaluate, or Create. `difficulty` must be Easy, Medium, or Hard. `keywords` and `topicsCovered` must be lists of strings (empty lists are allowed)
- A short response, extra entries, or invalid fields are retried up to 3 times for that batch
- If a batch is still incomplete, the job fails and stays in the enrich phase. A partial classification is not uploaded and does not advance to organize
- Saves a complete result to `manual_pipeline/{job_id}/enriched_output/`

### Phase 5: Organize
- Groups exams by subject
- Creates master index
- Saves to `manual_pipeline/{job_id}/organized_output/`

## Commands Reference

### Status
```bash
python manual_pipeline.py status
```
Shows:
- Total jobs count
- Jobs by phase
- Jobs by status
- Error summary
- Data directory location

### Upload PDFs
```bash
# Single file
python manual_pipeline.py upload /path/to/file.pdf

# Directory
python manual_pipeline.py upload /path/to/pdfs/

# Recursive (includes subdirectories)
python manual_pipeline.py upload /path/to/pdfs/ --recursive

# With custom batch ID
python manual_pipeline.py upload /path/to/pdfs/ --batch-id my_batch_001

# Dry run (preview only)
python manual_pipeline.py upload /path/to/pdfs/ --dry-run
```

### Process Phase
```bash
# Process 10 jobs in OCR phase
python manual_pipeline.py ocr --batch-size 10

# Process all pending parse jobs
python manual_pipeline.py parse --batch-size 100

# Dry run to see what would be processed
python manual_pipeline.py enrich --dry-run
```

`--batch-size` must be an integer greater than or equal to 1. Zero and negative values are rejected by the CLI and by `process_batch`.

### List Jobs
```bash
# List all OCR jobs
python manual_pipeline.py list ocr

# List only failed jobs in parse phase
python manual_pipeline.py list parse --status failed

# Limit results with verbose output
python manual_pipeline.py list enrich --limit 20 --verbose
```

### Retry Errors
```bash
# Retry all parse failures
python manual_pipeline.py retry-errors --phase parse

# Retry a specific job
python manual_pipeline.py retry-errors --job-id abc123

# Retry ALL failures across all phases
python manual_pipeline.py retry-errors --all
```

### Export Errors
```bash
# Export all errors to JSON
python manual_pipeline.py export-errors

# Export only parse errors
python manual_pipeline.py export-errors --phase parse
```

## Data Storage

### Local Files
```
ai_pipeline/
└── manual_pipeline_data/
    ├── pipeline.db           # SQLite database
    ├── errors/               # Error details by phase
    │   ├── ocr/
    │   ├── parse/
    │   ├── enrich/
    │   └── organize/
    ├── exports/              # Error export files
    └── logs/                 # Processing logs
```

### S3 Structure
```
s3://eesa-pipeline-storage/
└── manual_pipeline/              # Separate from production!
    └── {job_id}/
        ├── original/             # PDF files
        │   └── filename.pdf
        ├── ocr_output/
        │   └── filename_ocr.json
        ├── parsed_output/
        │   └── filename_parsed.json
        ├── enriched_output/
        │   └── filename_enriched.json
        └── organized_output/
            ├── _master_index.json
            └── {subject}/
                └── {subject}.json
```

## Database Schema

### jobs table
| Column | Type | Description |
|--------|------|-------------|
| job_id | TEXT | UUID primary key |
| filename | TEXT | Original filename |
| file_hash | TEXT | MD5 hash for duplicates |
| current_phase | TEXT | Current pipeline phase |
| status | TEXT | pending/in_progress/success/failed |
| s3_original_key | TEXT | S3 key for PDF |
| s3_ocr_key | TEXT | S3 key for OCR output |
| s3_parsed_key | TEXT | S3 key for parsed output |
| s3_enriched_key | TEXT | S3 key for enriched output |
| s3_organized_key | TEXT | S3 key for organized output |
| error_message | TEXT | Last error message |
| error_phase | TEXT | Phase where error occurred |
| retry_count | INT | Number of retry attempts |
| questions_count | INT | Total questions found |
| exams_count | INT | Total exams found |

### error_log table
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Auto-increment ID |
| job_id | TEXT | Reference to jobs.job_id |
| phase | TEXT | Phase where error occurred |
| error_type | TEXT | Exception type |
| error_message | TEXT | Error message |
| error_traceback | TEXT | Full traceback |
| s3_location | TEXT | Relevant S3 key |
| input_data | TEXT | Truncated input that caused error |
| is_resolved | INT | 0=unresolved, 1=resolved |
| retry_attempt | INT | Which retry attempt this was |

## Error Handling

### Automatic Error Tracking
Every error is:
1. Logged to SQLite `error_log` table
2. Saved to JSON file in `errors/{phase}/`
3. Recorded on the job with `error_message` and `error_phase`
4. Job status set to `failed` and `retry_count` incremented

A handled error never leaves a job `in_progress`. Each processor records an
unsuccessful result through one shared transition, and `process_batch`
records a returned failure the processor did not record itself, so the job
is selected again by the phase queries and by `retry-errors`. A logging
failure is reported and never blocks the status update.

A run interrupted between the `in_progress` update and the outcome update
(Ctrl-C, crash, killed container) leaves the row claimed. Those rows are
reclaimed to `pending` once they are older than an hour, both before a batch
selects work and before `batch_runner.py` counts a phase as empty, so the run
stops only when there really is no work.

### Manual Error Recovery
```bash
# 1. Export errors to see what failed
python manual_pipeline.py export-errors

# 2. Review error files
ls manual_pipeline_data/errors/parse/

# 3. Mark for retry
python manual_pipeline.py retry-errors --phase parse

# 4. Re-run the phase
python manual_pipeline.py parse --batch-size 10
```

Retry targets are validated. `--phase` accepts only `ocr`, `parse`,
`enrich`, and `organize`; anything else is refused instead of moving jobs
into a phase nothing processes. `--job-id` retries a `failed` or
`retry_pending` job from its `error_phase`, or from `current_phase` when that
phase is empty, and reports a job that is not failed or has no retryable
phase.

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Textract timeout | Large PDF or AWS busy | Retry with smaller batches |
| JSON parse error | LLM returned bad JSON | Retry (different response) |
| Empty OCR text | Scanned image quality | Check original PDF |
| No questions parsed | Unusual format | Manual review needed |

## Production Tips

### For 100k+ Questions

1. **Run in batches**
   ```bash
   # Process 50 at a time, wait between batches
   python manual_pipeline.py ocr --batch-size 50
   sleep 60
   python manual_pipeline.py ocr --batch-size 50
   ```

2. **Monitor with status**
   ```bash
   watch -n 30 'python manual_pipeline.py status'
   ```

3. **Parallel phase processing**
   - Upload all PDFs first
   - Run OCR for all
   - Then parse all
   - This maximizes throughput

4. **Handle errors at end**
   - Let the pipeline run through all files
   - Export and analyze errors
   - Retry in bulk

### Cost Management

- OCR (Textract): ~$1.50 per 1000 pages
- Parse (Bedrock): ~$0.30 per 1M input tokens
- Enrich (Bedrock): ~$0.30 per 1M input tokens

For 3000 PDFs (avg 10 pages each):
- OCR: ~$45
- LLM: ~$20-30
- **Total: ~$70-80**

## Troubleshooting

### "No jobs pending for phase: ocr"
```bash
# Check if jobs exist
python manual_pipeline.py list ocr --status pending
python manual_pipeline.py list ocr --status failed
```

A run older than an hour that was interrupted leaves a job `in_progress`. The
next batch reclaims it to `pending`, so check that status too, and use
`retry-errors --job-id <id>` to re-queue one immediately:
```bash
python manual_pipeline.py list ocr --status in_progress
python manual_pipeline.py check-job <job_id>
```

### Database Issues
```bash
# Backup and reset
cp manual_pipeline_data/pipeline.db manual_pipeline_data/pipeline.db.bak
rm manual_pipeline_data/pipeline.db
python manual_pipeline.py status  # Recreates DB
```

### S3 Permission Errors
```bash
# Check AWS credentials
aws sts get-caller-identity
aws s3 ls s3://eesa-pipeline-storage/manual_pipeline/ --max-items 5
```

## Integration with Frontend

This pipeline is **intentionally separate** from the frontend/MongoDB system:

- Uses different S3 prefix (`manual_pipeline/` vs `jobs/`)
- Uses SQLite instead of MongoDB
- No API endpoints - CLI only
- Can run while frontend is live

To import processed data to production:
1. Export organized output from S3
2. Import to MongoDB using separate script
3. (Future: add `import-to-prod` command)

## Requirements

```
boto3>=1.28.0
```

AWS permissions needed:
- `textract:StartDocumentTextDetection`
- `textract:GetDocumentTextDetection`
- `bedrock:InvokeModel`
- `s3:GetObject`
- `s3:PutObject`
- `s3:HeadObject`
