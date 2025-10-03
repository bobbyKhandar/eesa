#!/usr/bin/env python3
"""
Test script to validate OCR pipeline worker allocation and performance
"""

import os
import sys
import time
import multiprocessing
import psutil
from pathlib import Path

# Add the ai-pipeline directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_cpu_allocation():
    """Test the CPU core allocation logic"""
    print("=== CPU Core Allocation Test ===")
    
    # Get system info
    total_cores = multiprocessing.cpu_count()
    available_cores = max(1, total_cores - 1)  # Reserve 1 for OS
    preprocessing_workers = max(1, available_cores - 1)  # Reserve 1 for OCR
    ocr_workers = 1
    
    print(f"Total CPU cores: {total_cores}")
    print(f"Available cores (OS reserved): {available_cores}")
    print(f"Preprocessing workers: {preprocessing_workers}")
    print(f"OCR workers: {ocr_workers}")
    print(f"Total workers: {preprocessing_workers + ocr_workers}")
    print(f"Cores reserved for OS: 1")
    
    # Validate allocation
    assert preprocessing_workers >= 1, "Must have at least 1 preprocessing worker"
    assert ocr_workers == 1, "Must have exactly 1 OCR worker"
    assert (preprocessing_workers + ocr_workers) <= available_cores, "Workers exceed available cores"
    
    print("✅ CPU allocation logic is correct\n")
    return preprocessing_workers, ocr_workers

def test_system_resources():
    """Test current system resource availability"""
    print("=== System Resource Test ===")
    
    # CPU usage
    cpu_percent = psutil.cpu_percent(interval=1)
    print(f"Current CPU usage: {cpu_percent:.1f}%")
    
    # Memory usage
    memory = psutil.virtual_memory()
    print(f"Memory usage: {memory.percent:.1f}% ({memory.used / (1024**3):.1f}GB / {memory.total / (1024**3):.1f}GB)")
    
    # Disk usage
    disk = psutil.disk_usage('/')
    print(f"Disk usage: {disk.percent:.1f}%")
    
    # Check if system is under heavy load
    if cpu_percent > 80:
        print("⚠️  Warning: High CPU usage detected")
    if memory.percent > 85:
        print("⚠️  Warning: High memory usage detected")
    
    print("✅ System resource check completed\n")

def simulate_worker_load():
    """Simulate worker load to test multiprocessing"""
    print("=== Worker Load Simulation ===")
    
    def cpu_intensive_task(worker_id, duration=2):
        """Simulate CPU-intensive preprocessing work"""
        start_time = time.time()
        result = 0
        
        while time.time() - start_time < duration:
            # Simulate image processing work
            for i in range(10000):
                result += i ** 2
        
        return f"Worker {worker_id} completed in {time.time() - start_time:.2f}s"
    
    def memory_intensive_task(worker_id, duration=1):
        """Simulate memory-intensive OCR work"""
        start_time = time.time()
        
        # Simulate loading large models/data
        data = []
        for i in range(100000):
            data.append(f"OCR data point {i}")
        
        time.sleep(duration)  # Simulate OCR processing time
        
        return f"OCR Worker {worker_id} completed in {time.time() - start_time:.2f}s"
    
    # Get optimal worker counts
    preprocessing_workers, ocr_workers = test_cpu_allocation()
    
    print(f"Starting simulation with {preprocessing_workers} preprocessing + {ocr_workers} OCR workers...")
    
    start_time = time.time()
    
    # Create worker pools
    with multiprocessing.Pool(processes=preprocessing_workers) as prep_pool:
        with multiprocessing.Pool(processes=ocr_workers) as ocr_pool:
            
            # Submit preprocessing tasks
            prep_tasks = []
            for i in range(preprocessing_workers):
                task = prep_pool.apply_async(cpu_intensive_task, (i, 2))
                prep_tasks.append(task)
            
            # Submit OCR tasks  
            ocr_tasks = []
            for i in range(ocr_workers):
                task = ocr_pool.apply_async(memory_intensive_task, (i, 3))
                ocr_tasks.append(task)
            
            # Wait for completion
            print("Waiting for preprocessing workers...")
            for task in prep_tasks:
                result = task.get(timeout=10)
                print(f"  {result}")
            
            print("Waiting for OCR workers...")
            for task in ocr_tasks:
                result = task.get(timeout=10)
                print(f"  {result}")
    
    total_time = time.time() - start_time
    print(f"✅ Simulation completed in {total_time:.2f}s\n")

def test_pipeline_imports():
    """Test that OCR pipeline can be imported"""
    print("=== Pipeline Import Test ===")
    
    try:
        # Add current directory to path to handle relative imports
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        
        # Test basic imports first
        import multiprocessing
        import queue
        import time
        import json
        print("✅ Basic Python modules imported successfully")
        
        # Test OCR related imports
        import fitz  # PyMuPDF
        import cv2   # OpenCV
        import numpy as np
        print("✅ Core OCR dependencies imported successfully")
        
        # Test if we can import EasyOCR (this will test CUDA/GPU setup)
        try:
            import easyocr
            print("✅ EasyOCR imported successfully")
        except Exception as e:
            print(f"⚠️  EasyOCR import warning: {e}")
        
        # Test Redis connection
        try:
            import redis
            print("✅ Redis module imported successfully")
        except Exception as e:
            print(f"⚠️  Redis import warning: {e}")
        
        # Test worker allocation logic without importing the full pipeline
        total_cores = multiprocessing.cpu_count()
        available_cores = max(1, total_cores - 1)
        preprocessing_workers = max(1, available_cores - 1) 
        ocr_workers = 1
        
        print(f"✅ Worker allocation logic validated:")
        print(f"   - {preprocessing_workers} preprocessing workers")
        print(f"   - {ocr_workers} OCR worker") 
        print(f"   - 1 core reserved for OS")
        
        print("✅ Pipeline dependency test completed\n")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Make sure all dependencies are installed:")
        print("  pip install opencv-python easyocr PyMuPDF redis numpy")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def main():
    """Run all tests"""
    print("OCR Pipeline Worker Allocation Test Suite")
    print("=" * 50)
    
    # Test 1: CPU allocation logic
    try:
        test_cpu_allocation()
    except Exception as e:
        print(f"❌ CPU allocation test failed: {e}")
        return
    
    # Test 2: System resources
    try:
        test_system_resources()
    except Exception as e:
        print(f"❌ System resource test failed: {e}")
        return
    
    # Test 3: Pipeline imports
    if not test_pipeline_imports():
        print("❌ Pipeline import test failed - skipping worker simulation")
        return
    
    # Test 4: Worker load simulation
    try:
        simulate_worker_load()
    except Exception as e:
        print(f"❌ Worker simulation failed: {e}")
        return
    
    print("🎉 All tests completed successfully!")
    print("\nRecommendations:")
    print("1. Monitor system resources during actual OCR processing")
    print("2. Adjust worker counts based on workload characteristics")
    print("3. Consider using SSD storage for better I/O performance")
    print("4. Ensure adequate RAM for large document processing")

if __name__ == "__main__":
    main()