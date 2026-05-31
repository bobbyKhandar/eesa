# Error Reprocessing Guide

This guide explains how to reprocess files that failed during the initial OCR parsing or Bloom's taxonomy enrichment phases using AWS Bedrock.

## Overview

The reprocessing pipeline handles two types of errors:

1. **Parsed Errors** (`parsedQuestions/errors/*.txt.error.txt`)
   - Files that failed during initial OCR text parsing
   - Contains raw OCR text that needs to be structured into JSON

2. **Enriched Errors** (`enrichedQuestions/errors/*_bloom.error.txt`)
   - Files that failed during Bloom's taxonomy enrichment
   - Contains failed Bedrock responses with invalid JSON

## Error File Structure

### Parsed Error Files
**Location**: `ai_pipeline/parsedQuestions/errors/`
**Format**: `{exam_name}_{timestamp}.txt.error.txt`

**Content**: Raw OCR text from exam papers
```
Q1 (a) Define system program with an example...
Q1 (b) What are the various phases of a compiler...
Q2 (a) Explain different features of Macro Facility...
```

### Enriched Error Files
**Location**: `ai_pipeline/enrichedQuestions/errors/`
**Format**: `{subject_name}_{timestamp}.json_bloom.error.txt`

**Content**: Failed Bedrock responses
```
=== RAW BLOOM RESPONSE ===
[
  {
    "questionIndex": 0,
    "bloomLevel": "Create",
    "confidence": 0. nine,  // <- Invalid JSON
    ...
  }
]
```

## How It Works

### Stage 1: Parsed Error Reprocessing
1. **Read** raw OCR text from error file
2. **Send** to Bedrock with question extraction prompt
3. **Clean** response to extract valid JSON array/object
4. **Validate** JSON structure and fix common issues
5. **Save** to `reprocessedFromErrors/parsed/{exam_name}.json`

**Bedrock Prompt Structure**:
```
System: You are an expert at extracting structured exam questions...
User: Extract all questions from this exam paper text...
```

**Expected Output**:
```json
{
  "exams": [{
    "subject": "System Programming and Compiler Construction",
    "max_marks": "100",
    "year": "2017",
    "semester": "VI",
    "branch": "Computer",
    "questions": [
      {
        "question_number": "Q1(a)",
        "question_text": "Define system program with an example...",
        "questionType": "text",
        "marks": "10"
      }
    ]
  }]
}
```

### Stage 2: Enriched Error Reprocessing
1. **Locate** original parsed JSON file
2. **Extract** questions from original file
3. **Send** to Bedrock with Bloom's classification prompt
4. **Clean** response to extract valid JSON array
5. **Validate** Bloom's classifications
6. **Merge** Bloom's data back into questions
7. **Save** to `reprocessedFromErrors/enriched/{subject}_enriched.json`

**Bedrock Prompt Structure**:
```
System: You are an educational assessment expert...
User: Classify each question using Bloom's Taxonomy...
```

**Expected Output**:
```json
[
  {
    "questionIndex": 0,
    "bloomLevel": "Apply",
    "bloomJustification": "Requires applying known algorithm",
    "confidence": 0.94,
    "difficulty": "Medium",
    "keywords": ["algorithm", "complexity"],
    "topicsCovered": ["Algorithm design"]
  }
]
```

## Usage

### Basic Usage
```bash
cd ai_pipeline/src
python reprocess_errors.py
```

### Interactive Menu
```
Which errors would you like to reprocess?
1. Parsed errors only (failed OCR parsing)
2. Enriched errors only (failed Bloom's enrichment)
3. Both

Enter choice (1/2/3): 3
```

### Output Locations

**Successful Reparsing**:
- `reprocessedFromErrors/parsed/` - Successfully reparsed exam JSONs
- `reprocessedFromErrors/enriched/` - Successfully enriched exam JSONs

**Failed Reprocessing**:
- `reprocessedFromErrors/failed/` - Failed attempts with debug info

## Output Structure

### Successfully Reparsed File
**Path**: `reprocessedFromErrors/parsed/COMP_SEM_VI_NOV_2017.json`
```json
{
  "exams": [{
    "subject": "System Programming",
    "questions": [...]
  }]
}
```

### Successfully Enriched File
**Path**: `reprocessedFromErrors/enriched/Analysis_of_Algorithms_enriched.json`
```json
{
  "exams": [{
    "subject": "Analysis of Algorithms",
    "questions": [
      {
        "question_text": "Design a divide-and-conquer algorithm...",
        "marks": "10",
        "bloomLevel": "Create",
        "bloomJustification": "Requires designing a new solution",
        "confidence": 0.92,
        "difficulty": "Medium",
        "keywords": ["algorithm", "divide and conquer"],
        "topicsCovered": ["Algorithm design"]
      }
    ]
  }],
  "metadata": {
    "processingDate": "2025-11-11T10:45:23",
    "source": "bedrock_reprocessed",
    "bloomEnriched": true
  }
}
```

### Failed Reprocessing Debug File
**Path**: `reprocessedFromErrors/failed/COMP_SEM_VI_parse_failed.txt`
```
=== RAW RESPONSE ===
[Original Bedrock response]

=== CLEANED ===
[After cleaning attempts]

=== ERROR ===
JSON validation failed: Extra data: line 9 column 4
```

## JSON Cleaning & Validation

The script includes sophisticated JSON cleaning:

### 1. Response Cleaning
- Removes markdown code blocks (```json)
- Extracts JSON array `[...]` (prioritized)
- Extracts JSON object `{...}` (fallback)

### 2. Validation Fixes
- Removes JavaScript comments (`//` and `/* */`)
- Fixes escaped quotes
- Removes trailing commas
- Fixes unescaped newlines in strings

### 3. Common Error Patterns

**Problem**: `0. nine` instead of `0.9`
```json
"confidence": 0. nine  // Invalid
```
**Fix**: Manual inspection needed, saved to `failed/`

**Problem**: Trailing text after JSON
```json
[{...}]
Here's my explanation...
```
**Fix**: Extracts only the JSON portion

**Problem**: Unescaped quotes
```json
"text": "He said "hello""  // Invalid
```
**Fix**: Escapes inner quotes to `"He said \"hello\""`

## Statistics Tracking

The script provides detailed statistics:

```
📊 REPROCESSING SUMMARY
================================================================================

📝 Parsed Errors:
   ✅ Success: 42
   ❌ Failed: 8
   📁 Saved to: reprocessedFromErrors/parsed

🌸 Enriched Errors:
   ✅ Success: 385
   ❌ Failed: 52
   📁 Saved to: reprocessedFromErrors/enriched

🎯 Total Success: 427
❌ Total Failed: 60
   Failed responses saved to: reprocessedFromErrors/failed
```

## Next Steps After Reprocessing

### 1. Move Successful Files
```bash
# Move reparsed files to main directory
mv reprocessedFromErrors/parsed/*.json parsedQuestions/

# Move enriched files to main directory
mv reprocessedFromErrors/enriched/*.json enrichedQuestions/
```

### 2. Re-organize by Subject
```bash
cd ai_pipeline/src
python organize_by_subject.py
```

### 3. Import to MongoDB
```bash
cd backend
node dist/scripts/importBedrockQuestions.js ../ai_pipeline/organizedBySubject
```

## Troubleshooting

### AWS Credentials Error
```
NoCredentialsError: Unable to locate credentials
```
**Solution**: Configure AWS CLI
```bash
aws configure
# Enter AWS_ACCESS_KEY_ID
# Enter AWS_SECRET_ACCESS_KEY
# Enter region: us-east-1
```

### Rate Limiting
```
❌ Bedrock API error: Rate exceeded
```
**Solution**: Script includes 1-second delay between requests. For heavy loads, increase `time.sleep(1)` to `time.sleep(2)`.

### Original File Not Found
```
⚠️ Original parsed file not found: {filename}.json
```
**Solution**: Enrichment requires the original parsed JSON. Reprocess parsed errors first (choice 1), then enriched errors (choice 2).

### All Requests Failing
**Check**:
1. AWS credentials valid
2. Bedrock model access enabled in AWS console
3. Region set to `us-east-1`
4. Internet connectivity

## Advanced Usage

### Batch Processing with Custom Delay
Modify `reprocess_errors.py`:
```python
# Change rate limiting (line ~450)
time.sleep(2)  # 2 seconds between requests
```

### Filter by Subject
```python
# Add filter before processing
enriched_errors = [
    e for e in enriched_errors 
    if 'Computer' in e.stem
]
```

### Custom Bedrock Model
```python
# Change model at top of file
BEDROCK_MODEL_ID = "anthropic.claude-v2"
```

## Success Rate

Based on testing:
- **Parsed Errors**: ~85% success rate
  - Common failures: Completely garbled OCR text
- **Enriched Errors**: ~88% success rate
  - Common failures: Invalid number formats (e.g., "0. nine")

## FAQ

**Q: Can I reprocess just one file?**
A: Yes, comment out the loop and hardcode the file path:
```python
error_file = Path("parsedQuestions/errors/COMP_SEM_VI.txt.error.txt")
success = reprocess_parsed_error(error_file)
```

**Q: Why do some files still fail?**
A: Bedrock LLM responses can include non-JSON text or formatting errors. Failed files are saved to `failed/` with full debug info for manual inspection.

**Q: How long does reprocessing take?**
A: ~1-2 seconds per file due to Bedrock API calls and rate limiting. For 500 errors: ~15-20 minutes.

**Q: Can I run this in parallel?**
A: Not recommended due to AWS rate limits. Sequential processing with delays is more reliable.

## File Count Summary

Current error files (as of organization):
- **Parsed errors**: ~50 files (OCR parsing failures)
- **Enriched errors**: ~437 files (Bloom's enrichment failures)
- **Total**: ~487 error files

Expected recovery rate: **~430 files** successfully reprocessed

## See Also

- [Bedrock Import Guide](./BEDROCK_IMPORT_GUIDE.md) - MongoDB import workflow
- [Organization Guide](./ORGANIZE_BY_SUBJECT.md) - Subject-based file organization
- [Integration Guide](./INTEGRATION_GUIDE.md) - Full pipeline overview
