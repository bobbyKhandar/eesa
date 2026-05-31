# Organize Enriched Questions by Subject

## Overview
This script processes all enriched JSON files and organizes them by subject, creating individual exam files in subject-specific folders.

## What It Does

### 1. **Processes Each Enriched File**
- Reads all `*_enriched.json` files from `enrichedQuestions/`
- Extracts individual exams from multi-exam files
- Creates separate JSON files for each exam

### 2. **Organizes by Subject**
- Creates a folder for each unique subject
- Names folders using sanitized subject names
- Groups all exams of the same subject together

### 3. **Creates Indexes**
- `_index.json` in each subject folder with metadata
- `_master_index.json` in root with all subjects

## Directory Structure

### Before:
```
enrichedQuestions/
  ├── Computer Simulation & Modeling_UCEE704_Subjective_1761550100_enriched.json
  ├── Advanced Finite Element Analysis_1761409395_enriched.json
  └── ... (more enriched files)
```

### After:
```
organizedBySubject/
  ├── _master_index.json
  ├── Computer_Simulation_and_Modeling/
  │   ├── _index.json
  │   ├── Computer_Simulation_and_Modeling_2020_VII_main.json
  │   └── Computer_Simulation_and_Modeling_2019_V_kt.json
  ├── Advanced_Finite_Element_Analysis/
  │   ├── _index.json
  │   ├── Advanced_Finite_Element_Analysis_2017_II_main.json
  │   └── Advanced_Finite_Element_Analysis_2018_IV_main.json
  └── ... (more subject folders)
```

## File Naming Convention

Each exam file is named:
```
{subject}_{year}_{semester}_{examType}_{index}.json
```

Examples:
- `Database_Systems_2024_S3_main.json`
- `Operating_Systems_2023_S5_kt_1.json` (index added if duplicate)

## JSON Structure

### Individual Exam File:
```json
{
  "exams": [{
    "subject": "Computer Simulation & Modeling",
    "year": "2020",
    "semester": "VII",
    "examType": "main",
    "max_marks": "30",
    "questions": [...]
  }],
  "subjectsCreated": ["Computer Simulation & Modeling"],
  "metadata": {
    "source_file": "original_enriched.json",
    "exam_index": 0,
    "processed_at": "2025-11-07T10:30:00",
    "total_questions": 8
  }
}
```

### Subject Index (_index.json):
```json
{
  "subject": "Computer Simulation & Modeling",
  "total_exams": 5,
  "total_questions": 42,
  "years": ["2018", "2019", "2020"],
  "semesters": ["V", "VII"],
  "exam_types": ["main", "kt"],
  "files": [{
    "filename": "Computer_Simulation_and_Modeling_2020_VII_main.json",
    "year": "2020",
    "semester": "VII",
    "examType": "main",
    "questions": 8,
    "max_marks": "30"
  }]
}
```

### Master Index (_master_index.json):
```json
{
  "total_subjects": 125,
  "total_exams": 487,
  "processed_at": "2025-11-07T10:35:00",
  "subjects": {
    "Computer Simulation & Modeling": {
      "folder": "Computer_Simulation_and_Modeling",
      "exam_count": 5,
      "stats": {
        "total_questions": 42,
        "years": ["2018", "2019", "2020"],
        "semesters": ["V", "VII"]
      }
    }
  }
}
```

## Usage

### Run the Script:
```bash
cd ai_pipeline/src
python organize_by_subject.py
```

### Output:
```
======================================================================
ORGANIZE ENRICHED QUESTIONS BY SUBJECT
======================================================================
Input directory:  C:/project/miniproject/ai_pipeline/enrichedQuestions
Output directory: C:/project/miniproject/ai_pipeline/organizedBySubject
Found 487 enriched JSON files
======================================================================

📄 Processing: Computer Simulation & Modeling_UCEE704_Subjective_1761550100_enriched.json
   📚 Found 1 exam(s)
   ✓ Saved: Computer Simulation & Modeling (2020, VII) - 8 questions
      → Computer_Simulation_and_Modeling_2020_VII_main.json

... (more files)

📋 Creating subject index files...
   ✓ Computer Simulation & Modeling: 5 exams
   ✓ Advanced Finite Element Analysis: 3 exams
   ... (more subjects)

======================================================================
ORGANIZATION SUMMARY
======================================================================
📚 Total Subjects: 125
📝 Total Exams: 487
📁 Output Directory: C:/project/miniproject/ai_pipeline/organizedBySubject

✓ Created subject folders:
   • Advanced Finite Element Analysis: 3 exams, 39 questions
   • Computer Simulation & Modeling: 5 exams, 42 questions
   • Database Systems: 12 exams, 156 questions
   ... (more subjects)

💾 Master index: C:/project/miniproject/ai_pipeline/organizedBySubject/_master_index.json
======================================================================
```

## Features

### 1. **Filename Sanitization**
- Removes invalid characters (/, \, :, *, ?, ", <, >, |)
- Replaces & with "and"
- Removes extra spaces and underscores
- Limits filename length to 200 characters

### 2. **Multi-Exam Handling**
- Splits files with multiple exams
- Adds index suffix for duplicates
- Preserves all exam metadata

### 3. **Metadata Tracking**
- Source file reference
- Processing timestamp
- Exam index in original file
- Question counts

### 4. **Index Generation**
- Per-subject statistics
- Master index for all subjects
- Easy navigation and querying

## Use Cases

### 1. **Subject-Based Import**
Import all exams for a specific subject:
```bash
cd backend
node dist/scripts/importBedrockQuestions.js ../ai_pipeline/organizedBySubject/Database_Systems
```

### 2. **Year-Based Filtering**
Find all exams from a specific year using the index:
```python
import json
with open('_index.json') as f:
    index = json.load(f)
    
exams_2020 = [f for f in index['files'] if f['year'] == '2020']
```

### 3. **Exam Type Selection**
Filter by exam type (main/kt):
```python
kt_exams = [f for f in index['files'] if f['examType'] == 'kt']
```

## Troubleshooting

### Issue: "No exams array found"
**Cause**: JSON file doesn't have `exams` key
**Solution**: Check if file is properly enriched

### Issue: Duplicate filenames
**Cause**: Multiple exams with same metadata
**Solution**: Script automatically adds `_1`, `_2` suffixes

### Issue: Invalid folder names
**Cause**: Special characters in subject names
**Solution**: Script sanitizes automatically

## Next Steps

After organization:
1. Review master index to see all subjects
2. Import specific subjects to MongoDB
3. Use indexes for filtering and querying
4. Build subject-based navigation in frontend
