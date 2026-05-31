"""
Test runner for all AI Pipeline tests.
Runs all unit tests for the clean class-based architecture and provides a comprehensive summary report.
"""

import unittest
import sys
import os
import time
from io import StringIO

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Test modules for clean architecture
TEST_MODULES = [
    'test_ocr_engine',
    'test_image_processor', 
    'test_pdf_handler',
    'test_pipeline_manager',
    'test_server',
    'test_redis_client',
    'test_clean_integration'
]

def run_all_tests():
    """Run all unit tests and return results"""
    print("🧪 AI Pipeline - Clean Architecture Test Suite")
    print("="*70)
    print("Testing modules:")
    for module in TEST_MODULES:
        print(f"  📄 {module}")
    print("="*70)
    
    start_time = time.time()
    
    # Discover and run all tests
    loader = unittest.TestLoader()
    suite = loader.discover('tests', pattern='test_*.py')
    
    # Run tests with detailed output
    runner = unittest.TextTestRunner(verbosity=2, stream=sys.stdout)
    result = runner.run(suite)
    
    end_time = time.time()
    execution_time = end_time - start_time
    
    # Print comprehensive summary
    print("\n" + "="*70)
    print("🏁 TEST EXECUTION SUMMARY")
    print("="*70)
    print(f"⏱️  Total execution time: {execution_time:.2f} seconds")
    print(f"🔢 Tests run: {result.testsRun}")
    print(f"✅ Successful: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"❌ Failures: {len(result.failures)}")
    print(f"💥 Errors: {len(result.errors)}")
    print(f"⏭️  Skipped: {len(result.skipped) if hasattr(result, 'skipped') else 0}")
    
    # Calculate and display success rate
    if result.testsRun > 0:
        success_rate = (result.testsRun - len(result.failures) - len(result.errors)) / result.testsRun * 100
        print(f"📊 Success Rate: {success_rate:.1f}%")
    else:
        print("📊 Success Rate: N/A (No tests run)")
    
    # Show detailed failure information
    if result.failures:
        print(f"\n💔 DETAILED FAILURES ({len(result.failures)}):")
        print("-" * 50)
        for i, (test, traceback) in enumerate(result.failures, 1):
            print(f"{i:2d}. {test}")
            # Show first few lines of traceback for context
            traceback_lines = traceback.split('\n')[:3]
            for line in traceback_lines:
                if line.strip():
                    print(f"     {line}")
            print()
    
    # Show detailed error information  
    if result.errors:
        print(f"\n🚨 DETAILED ERRORS ({len(result.errors)}):")
        print("-" * 50)
        for i, (test, traceback) in enumerate(result.errors, 1):
            print(f"{i:2d}. {test}")
            # Show first few lines of traceback for context
            traceback_lines = traceback.split('\n')[:3]
            for line in traceback_lines:
                if line.strip():
                    print(f"     {line}")
            print()
    
    # Module-wise summary
    print(f"\n📋 MODULE COVERAGE:")
    print("-" * 50)
    for module in TEST_MODULES:
        if any(module in str(test) for test, _ in result.failures + result.errors):
            status = "❌ FAILED"
        elif result.testsRun > 0:
            # Check if module has any tests that ran successfully
            module_failed = any(module in str(test) for test, _ in result.failures + result.errors)
            status = "✅ PASSED" if not module_failed else "❌ FAILED"
        else:
            status = "⏭️  SKIPPED"
        print(f"  {module:<25} {status}")
    
    print("="*70)
    
    return result.wasSuccessful()

def run_specific_module(module_name):
    """Run tests for a specific module"""
    if module_name not in TEST_MODULES:
        print(f"❌ Unknown module: {module_name}")
        print(f"Available modules: {', '.join(TEST_MODULES)}")
        return False
    
    print(f"🎯 Running tests for module: {module_name}")
    print("="*50)
    
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromName(f'tests.{module_name}')
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    print(f"\n📊 Module {module_name} Results:")
    print(f"   Tests: {result.testsRun}, Failures: {len(result.failures)}, Errors: {len(result.errors)}")
    
    return result.wasSuccessful()

def list_available_tests():
    """List all available test classes and methods"""
    print("📋 Available Test Classes and Methods:")
    print("="*50)
    
    for module in TEST_MODULES:
        try:
            test_module = __import__(f'tests.{module}', fromlist=[''])
            print(f"\n📄 {module}:")
            
            # Get all test classes
            for name in dir(test_module):
                obj = getattr(test_module, name)
                if isinstance(obj, type) and issubclass(obj, unittest.TestCase) and obj != unittest.TestCase:
                    print(f"   🔹 {name}")
                    
                    # Get test methods
                    for method_name in dir(obj):
                        if method_name.startswith('test_'):
                            print(f"      • {method_name}")
        except ImportError as e:
            print(f"   ❌ Could not import {module}: {e}")

if __name__ == '__main__':
    # Create test directory if it doesn't exist
    os.makedirs('tests', exist_ok=True)
    
    # Handle command line arguments
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'list':
            list_available_tests()
            sys.exit(0)
        elif command in TEST_MODULES:
            success = run_specific_module(command)
        elif command == 'help':
            print("🆘 AI Pipeline Test Runner - Usage:")
            print("  python run_tests.py          - Run all tests")
            print("  python run_tests.py list     - List all available tests")
            print("  python run_tests.py <module> - Run specific module tests")
            print("  python run_tests.py help     - Show this help")
            print(f"\nAvailable modules: {', '.join(TEST_MODULES)}")
            sys.exit(0)
        else:
            print(f"❌ Unknown command or module: {command}")
            print("Use 'python run_tests.py help' for usage information")
            sys.exit(1)
    else:
        # Run all tests
        success = run_all_tests()
    
    # Exit with appropriate code
    if success:
        print("\n🎉 All tests completed successfully!")
        sys.exit(0)
    else:
        print("\n💀 Some tests failed. Please review and fix the issues.")
        sys.exit(1)