"""
Test Suite for Question Enrichment Pipeline

This test file validates the enrichment pipeline functionality including:
- State management (load/save)
- Bloom's taxonomy enrichment
- S3 upload/download
- Concurrent processing
- Error handling and retries

Run with: python test_enrichment_pipeline.py
"""

import os
import sys
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import time

# Add parent directory to path to import the pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import functions to test
from enrich_questions_s3_pipeline import (
    load_state,
    save_state,
    get_bloom_enrichment,
    enrich_single_file,
    upload_enriched_to_s3,
    process_all_questions
)


class TestEnrichmentPipeline:
    """Test class for enrichment pipeline"""
    
    def __init__(self):
        self.test_dir = None
        self.passed = 0
        self.failed = 0
        
    def setup(self):
        """Create temporary test directory"""
        self.test_dir = tempfile.mkdtemp()
        print(f"\n📁 Created test directory: {self.test_dir}")
        
    def teardown(self):
        """Clean up test directory"""
        if self.test_dir and os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)
            print(f"\n🗑️  Cleaned up test directory")
    
    def assert_true(self, condition, message):
        """Assert helper"""
        if condition:
            print(f"  ✓ {message}")
            self.passed += 1
        else:
            print(f"  ✗ {message}")
            self.failed += 1
    
    def create_test_parsed_file(self, filename="test_exam.json"):
        """Create a sample parsed question JSON file"""
        test_data = {
            "exams": [
                {
                    "subject": "Test Subject",
                    "max_marks": "100",
                    "year": "2025",
                    "semester": "I",
                    "branch": "Computer",
                    "questions": [
                        {
                            "question_number": "Q1",
                            "question_text": "Define the concept of algorithms",
                            "questionType": "text",
                            "marks": "5"
                        },
                        {
                            "question_number": "Q2",
                            "question_text": "Implement a sorting algorithm",
                            "questionType": "text",
                            "marks": "10"
                        },
                        {
                            "question_number": "Q3",
                            "question_text": "Analyze the time complexity",
                            "questionType": "text",
                            "marks": "15"
                        }
                    ]
                }
            ],
            "subjectsCreated": ["Test Subject"]
        }
        
        file_path = os.path.join(self.test_dir, filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(test_data, f, indent=2)
        
        return file_path
    
    def test_state_management(self):
        """Test 1: State save and load"""
        print("\n🧪 Test 1: State Management")
        
        test_state = {
            'processed': ['file1.json', 'file2.json'],
            'failed': ['error1.json'],
            'retry_counts': {'error1.json': 2},
            'last_updated': '2025-12-10T10:00:00'
        }
        
        # Create temp state file path
        state_file = os.path.join(self.test_dir, 'test_state.json')
        
        # Temporarily override the LOCAL_STATE_FILE
        import enrich_questions_s3_pipeline
        original_state_file = enrich_questions_s3_pipeline.LOCAL_STATE_FILE
        enrich_questions_s3_pipeline.LOCAL_STATE_FILE = state_file
        
        try:
            # Test save (will fail S3 but succeed locally)
            with patch('enrich_questions_s3_pipeline.s3_client') as mock_s3:
                mock_s3.put_object.side_effect = Exception("S3 mock error")
                save_state(test_state)
            
            # Verify local file was created
            self.assert_true(
                os.path.exists(state_file),
                "State file created locally"
            )
            
            # Test load from local
            with patch('enrich_questions_s3_pipeline.s3_client') as mock_s3:
                mock_s3.get_object.side_effect = Exception("NoSuchKey: Not found")
                loaded_state = load_state()
            
            self.assert_true(
                loaded_state['processed'] == test_state['processed'],
                "State loaded correctly from local file"
            )
            
            self.assert_true(
                loaded_state['retry_counts'] == test_state['retry_counts'],
                "Retry counts preserved"
            )
            
        finally:
            # Restore original state file path
            enrich_questions_s3_pipeline.LOCAL_STATE_FILE = original_state_file
    
    def test_parsed_file_reading(self):
        """Test 2: Reading and parsing test files"""
        print("\n🧪 Test 2: Parsed File Reading")
        
        # Create test file
        test_file = self.create_test_parsed_file("sample_exam.json")
        
        # Read and verify
        with open(test_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        self.assert_true(
            'exams' in data,
            "Parsed file has 'exams' key"
        )
        
        self.assert_true(
            len(data['exams']) == 1,
            "Contains 1 exam"
        )
        
        self.assert_true(
            len(data['exams'][0]['questions']) == 3,
            "Contains 3 questions"
        )
        
        self.assert_true(
            data['exams'][0]['subject'] == "Test Subject",
            "Subject name correct"
        )
    
    def test_bloom_enrichment_mock(self):
        """Test 3: Bloom's taxonomy enrichment (mocked)"""
        print("\n🧪 Test 3: Bloom's Enrichment (Mocked)")
        
        test_questions = [
            {
                "question_number": "Q1",
                "question_text": "Define algorithm",
                "questionType": "text",
                "marks": "5"
            }
        ]
        
        # Mock Bedrock response
        mock_response = {
            'output': {
                'message': {
                    'content': [{
                        'text': json.dumps([{
                            "questionIndex": 0,
                            "bloomLevel": "Recall",
                            "bloomJustification": "This question asks for a definition",
                            "confidence": 0.95,
                            "difficulty": "Easy",
                            "keywords": ["algorithm", "definition"],
                            "topicsCovered": ["Algorithms", "Basics"]
                        }])
                    }]
                }
            }
        }
        
        with patch('enrich_questions_s3_pipeline.bedrock_client') as mock_bedrock:
            mock_bedrock.converse.return_value = mock_response
            
            result = get_bloom_enrichment(test_questions, "CS", "I", "Computer")
            
            self.assert_true(
                result is not None,
                "Bloom enrichment returned data"
            )
            
            self.assert_true(
                len(result) == 1,
                "Returned 1 enrichment entry"
            )
            
            self.assert_true(
                result[0]['bloomLevel'] == 'Recall',
                "Bloom level is 'Recall'"
            )
            
            self.assert_true(
                result[0]['confidence'] == 0.95,
                "Confidence value correct"
            )
    
    def test_file_enrichment(self):
        """Test 4: Single file enrichment (mocked)"""
        print("\n🧪 Test 4: Single File Enrichment (Mocked)")
        
        # Create test file
        test_file = self.create_test_parsed_file("enrichment_test.json")
        
        # Mock Bedrock response for 3 questions
        mock_bloom_data = [
            {
                "questionIndex": 0,
                "bloomLevel": "Recall",
                "bloomJustification": "Asks for definition",
                "confidence": 0.95,
                "difficulty": "Easy",
                "keywords": ["algorithm"],
                "topicsCovered": ["Basics"]
            },
            {
                "questionIndex": 1,
                "bloomLevel": "Apply",
                "bloomJustification": "Requires implementation",
                "confidence": 0.90,
                "difficulty": "Medium",
                "keywords": ["sorting", "implementation"],
                "topicsCovered": ["Algorithms", "Sorting"]
            },
            {
                "questionIndex": 2,
                "bloomLevel": "Analyze",
                "bloomJustification": "Requires analysis",
                "confidence": 0.88,
                "difficulty": "Hard",
                "keywords": ["complexity", "analysis"],
                "topicsCovered": ["Time Complexity"]
            }
        ]
        
        with patch('enrich_questions_s3_pipeline.get_bloom_enrichment') as mock_bloom:
            mock_bloom.return_value = mock_bloom_data
            
            result = enrich_single_file(test_file, "enrichment_test.json")
            
            self.assert_true(
                result is not None,
                "File enrichment succeeded"
            )
            
            self.assert_true(
                len(result['exams'][0]['questions']) == 3,
                "All questions enriched"
            )
            
            # Check first question has Bloom fields
            q1 = result['exams'][0]['questions'][0]
            
            self.assert_true(
                'bloomLevel' in q1,
                "Question has bloomLevel"
            )
            
            self.assert_true(
                'confidence' in q1,
                "Question has confidence"
            )
            
            self.assert_true(
                'keywords' in q1,
                "Question has keywords"
            )
            
            self.assert_true(
                q1['bloomLevel'] == 'Recall',
                "First question has correct Bloom level"
            )
    
    def test_s3_upload_mock(self):
        """Test 5: S3 upload (mocked)"""
        print("\n🧪 Test 5: S3 Upload (Mocked)")
        
        test_data = {
            'exams': [],
            'subjectsCreated': []
        }
        
        with patch('enrich_questions_s3_pipeline.s3_client') as mock_s3:
            mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
            
            result = upload_enriched_to_s3(test_data, "test_file.json")
            
            self.assert_true(
                result is True,
                "S3 upload succeeded (mocked)"
            )
            
            # Verify put_object was called
            self.assert_true(
                mock_s3.put_object.called,
                "S3 put_object was called"
            )
            
            # Check the call arguments
            call_args = mock_s3.put_object.call_args
            
            self.assert_true(
                'enriched_questions/' in call_args[1]['Key'],
                "S3 key has correct prefix"
            )
            
            self.assert_true(
                '_enriched.json' in call_args[1]['Key'],
                "Filename has _enriched suffix"
            )
    
    def test_concurrent_processing_simulation(self):
        """Test 6: Concurrent processing (simulated)"""
        print("\n🧪 Test 6: Concurrent Processing Simulation")
        
        # Clear any existing files from previous tests
        for f in Path(self.test_dir).glob('*.json'):
            f.unlink()
        
        # Create multiple test files
        num_files = 5
        for i in range(num_files):
            self.create_test_parsed_file(f"test_exam_{i}.json")
        
        # Count files
        test_files = list(Path(self.test_dir).glob('*.json'))
        
        self.assert_true(
            len(test_files) == num_files,
            f"Created {num_files} test files"
        )
        
        # Simulate concurrent processing would work
        from concurrent.futures import ThreadPoolExecutor
        
        def mock_process(file_path):
            time.sleep(0.1)  # Simulate processing
            return f"Processed: {file_path.name}"
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            results = list(executor.map(mock_process, test_files))
        
        self.assert_true(
            len(results) == num_files,
            f"Concurrent processing handled all {num_files} files"
        )
    
    def test_error_file_detection(self):
        """Test 7: Error file detection"""
        print("\n🧪 Test 7: Error File Detection")
        
        # Clear any existing files from previous tests
        for f in Path(self.test_dir).glob('*.json'):
            f.unlink()
        
        # Create normal and error files
        self.create_test_parsed_file("normal_file.json")
        self.create_test_parsed_file("error_file.json")
        self.create_test_parsed_file("another_error.json")
        
        all_files = list(Path(self.test_dir).glob('*.json'))
        
        # Separate like the pipeline does
        non_error_files = [f for f in all_files if 'error' not in f.name.lower()]
        error_files = [f for f in all_files if 'error' in f.name.lower()]
        
        self.assert_true(
            len(non_error_files) == 1,
            "Detected 1 non-error file"
        )
        
        self.assert_true(
            len(error_files) == 2,
            "Detected 2 error files"
        )
        
        self.assert_true(
            all('error' in f.name.lower() for f in error_files),
            "All error files contain 'error' in name"
        )
    
    def test_enriched_output_format(self):
        """Test 8: Enriched output format validation"""
        print("\n🧪 Test 8: Enriched Output Format")
        
        # Create test file and enrich it
        test_file = self.create_test_parsed_file("format_test.json")
        
        mock_bloom_data = [
            {
                "questionIndex": i,
                "bloomLevel": "Apply",
                "bloomJustification": "Test justification",
                "confidence": 0.9,
                "difficulty": "Medium",
                "keywords": ["test"],
                "topicsCovered": ["Testing"]
            }
            for i in range(3)
        ]
        
        with patch('enrich_questions_s3_pipeline.get_bloom_enrichment') as mock_bloom:
            mock_bloom.return_value = mock_bloom_data
            
            enriched = enrich_single_file(test_file, "format_test.json")
            
            # Validate enriched structure
            self.assert_true(
                'exams' in enriched,
                "Has 'exams' key"
            )
            
            self.assert_true(
                'subjectsCreated' in enriched,
                "Has 'subjectsCreated' key"
            )
            
            # Check question structure
            q = enriched['exams'][0]['questions'][0]
            
            required_fields = [
                'question_number', 'question_text', 'questionType', 'marks',
                'bloomLevel', 'bloomJustification', 'confidence', 
                'difficulty', 'keywords', 'topicsCovered'
            ]
            
            for field in required_fields:
                self.assert_true(
                    field in q,
                    f"Question has '{field}' field"
                )
    
    def run_all_tests(self):
        """Run all tests"""
        print("=" * 80)
        print("ENRICHMENT PIPELINE TEST SUITE")
        print("=" * 80)
        
        self.setup()
        
        try:
            self.test_state_management()
            self.test_parsed_file_reading()
            self.test_bloom_enrichment_mock()
            self.test_file_enrichment()
            self.test_s3_upload_mock()
            self.test_concurrent_processing_simulation()
            self.test_error_file_detection()
            self.test_enriched_output_format()
            
        finally:
            self.teardown()
        
        # Summary
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"✓ Passed: {self.passed}")
        print(f"✗ Failed: {self.failed}")
        print(f"📊 Total: {self.passed + self.failed}")
        
        if self.failed == 0:
            print("\n🎉 All tests passed!")
            return 0
        else:
            print(f"\n⚠️  {self.failed} test(s) failed")
            return 1


def test_real_pipeline_on_sample_data():
    """
    Optional: Test with real parsedQuestions data if available
    This is a manual integration test
    """
    print("\n" + "=" * 80)
    print("INTEGRATION TEST - Real Data (if available)")
    print("=" * 80)
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parsed_dir = os.path.join(script_dir, '../parsedQuestions')
    
    if not os.path.exists(parsed_dir):
        print(f"⚠️  parsedQuestions directory not found at: {parsed_dir}")
        print("   Skipping integration test")
        return
    
    # Check for sample files
    json_files = list(Path(parsed_dir).glob('*.json'))[:3]  # Take first 3
    
    if not json_files:
        print("⚠️  No JSON files found in parsedQuestions")
        return
    
    print(f"📁 Found {len(json_files)} sample files")
    
    for f in json_files:
        print(f"\n📄 Sample file: {f.name}")
        
        try:
            with open(f, 'r', encoding='utf-8') as file:
                data = json.load(file)
            
            print(f"   ✓ Valid JSON")
            print(f"   • Exams: {len(data.get('exams', []))}")
            
            if data.get('exams'):
                exam = data['exams'][0]
                print(f"   • Subject: {exam.get('subject', 'N/A')}")
                print(f"   • Questions: {len(exam.get('questions', []))}")
                
        except Exception as e:
            print(f"   ✗ Error: {e}")


if __name__ == "__main__":
    # Run unit tests
    tester = TestEnrichmentPipeline()
    exit_code = tester.run_all_tests()
    
    # Run integration test if data available
    test_real_pipeline_on_sample_data()
    
    sys.exit(exit_code)
