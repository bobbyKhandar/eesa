# AWS Textract Pipeline - Job-based Processing

## Overview
This pipeline processes PDFs from S3 using AWS Textract, following a job-based storage pattern for organized workflow management.

## S3 Storage Structure
```
s3://eesa-pipeline-storage/
  ├── jobs/
  │   ├── {job_id_1}/                 # Unique UUID for each job
  │   │   ├── original/               # Raw PDFs uploaded by client
  │   │   │   ├── paper1.pdf
  │   │   │   └── paper2.pdf
  │   │   ├── ocr_output/             # Textract OCR results (JSON)
  │   │   │   ├── paper1.json
  │   │   │   └── paper2.json
  │   │   └── llm_enhanced/           # Final cleaned JSON from LLM (next step)
  │   │       ├── paper1_final.json
  │   │       └── paper2_final.json
  │   └── {job_id_2}/
  │       └── ...
```

## Usage

### Basic Command
```powershell
python aws_texttract_pipeline.py <job_id>
```

### Example
```powershell
# Process job with UUID
python aws_texttract_pipeline.py 123e4567-e89b-12d3-a456-426614174000
```

### What It Does
1. **Downloads** PDFs from `s3://eesa-pipeline-storage/jobs/{job_id}/original/`
2. **Processes** each PDF with AWS Textract (DetectDocumentText API)
3. **Uploads** JSON results to `s3://eesa-pipeline-storage/jobs/{job_id}/ocr_output/`

## Output Format

Each processed PDF generates a JSON file with the following structure:

```json
{
  "filename": "paper1.pdf",
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "extracted_text": "Full OCR text content...",
  "page_count": 5,
  "processing_cost": 0.0075,
  "processed_at": "2025-11-30 10:30:45.123456"
}
```

## Configuration

### Environment Variables
```powershell
# Set custom S3 bucket (default: eesa-pipeline-storage)
$env:S3_BUCKET = "your-custom-bucket-name"
```

### AWS Credentials
Ensure AWS credentials are configured:
```powershell
# Via environment variables
$env:AWS_ACCESS_KEY_ID = "your-access-key"
$env:AWS_SECRET_ACCESS_KEY = "your-secret-key"
$env:AWS_DEFAULT_REGION = "us-east-1"

# Or via AWS CLI
aws configure
```

## Cost Information

- **Textract API**: `$0.0015` per page (DetectDocumentText)
- **S3 Storage**: Standard S3 pricing applies
- **Data Transfer**: S3 → EC2 transfer in same region is free

### Cost Savings
The pipeline uses `DetectDocumentText` instead of `AnalyzeDocument`, saving **96.9%** per page:
- DetectDocumentText: $0.0015/page
- AnalyzeDocument: $0.050/page

## Features

✅ **Job-based Organization**: Each job has isolated storage  
✅ **Automatic Cleanup**: Temporary files removed after processing  
✅ **Cost Tracking**: Real-time cost calculation per file and total  
✅ **Error Handling**: Graceful failure handling with detailed logging  
✅ **Large File Support**: Automatic image compression for pages >5MB  
✅ **Batch Processing**: Processes all PDFs in job folder automatically  

## Processing Flow

```
1. Receive job_id → 
2. List PDFs in jobs/{job_id}/original/ → 
3. For each PDF:
   a. Download to temp folder
   b. Convert PDF to images (200 DPI)
   c. Process each page with Textract
   d. Combine text from all pages
   e. Create JSON output
   f. Upload to jobs/{job_id}/ocr_output/
   g. Delete temp files
4. Clean up temp directory →
5. Print summary report
```

## Error Handling

- **Missing PDFs**: Reports if no PDFs found in job folder
- **Download Failures**: Skips file and continues with next
- **Textract Errors**: Logs error and marks file as failed
- **Upload Failures**: Retains local file for manual intervention
- **Cleanup Failures**: Warns but doesn't crash pipeline

## Output Summary

After processing, you'll see a summary like:

```
============================================================
PROCESSING SUMMARY
============================================================
Job ID: 123e4567-e89b-12d3-a456-426614174000
✓ Successful files: 3
✗ Failed files: 0
📄 Total pages processed: 15
💰 Total estimated cost: $0.0225
📊 Average cost per file: $0.0075
============================================================

💡 Using DetectDocumentText ($0.0015/page)
   Savings vs AnalyzeDocument: $0.7275
============================================================
```

## Next Steps

After OCR extraction, the JSON files in `ocr_output/` are ready for:
1. **LLM Enhancement**: Process with Bedrock/Gemini to extract structured questions
2. **Bloom's Taxonomy**: Enrich questions with cognitive levels
3. **Storage**: Final results saved to `llm_enhanced/` folder

## Requirements

```bash
pip install boto3 pdf2image Pillow
```

### System Dependencies
- **Poppler**: Required for `pdf2image`
  ```powershell
  # Windows: Download from https://github.com/oschwartz10612/poppler-windows/releases
  # Add to PATH
  ```

## Troubleshooting

### No PDFs Found
- Verify job_id is correct
- Check S3 bucket permissions
- Ensure PDFs exist in `jobs/{job_id}/original/`

### AWS Credentials Error
- Run `aws configure` to set credentials
- Verify IAM permissions for S3 and Textract

### Textract API Errors
- Check region configuration (must support Textract)
- Verify IAM role has `textract:DetectDocumentText` permission
- Ensure images are <5MB (auto-compressed if larger)

### Permission Requirements
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::eesa-pipeline-storage/*",
        "arn:aws:s3:::eesa-pipeline-storage"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "textract:DetectDocumentText"
      ],
      "Resource": "*"
    }
  ]
}
```

## Migration from Old Version

The old directory-based version (`aws_texttract_pipeline_old.py`) has been replaced. Key changes:

| Old | New |
|-----|-----|
| Multiple configurable buckets | Single bucket (`eesa-pipeline-storage`) |
| Directory-based prefixes | Job-based structure (`jobs/{job_id}/`) |
| `.txt` output | `.json` output with metadata |
| Manual bucket configuration | Job ID parameter only |
| Local + S3 modes | S3-only with job isolation |

## Contact & Support

For issues or questions about this pipeline, contact the development team or check the main project documentation.
