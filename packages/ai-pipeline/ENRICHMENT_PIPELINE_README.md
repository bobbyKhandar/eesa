# Question Enrichment Pipeline - AWS Bedrock + S3

This pipeline processes parsed question JSON files and enriches them with **Bloom's Taxonomy** analysis using **AWS Bedrock**, then saves the enriched results to **S3**.

## Features

✅ **Automatic State Management** - Resumes from where it left off  
✅ **S3 Storage** - All enriched questions saved to S3  
✅ **Smart Retry Logic** - Processes error files separately with configurable retries  
✅ **Phased Processing** - Non-error files first, then error files  
✅ **Persistent State** - State stored in both S3 and local file for redundancy  
✅ **Cost Tracking** - Estimates AWS Bedrock costs  
✅ **Bloom's Taxonomy** - Adds educational metadata to each question  

## How It Works

### Processing Phases

**Phase 1: Non-Error Files**
- Processes all files without "error" in the name
- Uses full system instructions
- Single attempt per file

**Phase 2: Error Files** 
- Processes files with "error" in the name
- Processes WITHOUT system instructions (simpler prompts)
- Up to 3 retry attempts per file
- Skips files that have reached max retries

### State Management

The pipeline maintains a state file (`processing_state.json`) that tracks each input by a **source identity**, not by its basename:

```json
{
  "processed": [
    "file1.json__ns0123456789ab",
    "semester/file2.json__ns0123456789ab"
  ],
  "failed": ["error_file1.json__ns0123456789ab"],
  "retry_counts": {
    "error_file1.json__ns0123456789ab": 2
  },
  "legacy_unscoped_processed": [],
  "legacy_unscoped_failed": [],
  "legacy_unscoped_retry_counts": {},
  "source_namespace": null,
  "last_updated": "2025-12-10T10:30:00"
}
```

`source_namespace` stays unset unless you set it yourself to adopt an older basename state. See [Source identity and legacy state](#source-identity-and-legacy-state).

**State is saved in two locations:**
1. **S3**: `s3://eesa-pipeline-storage/enrichment_state.json` (durable, cloud-accessible)
2. **Local**: `ai_pipeline/processing_state.json` (fast access, local backup)

### S3 Output Structure

```
s3://eesa-pipeline-storage/
  └── enriched_questions/
      ├── Advanced_FEA_1761409395.json__ns0123456789ab_enriched.json
      ├── semester/Database_Systems_1761403997.json__ns0123456789ab_enriched.json
      └── ...
```

The `__ns` segment is the input directory's hash, so `dir_a/questions.json` and `dir_b/questions.json` are different objects.

## Usage

### Basic Usage

```bash
cd ai_pipeline/src
python enrich_questions_s3_pipeline.py
```

This will:
- Process all files in `ai_pipeline/parsedQuestions/`
- Skip files whose source identity is already in `processed`
- Upload results to S3 under that same identity
- Update state automatically

### Custom Input Directory

```bash
python enrich_questions_s3_pipeline.py "C:/path/to/parsed/questions"
```

### Source identity and legacy state

Each file is identified by:

```text
{relative_path}__ns{namespace_hash}
```

- `relative_path` is the file's path relative to the input directory, in POSIX form. The input directory is the root. `.` and `..` are collapsed and symlinks are resolved, so a trailing slash or an equivalent relative path does not change the id.
- `namespace_hash` is the first 12 hex characters of SHA-256 over that normalized absolute directory. Windows paths are case-folded before hashing.

`dir_a/questions.json` and `dir_b/questions.json` therefore get different processed entries and different keys:

```text
enriched_questions/questions.json__ns{hash_of_dir_a}_enriched.json
enriched_questions/questions.json__ns{hash_of_dir_b}_enriched.json
```

Older state files stored only the basename (`questions.json`) in `processed`, `failed`, and `retry_counts`. On each run:

1. Entries that already use a source identity are left as-is. They skip only that exact input.
2. Bare basenames are **not** applied to the current directory by default. They are moved to `legacy_unscoped_processed`, `legacy_unscoped_failed`, and `legacy_unscoped_retry_counts`. A new file that shares the name is processed, including the same basename in another directory. The pipeline does not guess which directory produced the old entry.
3. To keep skipping files from the directory that produced the legacy state, set `source_namespace` to that directory before re-running. The comparison uses the same normalization as the hash (absolute path, symlinks resolved, trailing separator removed). When it matches, each bare basename that maps to **exactly one** file in that directory is rewritten to the new identity and stays in `processed`, `failed`, or `retry_counts`. If two files share the basename, the entry stays unscoped and **neither** file is skipped.
4. Setting `source_namespace` after an earlier run still works. Parked `legacy_unscoped_*` entries are adopted on the next matching run. Running a different directory does not adopt them, and the pipeline never fills in `source_namespace` from the directory you happened to pass.
5. Objects already stored at `enriched_questions/{basename}_enriched.json` are left in place. New writes use the namespaced key, so a reprocessed file does not overwrite the old object.

### Supported helpers

`pipeline_orchestrator.py` calls these public functions. `upload_enriched_to_s3` takes the source identity from `source_identity`, not a bare filename:

- `ensure_s3_bucket_exists()`
- `load_state()` / `save_state(state)`
- `enrich_single_file(file_path, filename, use_instructions=True)`
- `upload_enriched_to_s3(enriched_data, source_id)`

### Force Reprocess All Files

To ignore state and reprocess everything:

```python
# In the script, change:
process_all_questions(input_directory, skip_processed=False)
```

## Configuration

Edit these variables at the top of `enrich_questions_s3_pipeline.py`:

```python
# S3 Configuration
S3_BUCKET = 'eesa-pipeline-storage'
S3_ENRICHED_PREFIX = 'enriched_questions/'

# AWS Bedrock
BEDROCK_MODEL_ID = "google.gemma-3-27b-it"

# Processing
MAX_RETRIES = 3
COST_PER_REQUEST = 0.001
```

## Output Format

Each enriched question includes:

```json
{
  "question_number": "Q1 (a)",
  "question_text": "Explain the Galerkin method...",
  "questionType": "text",
  "marks": "12",
  "bloomLevel": "Apply",
  "bloomJustification": "The student must use the Galerkin method...",
  "confidence": 0.92,
  "difficulty": "Medium",
  "keywords": ["Galerkin", "FEM", "approximation"],
  "topicsCovered": ["Heat Transfer", "Finite Element Method"]
}
```

## Resumability

**If the pipeline stops/crashes:**

1. Simply re-run the script
2. It will load the saved state
3. Skip inputs whose source identity is already in `processed`
4. Continue from where it left off

A basename-only entry from an older state file does not count as processed until `source_namespace` pins it to this input directory. See [Source identity and legacy state](#source-identity-and-legacy-state).

**To reset and start fresh:**

```bash
# Delete state files
rm ai_pipeline/processing_state.json
aws s3 rm s3://eesa-pipeline-storage/enrichment_state.json

# Or rename them for backup
mv ai_pipeline/processing_state.json processing_state.backup.json
```

## Monitoring Progress

The pipeline prints detailed progress:

```
================================================================================
QUESTION ENRICHMENT PIPELINE - AWS BEDROCK + S3
================================================================================
Input directory: C:/project/miniproject/ai_pipeline/parsedQuestions
S3 Bucket: eesa-pipeline-storage
S3 Prefix: enriched_questions/
Max retries per file: 3
Bedrock Model: google.gemma-3-27b-it
================================================================================

📊 Found 450 total files:
   • Non-error files: 430
   • Error files: 20
   • Already processed: 150
   • Previously failed: 5

================================================================================
PHASE 1: Processing Non-Error Files
================================================================================

📚 Enriching: Advanced_FEA.json
   📖 Processing Exam 1: Advanced Finite Element Analysis
      📝 Analyzing 15 questions...
      📤 Requesting Bloom's analysis from Bedrock...
      ✓ Received 15 enrichment entries
      ✓ Enrichment complete!
      🎯 Bloom's Distribution:
         Recall: 2 (13.3%)
         Apply: 8 (53.3%)
         Analyze: 5 (33.3%)
   📤 Uploaded to: s3://eesa-pipeline-storage/enriched_questions/Advanced_FEA.json__ns0123456789ab_enriched.json
✓ State saved locally
✓ State saved to S3
```

## Error Handling

**Network Issues:**
- State is saved after each successful file
- No progress lost on crash/disconnect

**Bedrock API Errors:**
- File added to failed list
- Will retry in Phase 2 (for error files) or on next run

**S3 Upload Failures:**
- Enrichment is cached
- File marked for retry
- Upload attempted again on next run

## Cost Estimation

The pipeline tracks approximate AWS Bedrock costs:

```
💰 Estimated cost: $0.4500

Calculation: 450 files × $0.001/request = $0.45
```

> **Note:** Actual costs depend on your AWS Bedrock pricing tier and token usage

## Requirements

```bash
pip install boto3
```

**AWS Credentials:**
Ensure AWS credentials are configured:

```bash
aws configure
# OR set environment variables:
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_DEFAULT_REGION=ap-south-1
```

## Integration with Existing Pipeline

This pipeline is designed to work with:

**Input:** `awsBedrockPipeline.py` output (parsed questions)  
**Output:** Enriched questions ready for database import

**Workflow:**
```
1. PDFs → OCR (aws_texttract_pipeline.py)
2. OCR Text → Parsed Questions (awsBedrockPipeline.py)
3. Parsed Questions → Enriched Questions (enrich_questions_s3_pipeline.py) ← NEW
4. Enriched Questions → Database Import
```

## Troubleshooting

**"No state file found"**
- Normal on first run
- Pipeline creates new state automatically

**"Max retries reached"**
- File failed 3 times
- Check the error logs
- May need manual review

**"S3 upload failed"**
- Check AWS credentials
- Verify S3 bucket exists
- Check bucket permissions

**"Bedrock request failed"**
- Verify Bedrock access in your AWS account
- Check model ID is correct
- Ensure region is `ap-south-1`

## Example Run

```bash
$ python enrich_questions_s3_pipeline.py

================================================================================
QUESTION ENRICHMENT PIPELINE - AWS BEDROCK + S3
================================================================================
✓ Loaded state from S3: 100 processed, 2 failed

📊 Found 450 total files:
   • Non-error files: 430
   • Error files: 20
   • Already processed: 100
   • Previously failed: 2

================================================================================
PHASE 1: Processing Non-Error Files
================================================================================

⏭ Skipping (already processed): file1.json
⏭ Skipping (already processed): file2.json
...
📚 Enriching: file101.json
   ✓ Enrichment complete!
   📤 Uploaded to S3
...

================================================================================
PHASE 2: Processing Error Files (with retries)
================================================================================

🔄 Retry 1/3: error_file1.json
   ✓ Success after 1 attempts!

🔄 Retry 3/3: error_file2.json
   ✗ Failed to get Bloom's classification

================================================================================
ENRICHMENT SUMMARY
================================================================================
✓ Total processed: 350
🆕 Newly processed: 250
✗ Failed: 1
⏭ Skipped: 100
💰 Estimated cost: $0.3500

📊 Current state:
   • Total ever processed: 350
   • Current failures: 1
   • Files pending retry: 0
   • Files at max retries: 1
================================================================================
```
