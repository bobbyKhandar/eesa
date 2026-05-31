"""
Organize Enriched Questions by Subject

This script:
1. Reads all *_enriched.json files from enrichedQuestions directory
2. Extracts each exam from multi-exam files
3. Creates a folder for each subject
4. Saves each exam as a separate JSON file in its subject folder
5. Names files: {subject}_{year}_{semester}_{examType}_{index}.json
"""

import json
import os
import glob
import re
from pathlib import Path
from datetime import datetime

def sanitize_filename(name):
    """Remove or replace invalid filename characters"""
    # Replace common invalid characters
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

def create_subject_folder(base_dir, subject_name):
    """Create a folder for the subject if it doesn't exist"""
    folder_name = sanitize_filename(subject_name)
    folder_path = os.path.join(base_dir, folder_name)
    
    os.makedirs(folder_path, exist_ok=True)
    return folder_path

def generate_exam_filename(exam, index=0):
    """Generate a unique filename for an exam"""
    subject = sanitize_filename(exam.get('subject', 'Unknown_Subject'))
    year = exam.get('year', 'UnknownYear')
    semester = exam.get('semester', 'UnknownSem')
    exam_type = exam.get('examType', 'main')
    
    # Create base filename
    filename = f"{subject}_{year}_{semester}_{exam_type}"
    
    # Add index if multiple exams from same source
    if index > 0:
        filename += f"_{index}"
    
    filename += ".json"
    
    return filename

def process_enriched_file(file_path, output_base_dir):
    """Process a single enriched JSON file"""
    filename = os.path.basename(file_path)
    print(f"\n📄 Processing: {filename}")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if 'exams' not in data or not isinstance(data['exams'], list):
            print(f"   ⚠️  No exams array found, skipping")
            return {'processed': 0, 'subjects': set()}
        
        exams = data['exams']
        print(f"   📚 Found {len(exams)} exam(s)")
        
        subjects_created = set()
        exams_processed = 0
        
        for idx, exam in enumerate(exams):
            subject_name = exam.get('subject', 'Unknown Subject')
            
            # Create subject folder
            subject_folder = create_subject_folder(output_base_dir, subject_name)
            subjects_created.add(subject_name)
            
            # Generate filename for this exam
            exam_filename = generate_exam_filename(exam, idx)
            exam_file_path = os.path.join(subject_folder, exam_filename)
            
            # Create single-exam JSON structure
            exam_data = {
                'exams': [exam],
                'subjectsCreated': [subject_name],
                'metadata': {
                    'source_file': filename,
                    'exam_index': idx,
                    'processed_at': datetime.now().isoformat(),
                    'total_questions': len(exam.get('questions', []))
                }
            }
            
            # Save to subject folder
            with open(exam_file_path, 'w', encoding='utf-8') as f:
                json.dump(exam_data, f, indent=2, ensure_ascii=False)
            
            exams_processed += 1
            
            question_count = len(exam.get('questions', []))
            year = exam.get('year', '?')
            semester = exam.get('semester', '?')
            
            print(f"   ✓ Saved: {subject_name} ({year}, {semester}) - {question_count} questions")
            print(f"      → {exam_filename}")
        
        return {
            'processed': exams_processed,
            'subjects': subjects_created
        }
        
    except json.JSONDecodeError as e:
        print(f"   ✗ JSON parsing error: {e}")
        return {'processed': 0, 'subjects': set()}
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return {'processed': 0, 'subjects': set()}

def create_subject_index(output_base_dir, subject_stats):
    """Create an index file for each subject folder"""
    print(f"\n📋 Creating subject index files...")
    
    for subject_name, stats in subject_stats.items():
        folder_name = sanitize_filename(subject_name)
        folder_path = os.path.join(output_base_dir, folder_name)
        
        # Find all JSON files in this subject folder
        json_files = glob.glob(f"{folder_path}/*.json")
        json_files = [f for f in json_files if not f.endswith('_index.json')]
        
        # Create index data
        index_data = {
            'subject': subject_name,
            'total_exams': len(json_files),
            'total_questions': stats['total_questions'],
            'years': sorted(list(stats['years'])),
            'semesters': sorted(list(stats['semesters'])),
            'exam_types': sorted(list(stats['exam_types'])),
            'files': []
        }
        
        # Add file info
        for json_file in sorted(json_files):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    file_data = json.load(f)
                
                if file_data['exams']:
                    exam = file_data['exams'][0]
                    index_data['files'].append({
                        'filename': os.path.basename(json_file),
                        'year': exam.get('year'),
                        'semester': exam.get('semester'),
                        'examType': exam.get('examType'),
                        'questions': len(exam.get('questions', [])),
                        'max_marks': exam.get('max_marks')
                    })
            except:
                pass
        
        # Save index file
        index_file = os.path.join(folder_path, '_index.json')
        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)
        
        print(f"   ✓ {subject_name}: {index_data['total_exams']} exams")

def main():
    # Directories
    input_dir = "C:/project/miniproject/ai_pipeline/enrichedQuestionsLy"
    output_dir = "C:/project/miniproject/ai_pipeline/organizedBySubjectLy"
    
    print("=" * 70)
    print("ORGANIZE ENRICHED QUESTIONS BY SUBJECT")
    print("=" * 70)
    print(f"Input directory:  {input_dir}")
    print(f"Output directory: {output_dir}")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Find all enriched JSON files
    enriched_files = glob.glob(f"{input_dir}/**/*_enriched.json", recursive=True)
    
    print(f"Found {len(enriched_files)} enriched JSON files")
    print("=" * 70)
    
    # Statistics
    total_exams = 0
    all_subjects = set()
    subject_stats = {}
    
    # Process each file
    for file_path in enriched_files:
        result = process_enriched_file(file_path, output_dir)
        total_exams += result['processed']
        all_subjects.update(result['subjects'])
        
        # Collect stats for each subject
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            for exam in data.get('exams', []):
                subject = exam.get('subject', 'Unknown Subject')
                
                if subject not in subject_stats:
                    subject_stats[subject] = {
                        'total_questions': 0,
                        'years': set(),
                        'semesters': set(),
                        'exam_types': set()
                    }
                
                subject_stats[subject]['total_questions'] += len(exam.get('questions', []))
                subject_stats[subject]['years'].add(exam.get('year', 'Unknown'))
                subject_stats[subject]['semesters'].add(exam.get('semester', 'Unknown'))
                subject_stats[subject]['exam_types'].add(exam.get('examType', 'main'))
        except:
            pass
    
    # Create index files for each subject
    create_subject_index(output_dir, subject_stats)
    
    # Create master index
    master_index = {
        'total_subjects': len(all_subjects),
        'total_exams': total_exams,
        'processed_at': datetime.now().isoformat(),
        'subjects': {}
    }
    
    for subject in sorted(all_subjects):
        folder_name = sanitize_filename(subject)
        folder_path = os.path.join(output_dir, folder_name)
        exam_count = len(glob.glob(f"{folder_path}/*.json")) - 1  # Exclude _index.json
        
        master_index['subjects'][subject] = {
            'folder': folder_name,
            'exam_count': exam_count,
            'stats': {
                'total_questions': subject_stats.get(subject, {}).get('total_questions', 0),
                'years': sorted(list(subject_stats.get(subject, {}).get('years', set()))),
                'semesters': sorted(list(subject_stats.get(subject, {}).get('semesters', set())))
            }
        }
    
    # Save master index
    master_index_file = os.path.join(output_dir, '_master_index.json')
    with open(master_index_file, 'w', encoding='utf-8') as f:
        json.dump(master_index, f, indent=2, ensure_ascii=False)
    
    # Summary
    print("\n" + "=" * 70)
    print("ORGANIZATION SUMMARY")
    print("=" * 70)
    print(f"📚 Total Subjects: {len(all_subjects)}")
    print(f"📝 Total Exams: {total_exams}")
    print(f"📁 Output Directory: {output_dir}")
    print(f"\n✓ Created subject folders:")
    
    for subject in sorted(all_subjects):
        folder_name = sanitize_filename(subject)
        exam_count = master_index['subjects'][subject]['exam_count']
        question_count = subject_stats.get(subject, {}).get('total_questions', 0)
        print(f"   • {subject}: {exam_count} exams, {question_count} questions")
    
    print(f"\n💾 Master index: {master_index_file}")
    print("=" * 70)

if __name__ == "__main__":
    main()
