# AI Pipeline Split Architecture

## 🎯 Overview

The AI pipeline has been refactored into **4 independent slave pipelines**, each with a single responsibility. This modular architecture improves maintainability, scalability, and error handling.

---

## 📊 Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         server.py (Master)                       │
│                     Flask REST API Orchestrator                  │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ├─────► 1. aws_texttract_pipeline.py (OCR)
                │       Input:  PDF files
                │       Output: Extracted text
                │       Cost:   $0.0015/page
                │
                ├─────► 2. parsing_pipeline.py (Parse Questions)
                │       Input:  OCR text
                │       Output: Structured JSON with questions
                │       Cost:   ~$0.002/request
                │
                ├─────► 3. enrich_questions_job_based.py (Bloom's)
                │       Input:  Parsed questions
                │       Output: Questions + Bloom's taxonomy
                │       Cost:   ~$0.001/request
                │
                └─────► 4. organize_by_subject_job_based.py (Organize)
                        Input:  Enriched questions
                        Output: Organized by subject
                        Cost:   ~$0.0001/operation
```

---

## 📁 File Structure

### **Slave Pipelines** (Independent Workers)

| File | Purpose | Input | Output | Retry Logic |
|------|---------|-------|--------|-------------|
| `aws_texttract_pipeline.py` | OCR extraction | PDF in S3 | OCR text JSON | ✅ MAX_RETRIES=3 |
| `parsing_pipeline.py` | Question parsing | OCR text | Parsed questions JSON | ✅ MAX_RETRIES=3 |
| `enrich_questions_job_based.py` | Bloom's taxonomy | Parsed questions | Enriched questions JSON | ✅ MAX_RETRIES=3 |
| `organize_by_subject_job_based.py` | Subject organization | Enriched questions | Organized folders | ❌ No retry |

### **Master Orchestrator**

| File | Purpose |
|------|---------|
| `server.py` | Flask REST API server that orchestrates all pipelines |

### **Test Suites**

| File | Tests | Status |
|------|-------|--------|
| `test_textract_pipeline.py` | 13 tests | ✅ Complete |
| `test_parsing_pipeline.py` | 10 tests | ✅ Complete |
| `test_enrichment_pipeline.py` | 38 tests | ✅ Complete |
| `test_organize_by_subject.py` | 9 tests | ✅ Complete |

---

## 🔄 Data Flow

### **S3 Job-Based Structure**

All pipelines follow the same S3 structure:

```
s3://eesa-pipeline-storage/jobs/{job_id}/
├── original/              # PDF files
├── ocr_output/            # Textract results
├── parsed_output/         # Parsed questions
├── enriched_output/       # Bloom's enriched
├── organized_output/      # Organized by subject
│   ├── Computer_Science/
│   │   ├── CS_2023_I_main.json
│   │   └── _index.json
│   └── _master_index.json
└── metadata.json          # Job tracking
```

### **Processing Stages**

```
Stage 1: OCR Extraction
  Input:  jobs/{job_id}/original/exam.pdf
  Output: jobs/{job_id}/ocr_output/exam_ocr.json
  
Stage 2: Question Parsing
  Input:  jobs/{job_id}/ocr_output/exam_ocr.json
  Output: jobs/{job_id}/parsed_output/exam_parsed.json
  
Stage 3: Bloom's Enrichment
  Input:  jobs/{job_id}/parsed_output/exam_parsed.json
  Output: jobs/{job_id}/enriched_output/exam_enriched.json
  
Stage 4: Subject Organization
  Input:  jobs/{job_id}/enriched_output/exam_enriched.json
  Output: jobs/{job_id}/organized_output/{subject}/...
```

---

## ⚙️ Configuration

### **Environment Variables**

```bash
# AWS Configuration
S3_BUCKET=eesa-pipeline-storage
SNS_TOPIC_ARN=arn:aws:sns:...  # Optional
SNS_ROLE_ARN=arn:aws:iam:...   # Optional

# Redis Configuration (for old pipeline)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### **Pipeline Constants**

```python
# Textract (aws_texttract_pipeline.py)
MAX_RETRIES = 3
COST_PER_PAGE_ASYNC = 0.0015
MAX_BATCH_RETRY_ROUNDS = 3

# Parsing (parsing_pipeline.py)
MAX_RETRIES = 3
MODEL_ID = "google.gemma-3-27b-it"
COST_PER_1K_INPUT_TOKENS = 0.0008
COST_PER_1K_OUTPUT_TOKENS = 0.0024

# Enrichment (enrich_questions_job_based.py)
MAX_RETRIES = 3
MAX_CONCURRENT_REQUESTS = 20
COST_PER_REQUEST = 0.001

# Organization (organize_by_subject_job_based.py)
COST_PER_ORGANIZATION = 0.0001
```

---

## 🚀 Usage Examples

### **1. Process Single File Through All Stages**

```python
from aws_texttract_pipeline import process_document_async
from parsing_pipeline import parse_questions_for_job
from enrich_questions_job_based import enrich_questions_for_job
from organize_by_subject_job_based import organize_by_subject_for_job

job_id = "abc-123"
filename = "exam.pdf"

# Stage 1: OCR
ocr_success = process_document_async(
    s3_bucket="eesa-pipeline-storage",
    s3_key=f"jobs/{job_id}/original/{filename}",
    job_id=job_id
)

# Stage 2: Parse
parse_result = parse_questions_for_job(job_id, filename)

# Stage 3: Enrich
enrich_result = enrich_questions_for_job(job_id, filename)

# Stage 4: Organize
organize_result = organize_by_subject_for_job(job_id, filename)
```

### **2. Batch Processing with Retry**

```python
from aws_texttract_pipeline import process_batch_with_retry

files = [
    ('eesa-pipeline-storage', 'jobs/job1/original/exam1.pdf', 'job1'),
    ('eesa-pipeline-storage', 'jobs/job1/original/exam2.pdf', 'job1'),
    ('eesa-pipeline-storage', 'jobs/job1/original/exam3.pdf', 'job1'),
]

result = process_batch_with_retry(files)

print(f"Success rate: {result['success_rate']}%")
print(f"Failed files: {len(result['failed_files'])}")
```

### **3. Skip Specific Stages**

```python
# Only OCR and parse (skip Bloom's and organization)
ocr_success = process_document_async(...)
parse_result = parse_questions_for_job(...)

# Or only enrich and organize (already have parsed questions)
enrich_result = enrich_questions_for_job(...)
organize_result = organize_by_subject_for_job(...)
```

---

## 🔍 Testing

### **Run All Tests**

```bash
# Test Textract pipeline
python test_textract_pipeline.py

# Test parsing pipeline
python test_parsing_pipeline.py

# Test enrichment pipeline
python test_enrichment_pipeline.py

# Test organization pipeline
python test_organize_by_subject.py
```

### **Test Coverage**

| Pipeline | Tests | Coverage |
|----------|-------|----------|
| Textract | 13 tests | Job start, polling, timeout, S3 save, retry, batch processing |
| Parsing | 10 tests | OCR load, Bedrock call, JSON validation, retry, array wrapping |
| Enrichment | 38 tests | State management, Bloom's classification, concurrent processing |
| Organization | 9 tests | Subject grouping, file naming, metadata, S3 upload |

---

## 📈 Advantages of Split Architecture

### **1. Single Responsibility**
- Each pipeline does ONE thing well
- Easier to debug and maintain
- Clear separation of concerns

### **2. Independent Scaling**
- Run Bloom's with 20 workers
- Run organization with 3 workers
- Different retry strategies per stage

### **3. Flexible Workflow**
- Can skip stages (e.g., no Bloom's if not needed)
- Can run stages on already processed data
- Easy to add new stages (e.g., difficulty analysis)

### **4. Better Error Handling**
- If Bloom's fails, you still have organized subjects
- Can retry failed stages independently
- Clear visibility into which stage failed

### **5. Cost Optimization**
- Bloom's enrichment is expensive (Bedrock calls)
- Organization is cheap (JSON manipulation)
- Can delay expensive stages for batch processing

### **6. Parallel Development**
- Different developers can work on different pipelines
- Independent testing and deployment
- No merge conflicts

---

## 🆚 Before vs After

### **Before (Monolithic)**

```python
# awsBedrockPipeline.py (600+ lines)
- parse_questions()           # OCR → JSON
- enrich_with_blooms()        # Add Bloom's
- process_directory()         # Batch processing
- enrich_directory()          # Batch enrichment
```

**Problems:**
- ❌ Does too much in one file
- ❌ Hard to test individual stages
- ❌ Can't skip stages
- ❌ Mixed retry logic
- ❌ Difficult to scale independently

### **After (Modular)**

```python
# 1. parsing_pipeline.py (~300 lines)
- parse_questions_for_job()   # OCR → JSON

# 2. enrich_questions_job_based.py (~400 lines)
- enrich_questions_for_job()  # Add Bloom's

# 3. organize_by_subject_job_based.py (~360 lines)
- organize_by_subject_for_job() # Group by subject
```

**Benefits:**
- ✅ Single responsibility per file
- ✅ Independent testing (70 total tests)
- ✅ Flexible stage skipping
- ✅ Clear retry strategies
- ✅ Easy to scale independently

---

## 🎓 Best Practices

### **When to Use Which Pipeline**

1. **Just need OCR?** → Use `aws_texttract_pipeline.py` only
2. **Need structured questions?** → Textract + Parsing
3. **Need Bloom's taxonomy?** → Textract + Parsing + Enrichment
4. **Need organized subjects?** → All 4 pipelines

### **Error Handling**

Each pipeline returns structured metadata:

```python
{
    'job_id': 'abc-123',
    'filename': 'exam.pdf',
    'total_questions': 50,
    'processing_cost': 0.0234,
    'retry_count': 1,  # How many retries needed
    'status': 'success'
}
```

### **Cost Tracking**

All pipelines track and return processing costs:

```python
# After processing
print(f"Textract: ${textract_cost:.4f}")
print(f"Parsing: ${parse_cost:.4f}")
print(f"Enrichment: ${enrich_cost:.4f}")
print(f"Organization: ${organize_cost:.4f}")
print(f"Total: ${total_cost:.4f}")
```

---

## 📝 Migration Guide

### **Migrating from Old awsBedrockPipeline.py**

```python
# OLD WAY
from awsBedrockPipeline import process_directory, enrich_directory_with_blooms

process_directory(input_dir, output_dir, max_workers=10)
enrich_directory_with_blooms(parsed_dir, enriched_dir, max_workers=10)

# NEW WAY
from parsing_pipeline import parse_questions_for_job
from enrich_questions_job_based import enrich_questions_for_job

# Process each file
parse_result = parse_questions_for_job(job_id, filename)
enrich_result = enrich_questions_for_job(job_id, filename)
```

---

## 🐛 Troubleshooting

### **Common Issues**

1. **"Batch retry exceeded"**
   - Check `MAX_BATCH_RETRY_ROUNDS` in Textract pipeline
   - Review failed file logs in S3

2. **"Too big text" from parsing**
   - PDF is too large for Bedrock token limit
   - Consider splitting PDF into smaller chunks

3. **Bloom's enrichment slow**
   - Reduce `MAX_CONCURRENT_REQUESTS` if hitting rate limits
   - Check AWS quota limits

4. **Missing metadata in results**
   - Ensure all pipelines return Dict with metadata
   - Check S3 permissions

---

## 📞 Support

For issues or questions:
1. Check test files for usage examples
2. Review individual pipeline documentation
3. Check S3 logs in `jobs/{job_id}/metadata.json`

---

**Last Updated:** December 10, 2025
**Architecture Version:** 2.0 (Split Modular)
