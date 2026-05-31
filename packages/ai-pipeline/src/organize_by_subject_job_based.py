"""
Job-Based Subject Organization Pipeline

This slave pipeline organizes enriched questions by subject.
It loads data from S3, organizes in memory, saves back to S3, and returns metadata.

Expected S3 structure:
Input:  s3://bucket/jobs/{job_id}/enriched_output/{filename}_enriched.json
Output: s3://bucket/jobs/{job_id}/organized_output/
        - {subject_folder}/
          - {subject}_{year}_{semester}_{examType}.json
          - _index.json
        - _master_index.json
"""

import boto3
import os
import json
import re
from datetime import datetime
from typing import Dict, List, Optional, Set
from collections import defaultdict

# AWS Clients
s3_client = boto3.client('s3')

# S3 Configuration - Job-based structure (matching Textract/Bedrock)
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'  # Base prefix for all jobs

# Processing Configuration
COST_PER_ORGANIZATION = 0.0001  # Estimated cost per organization operation


def sanitize_filename(name: str) -> str:
    """Remove or replace invalid filename characters"""
    name = name.replace('/', '_')
    name = name.replace('\\', '_')
    name = name.replace(':', '_')
    name = name.replace('*', '_')
    name = name.replace('?', '_')
    name = name.replace('"', '_')
    name = name.replace('<', '_')
    name = name.replace('>', '_')
    name = name.replace('|', '_')
    name = name.replace('&', 'and')
    
    # Remove multiple spaces and underscores
    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'_+', '_', name)
    
    # Trim and limit length
    name = name.strip()[:200]
    return name


def load_enriched_from_s3(job_id: str, filename: str) -> Optional[Dict]:
    """
    Load enriched question JSON from S3.
    
    Args:
        job_id: Unique job identifier
        filename: Original filename (without _enriched suffix)
        
    Returns:
        Enriched question data dict, or None if failed
    """
    try:
        base_name = os.path.splitext(filename)[0]
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/enriched_output/{base_name}_enriched.json"
        
        print(f"📥 Loading enriched questions from S3...")
        print(f"   s3://{S3_BUCKET}/{s3_key}")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=s3_key
        )
        
        data = json.loads(response['Body'].read().decode('utf-8'))
        print(f"   ✓ Loaded enriched data")
        return data
        
    except Exception as e:
        print(f"   ✗ Failed to load enriched data: {e}")
        return None


def organize_exams_by_subject(enriched_data: Dict) -> Dict[str, List[Dict]]:
    """
    Organize exams by subject in memory.
    
    Args:
        enriched_data: Enriched question data with exams array
        
    Returns:
        Dict mapping subject names to list of exams
    """
    organized = defaultdict(list)
    
    exams = enriched_data.get('exams', [])
    
    for exam in exams:
        subject = exam.get('subject', 'Unknown Subject')
        organized[subject].append(exam)
    
    return dict(organized)


def generate_exam_filename(exam: Dict, index: int = 0) -> str:
    """Generate a unique filename for an exam"""
    subject = sanitize_filename(exam.get('subject', 'Unknown_Subject'))
    year = exam.get('year', 'UnknownYear')
    semester = exam.get('semester', 'UnknownSem')
    exam_type = exam.get('examType', 'main')
    
    filename = f"{subject}_{year}_{semester}_{exam_type}"
    
    if index > 0:
        filename += f"_{index}"
    
    filename += ".json"
    return filename


def save_organized_to_s3(job_id: str, organized_data: Dict[str, List[Dict]], 
                         source_filename: str) -> Dict:
    """
    Save organized data to S3 and return metadata.
    
    Args:
        job_id: Unique job identifier
        organized_data: Dict mapping subjects to exam lists
        source_filename: Original source filename
        
    Returns:
        Metadata dict with organization details
    """
    try:
        print(f"\n📤 Uploading organized data to S3...")
        
        metadata = {
            'job_id': job_id,
            'source_filename': source_filename,
            'processed_at': datetime.now().isoformat(),
            'total_subjects': len(organized_data),
            'total_exams': 0,
            'total_questions': 0,
            'processing_cost': COST_PER_ORGANIZATION,  # Add cost tracking
            'subjects': {}
        }
        
        # Statistics tracking
        subject_stats = {}
        
        # Process each subject
        for subject_name, exams in organized_data.items():
            subject_folder = sanitize_filename(subject_name)
            
            # Track subject stats
            subject_stats[subject_name] = {
                'total_exams': len(exams),
                'total_questions': 0,
                'years': set(),
                'semesters': set(),
                'exam_types': set(),
                'files': []
            }
            
            # Save each exam
            for idx, exam in enumerate(exams):
                exam_filename = generate_exam_filename(exam, idx)
                
                # Create single-exam JSON structure
                exam_data = {
                    'exams': [exam],
                    'subjectsCreated': [subject_name],
                    'metadata': {
                        'source_file': source_filename,
                        'exam_index': idx,
                        'processed_at': datetime.now().isoformat(),
                        'total_questions': len(exam.get('questions', []))
                    }
                }
                
                # Upload exam file to S3
                s3_key = f"{S3_JOBS_PREFIX}{job_id}/organized_output/{subject_folder}/{exam_filename}"
                
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=s3_key,
                    Body=json.dumps(exam_data, indent=2, ensure_ascii=False),
                    ContentType='application/json'
                )
                
                # Update stats
                question_count = len(exam.get('questions', []))
                subject_stats[subject_name]['total_questions'] += question_count
                subject_stats[subject_name]['years'].add(exam.get('year', 'Unknown'))
                subject_stats[subject_name]['semesters'].add(exam.get('semester', 'Unknown'))
                subject_stats[subject_name]['exam_types'].add(exam.get('examType', 'main'))
                subject_stats[subject_name]['files'].append({
                    'filename': exam_filename,
                    's3_key': s3_key,
                    'year': exam.get('year'),
                    'semester': exam.get('semester'),
                    'examType': exam.get('examType'),
                    'questions': question_count,
                    'max_marks': exam.get('max_marks')
                })
                
                metadata['total_exams'] += 1
                metadata['total_questions'] += question_count
                
                print(f"   ✓ {subject_name}/{exam_filename} ({question_count} questions)")
            
            # Create subject index
            subject_index = {
                'subject': subject_name,
                'total_exams': subject_stats[subject_name]['total_exams'],
                'total_questions': subject_stats[subject_name]['total_questions'],
                'years': sorted(list(subject_stats[subject_name]['years'])),
                'semesters': sorted(list(subject_stats[subject_name]['semesters'])),
                'exam_types': sorted(list(subject_stats[subject_name]['exam_types'])),
                'files': subject_stats[subject_name]['files']
            }
            
            # Upload subject index
            index_s3_key = f"{S3_JOBS_PREFIX}{job_id}/organized_output/{subject_folder}/_index.json"
            
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=index_s3_key,
                Body=json.dumps(subject_index, indent=2, ensure_ascii=False),
                ContentType='application/json'
            )
            
            # Add to metadata
            metadata['subjects'][subject_name] = {
                'folder': subject_folder,
                'exam_count': subject_stats[subject_name]['total_exams'],
                'question_count': subject_stats[subject_name]['total_questions'],
                'years': sorted(list(subject_stats[subject_name]['years'])),
                'semesters': sorted(list(subject_stats[subject_name]['semesters'])),
                'exam_types': sorted(list(subject_stats[subject_name]['exam_types'])),
                'index_s3_key': index_s3_key,
                'files': subject_stats[subject_name]['files']
            }
            
            print(f"   ✓ Created index for {subject_name}")
        
        # Create master index
        master_index = {
            'job_id': job_id,
            'source_filename': source_filename,
            'total_subjects': metadata['total_subjects'],
            'total_exams': metadata['total_exams'],
            'total_questions': metadata['total_questions'],
            'processed_at': metadata['processed_at'],
            'subjects': metadata['subjects']
        }
        
        # Upload master index
        master_index_s3_key = f"{S3_JOBS_PREFIX}{job_id}/organized_output/_master_index.json"
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=master_index_s3_key,
            Body=json.dumps(master_index, indent=2, ensure_ascii=False),
            ContentType='application/json'
        )
        
        metadata['master_index_s3_key'] = master_index_s3_key
        
        print(f"\n   ✓ Created master index")
        print(f"   📊 Summary:")
        print(f"      Subjects: {metadata['total_subjects']}")
        print(f"      Exams: {metadata['total_exams']}")
        print(f"      Questions: {metadata['total_questions']}")
        
        return metadata
        
    except Exception as e:
        print(f"   ✗ Error saving organized data: {e}")
        import traceback
        traceback.print_exc()
        return None


def organize_by_subject_for_job(job_id: str, filename: str) -> Optional[Dict]:
    """
    Main function to organize enriched questions by subject for a specific job.
    
    Args:
        job_id: Unique job identifier
        filename: Original filename (e.g., "paper.pdf")
        
    Returns:
        Metadata dict with organization details, or None if failed
        
    Example:
        organize_by_subject_for_job(
            job_id="abc-123",
            filename="paper.pdf"
        )
    """
    print(f"\n{'='*60}")
    print(f"Organizing by Subject: {filename}")
    print(f"Job ID: {job_id}")
    print(f"{'='*60}\n")
    
    # Step 1: Load enriched data from S3
    enriched_data = load_enriched_from_s3(job_id, filename)
    if not enriched_data:
        return None
    
    if 'exams' not in enriched_data or not enriched_data['exams']:
        print(f"⚠ No exams found in enriched data")
        return None
    
    print(f"\n📚 Found {len(enriched_data['exams'])} exam(s)")
    
    # Step 2: Organize by subject in memory
    print(f"\n📋 Organizing exams by subject...")
    organized = organize_exams_by_subject(enriched_data)
    
    print(f"   ✓ Organized into {len(organized)} subject(s)")
    for subject, exams in organized.items():
        print(f"      • {subject}: {len(exams)} exam(s)")
    
    # Step 3: Save to S3 and get metadata
    metadata = save_organized_to_s3(job_id, organized, filename)
    
    if metadata:
        print(f"\n✓ Organization complete!")
        print(f"   Total subjects: {metadata['total_subjects']}")
        print(f"   Total exams: {metadata['total_exams']}")
        print(f"   Total questions: {metadata['total_questions']}")
        print(f"   Cost: ${metadata['processing_cost']:.4f}")
        return metadata
    else:
        print(f"\n✗ Organization failed")
        return None


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) != 3:
        print("Usage: python organize_by_subject_job_based.py <job_id> <filename>")
        print("Example: python organize_by_subject_job_based.py abc-123 paper.pdf")
        sys.exit(1)
    
    job_id = sys.argv[1]
    filename = sys.argv[2]
    
    result = organize_by_subject_for_job(job_id, filename)
    sys.exit(0 if result else 1)
