# Pipeline Visual Reference

## 🎨 Quick Visual Guide

### **Before: Monolithic Architecture**

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│          awsBedrockPipeline.py (600+ lines)            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  parse_questions()                              │   │
│  │  - Extract metadata                             │   │
│  │  - Parse questions                              │   │
│  │  - Call Bedrock                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  enrich_with_blooms()                           │   │
│  │  - Load parsed questions                        │   │
│  │  - Call Bedrock for Bloom's                     │   │
│  │  - Merge results                                │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  process_directory()                            │   │
│  │  - ThreadPoolExecutor                           │   │
│  │  - Batch processing                             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ❌ Problems:                                           │
│     - Mixed responsibilities                            │
│     - Hard to test                                      │
│     - Can't skip stages                                 │
│     - No retry tracking                                 │
│     - Difficult to scale                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### **After: Modular Architecture**

```
┌────────────────────────────────────────────────────────────────────┐
│                     server.py (Master)                              │
│                  Flask REST API Orchestrator                        │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ├───────────────────────────────────────┐
                              │                                       │
                              │                                       │
     ┌────────────────────────┼────────────────────┐                  │
     │                        │                    │                  │
     ▼                        ▼                    ▼                  ▼
┌─────────────┐      ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│   Stage 1   │      │    Stage 2      │  │    Stage 3       │  │    Stage 4      │
│   Textract  │─────▶│    Parsing      │─▶│   Enrichment     │─▶│  Organization   │
│             │      │                 │  │                  │  │                 │
│ aws_text... │      │ parsing_pip...  │  │ enrich_quest...  │  │ organize_by...  │
│             │      │                 │  │                  │  │                 │
│ • OCR       │      │ • Parse         │  │ • Bloom's        │  │ • Group         │
│ • Async     │      │ • Metadata      │  │ • 20 workers     │  │ • Folders       │
│ • Retry 3x  │      │ • Structure     │  │ • Retry 3x       │  │ • Indexes       │
│ • Batch     │      │ • Retry 3x      │  │ • Concurrent     │  │ • Master index  │
│             │      │                 │  │                  │  │                 │
│ 13 tests ✅ │      │ 10 tests ✅     │  │ 38 tests ✅      │  │ 9 tests ✅      │
└─────────────┘      └─────────────────┘  └──────────────────┘  └─────────────────┘
     │                       │                     │                     │
     ▼                       ▼                     ▼                     ▼
ocr_output/            parsed_output/       enriched_output/      organized_output/
{filename}_ocr.json    {filename}_parsed    {filename}_enriched   {subject}/...
                       .json                .json
```

## 📊 Data Flow Diagram

```
INPUT: exam.pdf
    │
    ├─► Upload to S3: jobs/{job_id}/original/exam.pdf
    │
    ▼
┌───────────────────────────────────────────────────────┐
│ Stage 1: aws_texttract_pipeline.py                   │
│                                                       │
│ process_document_async(                              │
│     s3_bucket="eesa-pipeline-storage",               │
│     s3_key="jobs/abc-123/original/exam.pdf",         │
│     job_id="abc-123"                                 │
│ )                                                     │
│                                                       │
│ Returns: bool (True/False)                           │
└───────────────────────────────────────────────────────┘
    │
    ├─► S3: jobs/{job_id}/ocr_output/exam_ocr.json
    │   {
    │     "extracted_text": "K.J. Somaiya College...",
    │     "page_count": 5,
    │     "processing_cost": 0.0075
    │   }
    │
    ▼
┌───────────────────────────────────────────────────────┐
│ Stage 2: parsing_pipeline.py                         │
│                                                       │
│ parse_questions_for_job(                             │
│     job_id="abc-123",                                │
│     filename="exam.pdf"                              │
│ )                                                     │
│                                                       │
│ Returns: Dict {                                      │
│     'total_exams': 1,                                │
│     'total_questions': 25,                           │
│     'subjects': ['Computer Science'],                │
│     'processing_cost': 0.0023,                       │
│     'retry_count': 0                                 │
│ }                                                     │
└───────────────────────────────────────────────────────┘
    │
    ├─► S3: jobs/{job_id}/parsed_output/exam_parsed.json
    │   {
    │     "exams": [{
    │       "subject": "Computer Science",
    │       "questions": [
    │         {"question_number": "Q1", ...}
    │       ]
    │     }],
    │     "subjectsCreated": ["Computer Science"]
    │   }
    │
    ▼
┌───────────────────────────────────────────────────────┐
│ Stage 3: enrich_questions_job_based.py                │
│                                                       │
│ enrich_questions_for_job(                            │
│     job_id="abc-123",                                │
│     filename="exam.pdf"                              │
│ )                                                     │
│                                                       │
│ Returns: Dict {                                      │
│     'total_questions': 25,                           │
│     'total_enriched': 25,                            │
│     'processing_cost': 0.025,                        │
│     'retry_count': 0                                 │
│ }                                                     │
└───────────────────────────────────────────────────────┘
    │
    ├─► S3: jobs/{job_id}/enriched_output/exam_enriched.json
    │   {
    │     "exams": [{
    │       "questions": [
    │         {
    │           "question_number": "Q1",
    │           "question_text": "...",
    │           "bloomLevel": "Apply",
    │           "confidence": 0.92,
    │           "difficulty": "Medium"
    │         }
    │       ]
    │     }]
    │   }
    │
    ▼
┌───────────────────────────────────────────────────────┐
│ Stage 4: organize_by_subject_job_based.py             │
│                                                       │
│ organize_by_subject_for_job(                         │
│     job_id="abc-123",                                │
│     filename="exam.pdf"                              │
│ )                                                     │
│                                                       │
│ Returns: Dict {                                      │
│     'total_subjects': 2,                             │
│     'total_exams': 3,                                │
│     'total_questions': 75,                           │
│     'subjects': {...},                               │
│     'processing_cost': 0.0001                        │
│ }                                                     │
└───────────────────────────────────────────────────────┘
    │
    ├─► S3: jobs/{job_id}/organized_output/
    │   ├── Computer_Science/
    │   │   ├── Computer_Science_2023_I_main.json
    │   │   ├── Computer_Science_2024_II_kt.json
    │   │   └── _index.json
    │   ├── Mathematics/
    │   │   ├── Mathematics_2023_I_main.json
    │   │   └── _index.json
    │   └── _master_index.json
    │
    ▼
OUTPUT: Fully processed and organized exam questions
```

## 🔄 Retry Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│          process_document_async(retry_count=0)          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │ Start Textract  │
            │      Job        │
            └────────┬────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
    ┌─────────┐          ┌──────────┐
    │ Success │          │  Failed  │
    └────┬────┘          └─────┬────┘
         │                     │
         │              retry_count < 3?
         │                     │
         │              ┌──────┴──────┐
         │              │             │
         │              ▼             ▼
         │         ┌────────┐    ┌────────┐
         │         │  Yes   │    │   No   │
         │         └───┬────┘    └───┬────┘
         │             │             │
         │             │ Wait 2s     │
         │             │             │
         │             ▼             ▼
         │    process_document  Return False
         │    _async(retry_    (Max retries
         │    count+1)          exceeded)
         │             │
         │             └────► (Recursive retry)
         │
         ▼
    ┌─────────────┐
    │ Get Results │
    └──────┬──────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│ Success │  │  Failed  │
└────┬────┘  └─────┬────┘
     │             │
     │      retry_count < 3?
     │             │
     │      ┌──────┴──────┐
     │      │             │
     │      ▼             ▼
     │  ┌────────┐   ┌────────┐
     │  │  Yes   │   │   No   │
     │  └───┬────┘   └───┬────┘
     │      │            │
     │      │ Wait 5s    │
     │      │            │
     │      ▼            ▼
     │  Recursive    Return False
     │  retry
     │
     ▼
┌─────────────┐
│ Save to S3  │
└──────┬──────┘
       │
┌──────┴──────┐
│             │
▼             ▼
┌─────────┐  ┌──────────┐
│ Success │  │  Failed  │
└────┬────┘  └─────┬────┘
     │             │
     │      retry_count < 3?
     │             │
     │      ┌──────┴──────┐
     │      │             │
     │      ▼             ▼
     │  ┌────────┐   ┌────────┐
     │  │  Yes   │   │   No   │
     │  └───┬────┘   └───┬────┘
     │      │            │
     │      │ Wait 2s    │
     │      │            │
     │      ▼            ▼
     │  Recursive    Return False
     │  retry
     │
     ▼
Return True
(Success!)
```

## 📦 Batch Processing Flow

```
process_batch_with_retry([file1, file2, file3])
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Round 0: Initial Processing                        │
│                                                     │
│ Process file1 ───► ✅ Success                       │
│ Process file2 ───► ❌ Failed (save to retry list)  │
│ Process file3 ───► ✅ Success                       │
│                                                     │
│ Summary: 2/3 succeeded, 1 failed                   │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ Wait 3s (exponential backoff)
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ Round 1: Retry Failed Files                        │
│                                                     │
│ Process file2 ───► ❌ Failed again                  │
│                                                     │
│ Summary: 0/1 succeeded, 1 failed                   │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ Wait 6s (exponential backoff)
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ Round 2: Retry Failed Files                        │
│                                                     │
│ Process file2 ───► ✅ Success!                      │
│                                                     │
│ Summary: 1/1 succeeded, 0 failed                   │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ All files successful!
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ Final Summary                                       │
│                                                     │
│ Total files: 3                                      │
│ ✓ Successful: 3 (100.0%)                           │
│ ✗ Failed: 0 (0.0%)                                 │
│ Retry rounds used: 2/3                             │
│                                                     │
│ Return: {                                           │
│   'total_files': 3,                                │
│   'successful': 3,                                 │
│   'failed': 0,                                     │
│   'success_rate': 100.0,                           │
│   'retry_rounds_used': 2,                          │
│   'failed_files': []                               │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

## 🎯 Usage Patterns

### **Pattern 1: Full Pipeline**
```
PDF ──► Textract ──► Parsing ──► Enrichment ──► Organization ──► Done
        (OCR)        (Structure)  (Bloom's)       (By Subject)
```

### **Pattern 2: Skip Bloom's**
```
PDF ──► Textract ──► Parsing ──► Organization ──► Done
        (OCR)        (Structure)  (By Subject)
```

### **Pattern 3: Only OCR + Parse**
```
PDF ──► Textract ──► Parsing ──► Done
        (OCR)        (Structure)
```

### **Pattern 4: Reprocess Existing**
```
Parsed JSON ──► Enrichment ──► Organization ──► Done
(Already have)  (Add Bloom's)  (Reorganize)
```

---

**Legend:**
- ✅ Success
- ❌ Failed
- 🔄 Retry
- ▶ Process flow
- ─► Data flow
- ┌─┐ Process box
- │ │ Vertical connection
- ├─┤ Branch point

---

*Visual Reference Guide - Pipeline Architecture v2.0*
