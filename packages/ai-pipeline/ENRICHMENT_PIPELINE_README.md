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

The pipeline maintains a state file (`processing_state.json`) that tracks:

```json
{
  "processed": ["file1.json", "file2.json"],
  "failed": ["error_file1.json"],
  "retry_counts": {
    "error_file1.json": 2
  },
  "last_updated": "2025-12-10T10:30:00"
}
```

**State is saved in two locations:**
1. **S3**: `s3://eesa-pipeline-storage/enrichment_state.json` (durable, cloud-accessible)
2. **Local**: `ai_pipeline/processing_state.json` (fast access, local backup)

### S3 Output Structure

```
s3://eesa-pipeline-storage/
  └── enriched_questions/
      ├── Advanced_FEA_1761409395_enriched.json
      ├── Database_Systems_1761403997_enriched.json
      └── ...
```

## Usage

### Basic Usage

```bash
cd ai_pipeline/src
python enrich_questions_s3_pipeline.py
```

This will:
- Process all files in `ai_pipeline/parsedQuestions/`
- Skip already-processed files
- Upload results to S3
- Update state automatically

### Custom Input Directory

```bash
python enrich_questions_s3_pipeline.py "C:/path/to/parsed/questions"
```

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
3. Skip all already-processed files
4. Continue from where it left off

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
   📤 Uploaded to: s3://eesa-pipeline-storage/enriched_questions/Advanced_FEA_enriched.json
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
