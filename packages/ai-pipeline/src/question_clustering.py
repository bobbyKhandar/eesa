"""
Question Clustering Module
Uses LanceDB for vector similarity search with metadata filtering
Identifies similar questions and calculates appearance frequency
"""

import json
import os
import numpy as np
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import boto3
from botocore.config import Config

# AWS Configuration
boto_config = Config(
    region_name="ap-south-1",
    connect_timeout=60,
    read_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
s3_client = boto3.client('s3', config=boto_config)
bedrock_client = boto3.client('bedrock-runtime', region_name="ap-south-1", config=boto_config)

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'

# Clustering Configuration
SIMILARITY_THRESHOLD = 0.85  # Cosine similarity threshold for similar questions
MIN_CLUSTER_SIZE = 2  # Minimum questions to form a cluster
EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"  # AWS Bedrock embedding model
EMBEDDING_DIM = 512

# LanceDB Configuration
LANCEDB_PATH = os.getenv('LANCEDB_PATH', './lancedb_data')  # Local storage path


def generate_embedding(text: str) -> Optional[np.ndarray]:
    """
    Generate embedding for text using AWS Bedrock Titan Embeddings
    
    Args:
        text: Text to embed
        
    Returns:
        numpy array of embeddings or None if failed
    """
    try:
        # Clean and truncate text if too long
        text = text.strip()[:8000]  # Titan limit is ~8K tokens
        
        request_body = {
            "inputText": text,
            "dimensions": 512,  # Can be 256, 512, or 1024
            "normalize": True
        }
        
        response = bedrock_client.invoke_model(
            modelId=EMBEDDING_MODEL,
            body=json.dumps(request_body),
            contentType='application/json',
            accept='application/json'
        )
        
        response_body = json.loads(response['body'].read())
        embedding = np.array(response_body['embedding'], dtype=np.float32)
        
        return embedding
        
    except Exception as e:
        print(f"   ✗ Failed to generate embedding: {e}")
        return None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calculate cosine similarity between two vectors"""
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


def get_or_create_lancedb_table(table_name: str = "questions"):
    """
    Get or create LanceDB table for question embeddings
    
    Args:
        table_name: Name of the table
        
    Returns:
        LanceDB table instance
    """
    try:
        import lancedb
        import pyarrow as pa
        
        # Connect to LanceDB
        db = lancedb.connect(LANCEDB_PATH)
        
        # Check if table exists
        if table_name in db.table_names():
            print(f"   ✓ Using existing LanceDB table: {table_name}")
            return db.open_table(table_name)
        
        # Create schema for questions table
        schema = pa.schema([
            pa.field("id", pa.string()),
            pa.field("question_number", pa.string()),
            pa.field("question_text", pa.string()),
            pa.field("subject", pa.string()),
            pa.field("year", pa.string()),
            pa.field("semester", pa.string()),
            pa.field("exam_type", pa.string()),
            pa.field("branch", pa.string()),
            pa.field("marks", pa.int32()),
            pa.field("bloom_level", pa.string()),
            pa.field("difficulty", pa.string()),
            pa.field("keywords", pa.list_(pa.string())),
            pa.field("topics_covered", pa.list_(pa.string())),
            pa.field("source_key", pa.string()),
            pa.field("job_id", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), EMBEDDING_DIM)),
        ])
        
        # Create empty table
        table = db.create_table(table_name, schema=schema)
        print(f"   ✓ Created new LanceDB table: {table_name}")
        
        return table
        
    except ImportError:
        print("   ⚠ LanceDB not installed. Install with: pip install lancedb")
        return None
    except Exception as e:
        print(f"   ✗ Failed to create LanceDB table: {e}")
        return None


def cluster_with_hdbscan(embeddings: np.ndarray) -> Optional[np.ndarray]:
    """
    Cluster questions using HDBSCAN
    
    Args:
        embeddings: Array of embeddings
        
    Returns:
        Array of cluster labels or None if failed
    """
    try:
        import hdbscan
        from sklearn.metrics.pairwise import cosine_distances
        
        # HDBSCAN doesn't support cosine metric directly in all versions
        # Use euclidean on normalized vectors (equivalent to cosine distance)
        # Or precompute cosine distance matrix
        
        # Normalize embeddings (already normalized from Bedrock, but ensure it)
        from sklearn.preprocessing import normalize
        normalized_embeddings = normalize(embeddings, norm='l2')
        
        # Use euclidean metric on normalized vectors (equivalent to cosine)
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=MIN_CLUSTER_SIZE,
            min_samples=1,
            metric='euclidean',  # Use euclidean on normalized vectors
            cluster_selection_method='eom'
        )
        
        cluster_labels = clusterer.fit_predict(normalized_embeddings)
        
        return cluster_labels
        
    except ImportError as ie:
        print(f"   ⚠ Missing dependency: {ie}")
        print("   Install with: pip install hdbscan scikit-learn")
        return None
    except Exception as e:
        print(f"   ✗ Failed to cluster with HDBSCAN: {e}")
        return None


def find_similar_questions_lancedb(
    table,
    query_vector: np.ndarray,
    question_id: str,
    filters: Optional[Dict] = None,
    k: int = 10
) -> List[Dict]:
    """
    Find k most similar questions using LanceDB
    
    Args:
        table: LanceDB table
        query_vector: Query embedding
        question_id: ID of the query question (to exclude from results)
        filters: Optional metadata filters (e.g., {"subject": "Computer Networks"})
        k: Number of similar questions to find
        
    Returns:
        List of similar question records
    """
    try:
        # Build query
        query = table.search(query_vector.tolist()).limit(k + 5)  # Get extra to account for filtering
        
        # Add metadata filters if provided
        if filters:
            for key, value in filters.items():
                query = query.where(f"{key} = '{value}'")
        
        # Execute search
        results = query.to_list()
        
        # Filter out the query question itself and apply similarity threshold
        similar = []
        for result in results:
            if result['id'] == question_id:
                continue
            
            # LanceDB returns _distance, lower is better
            # Convert to similarity score (1 - distance for cosine)
            similarity = 1 - result.get('_distance', 1.0)
            
            if similarity >= SIMILARITY_THRESHOLD:
                result['similarity'] = similarity
                similar.append(result)
        
        return similar[:k]
        
    except Exception as e:
        print(f"   ⚠ LanceDB search failed: {e}")
        return []


def calculate_appearance_frequency(
    table,
    question: Dict,
    similar_questions: List[Dict]
) -> Dict:
    """
    Calculate how often similar questions appear across years
    
    Args:
        table: LanceDB table
        question: Current question
        similar_questions: List of similar question records
        
    Returns:
        Appearance frequency info
    """
    years_set = set()
    
    # Add current question year
    current_year = question.get('year')
    if current_year:
        try:
            years_set.add(int(current_year))
        except (ValueError, TypeError):
            pass
    
    # Add similar questions' years
    for sim_q in similar_questions:
        year = sim_q.get('year')
        if year:
            try:
                years_set.add(int(year))
            except (ValueError, TypeError):
                pass
    
    years_list = sorted(list(years_set))
    return {
        'count': len(similar_questions) + 1,  # Include current question
        'years': years_list
    }


def cluster_questions_for_job(job_id: str, filename: str) -> Optional[Dict]:
    """
    Main function to cluster questions and find similarities using LanceDB
    
    Args:
        job_id: Job identifier
        filename: Original filename
        
    Returns:
        Result metadata or None if failed
    """
    try:
        print(f"\n{'='*60}")
        print(f"🔍 Stage 5: Question Clustering & Similarity Analysis (LanceDB)")
        print(f"{'='*60}")
        
        # Step 1: Initialize LanceDB
        print(f"📊 Initializing LanceDB...")
        table = get_or_create_lancedb_table("questions")
        
        if table is None:
            print(f"   ✗ Failed to initialize LanceDB")
            return None
        
        # Step 2: Load organized output
        print(f"📥 Loading organized questions from S3...")
        organized_prefix = f"{S3_JOBS_PREFIX}{job_id}/organized_output/"
        
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=organized_prefix
        )
        
        if 'Contents' not in response:
            print(f"   ✗ No organized output found")
            return None
        
        # Collect all questions from all exams
        all_questions = []
        
        for obj in response['Contents']:
            key = obj['Key']
            if key.endswith('.json') and 'index' not in key.lower():
                obj_response = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
                data = json.loads(obj_response['Body'].read().decode('utf-8'))
                
                if isinstance(data, dict) and 'exams' in data:
                    for exam in data['exams']:
                        if 'questions' in exam:
                            for q in exam['questions']:
                                # Add exam metadata to question
                                q['subject'] = exam.get('subject', 'Unknown')
                                q['year'] = exam.get('year', 'Unknown')
                                q['semester'] = exam.get('semester', 'Unknown')
                                q['exam_type'] = exam.get('examType', 'main')
                                q['branch'] = exam.get('branch', 'CSE')
                                q['source_file'] = key
                                q['job_id'] = job_id
                                
                                all_questions.append(q)
        
        if not all_questions:
            print(f"   ✗ No questions found in organized output")
            return None
        
        print(f"   ✓ Loaded {len(all_questions)} questions")
        
        # Step 3: Generate embeddings and prepare for LanceDB
        print(f"\n📊 Generating embeddings for {len(all_questions)} questions...")
        records_to_add = []
        
        for idx, q in enumerate(all_questions):
            # Combine question text and keywords for better embeddings
            text = q.get('question_text', q.get('questionText', ''))
            keywords = q.get('keywords', [])
            if keywords:
                text = f"{text}\nKeywords: {', '.join(keywords)}"
            
            embedding = generate_embedding(text)
            if embedding is None:
                continue
            
            # Prepare record for LanceDB
            question_id = f"{job_id}_{q.get('question_number', idx)}"
            record = {
                "id": question_id,
                "question_number": str(q.get('question_number', q.get('questionNumber', f'Q{idx+1}'))),
                "question_text": text[:1000],  # Truncate for storage
                "subject": str(q.get('subject', 'Unknown')),
                "year": str(q.get('year', 'Unknown')),
                "semester": str(q.get('semester', 'Unknown')),
                "exam_type": str(q.get('exam_type', 'main')),
                "branch": str(q.get('branch', 'CSE')),
                "marks": int(q.get('marks') or 0) if q.get('marks') not in [None, '', ' '] else 0,
                "bloom_level": str(q.get('bloomLevel', 'Unknown')),
                "difficulty": str(q.get('difficulty', 'Medium')),
                "keywords": keywords if keywords else [],
                "topics_covered": q.get('topicsCovered', q.get('syllabusTopics', [])),
                "source_key": str(q.get('source_file', '')),
                "job_id": job_id,
                "vector": embedding.tolist()
            }
            
            records_to_add.append(record)
            
            if (idx + 1) % 10 == 0:
                print(f"   Progress: {idx + 1}/{len(all_questions)}")
        
        if not records_to_add:
            print(f"   ✗ Failed to generate embeddings")
            return None
        
        print(f"   ✓ Generated {len(records_to_add)} embeddings")
        
        # Step 4: Add to LanceDB
        print(f"\n💾 Adding questions to LanceDB...")
        table.add(records_to_add)
        print(f"   ✓ Added {len(records_to_add)} questions to database")
        
        # Step 5: Find similar questions for each question
        print(f"\n🔗 Finding similar questions (threshold: {SIMILARITY_THRESHOLD})...")
        questions_with_similarity = []
        similarity_stats = {'total_pairs': 0, 'high_similarity': 0}
        
        for record in records_to_add:
            # Find similar questions
            similar = find_similar_questions_lancedb(
                table,
                np.array(record['vector']),
                record['id'],
                filters=None,  # Can filter by subject/year if needed
                k=5
            )
            
            if similar:
                # Extract similar question IDs and calculate appearance frequency
                similar_ids = [s['question_number'] for s in similar]
                
                # Calculate frequency based on original question data
                original_q = next((q for q in all_questions if 
                                 f"{job_id}_{q.get('question_number', '')}" == record['id']), {})
                
                frequency = calculate_appearance_frequency(table, original_q, similar)
                
                # Store results
                questions_with_similarity.append({
                    'id': record['id'],
                    'question_number': record['question_number'],
                    'source_key': record['source_key'],
                    'similar_ids': similar_ids,
                    'appearance_frequency': frequency,
                    'cluster_id': None  # Will be populated by HDBSCAN if enabled
                })
                
                similarity_stats['total_pairs'] += len(similar)
                similarity_stats['high_similarity'] += sum(1 for s in similar if s.get('similarity', 0) > 0.95)
        
        print(f"   ✓ Found {similarity_stats['total_pairs']} similar question pairs")
        print(f"   ✓ High similarity (>0.95): {similarity_stats['high_similarity']} pairs")
        
        # Step 6: Optional HDBSCAN clustering for topic groups
        print(f"\n🎯 Clustering questions by topic with HDBSCAN...")
        vectors = np.array([r['vector'] for r in records_to_add])
        cluster_labels = cluster_with_hdbscan(vectors)
        
        n_clusters = 0
        n_noise = 0
        if cluster_labels is not None:
            n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
            n_noise = list(cluster_labels).count(-1)
            print(f"   ✓ Found {n_clusters} topic clusters")
            print(f"   ✓ Noise points: {n_noise}")
            
            # Add cluster IDs to similarity data
            for i, record in enumerate(questions_with_similarity):
                if i < len(cluster_labels):
                    record['cluster_id'] = int(cluster_labels[i])
        
        # Step 7: Update questions in S3 with clustering data
        print(f"\n💾 Updating questions with clustering data...")
        questions_by_file = defaultdict(list)
        
        for sim_data in questions_with_similarity:
            questions_by_file[sim_data['source_key']].append(sim_data)
        
        updated_files = 0
        for source_key, sim_list in questions_by_file.items():
            try:
                # Load original file
                obj_response = s3_client.get_object(Bucket=S3_BUCKET, Key=source_key)
                data = json.loads(obj_response['Body'].read().decode('utf-8'))
                
                # Update questions in the data
                if isinstance(data, dict) and 'exams' in data:
                    for exam in data['exams']:
                        if 'questions' in exam:
                            for i, q in enumerate(exam['questions']):
                                q_num = str(q.get('question_number', q.get('questionNumber')))
                                
                                # Find matching similarity data
                                for sim_data in sim_list:
                                    if sim_data['question_number'] == q_num:
                                        exam['questions'][i]['similarQuestionIds'] = sim_data['similar_ids']
                                        exam['questions'][i]['appearanceFrequency'] = sim_data['appearance_frequency']
                                        if sim_data['cluster_id'] is not None:
                                            exam['questions'][i]['clusterId'] = sim_data['cluster_id']
                
                # Save back to S3
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=source_key,
                    Body=json.dumps(data, indent=2, ensure_ascii=False),
                    ContentType='application/json'
                )
                updated_files += 1
                
            except Exception as e:
                print(f"   ⚠ Failed to update {source_key}: {e}")
        
        print(f"   ✓ Updated {updated_files} files with clustering data")
        
        # Step 8: Save clustering summary
        summary = {
            'job_id': job_id,
            'filename': filename,
            'processed_at': datetime.now().isoformat(),
            'total_questions': len(records_to_add),
            'total_similar_pairs': similarity_stats['total_pairs'],
            'high_similarity_pairs': similarity_stats['high_similarity'],
            'n_clusters': int(n_clusters) if cluster_labels is not None else 0,
            'n_noise': int(n_noise) if cluster_labels is not None else 0,
            'similarity_threshold': SIMILARITY_THRESHOLD,
            'embedding_model': EMBEDDING_MODEL,
            'storage': 'lancedb'
        }
        
        summary_key = f"{S3_JOBS_PREFIX}{job_id}/clustering_summary.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=summary_key,
            Body=json.dumps(summary, indent=2),
            ContentType='application/json'
        )
        
        print(f"\n✅ Clustering complete!")
        print(f"   📊 Summary: {summary['total_similar_pairs']} similar pairs, {summary['n_clusters']} topics")
        print(f"   💾 LanceDB: {len(records_to_add)} questions indexed")
        
        return summary
        
    except Exception as e:
        print(f"\n❌ Clustering failed: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    # Test with a job ID
    import sys
    if len(sys.argv) > 1:
        job_id = sys.argv[1]
        filename = sys.argv[2] if len(sys.argv) > 2 else "test.pdf"
        result = cluster_questions_for_job(job_id, filename)
        if result:
            print(f"\n✅ Success: {result}")
        else:
            print(f"\n❌ Failed")
