#!/usr/bin/env python3
"""
Quick GPU test script to verify GPU configuration
"""

import torch
import os

def test_gpu_setup():
    print("=== GPU Configuration Test ===")
    
    # Check CUDA availability
    print(f"CUDA available: {torch.cuda.is_available()}")
    
    if torch.cuda.is_available():
        print(f"CUDA version: {torch.version.cuda}")
        print(f"Number of GPUs: {torch.cuda.device_count()}")
        
        # List all available GPUs
        for i in range(torch.cuda.device_count()):
            print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
        
        # Set and test GPU 1
        if torch.cuda.device_count() > 1:
            print("\nTesting GPU 1 configuration...")
            try:
                torch.cuda.set_device(1)
                os.environ['CUDA_VISIBLE_DEVICES'] = '1'
                current_device = torch.cuda.current_device()
                print(f"Current device: {current_device}")
                print(f"Current device name: {torch.cuda.get_device_name(current_device)}")
                
                # Test tensor creation on GPU 1
                test_tensor = torch.tensor([1, 2, 3]).cuda()
                print(f"Test tensor device: {test_tensor.device}")
                print("✅ GPU 1 configuration successful!")
                
            except Exception as e:
                print(f"❌ Error configuring GPU 1: {e}")
        else:
            print("⚠️  Only one GPU available")
    else:
        print("⚠️  CUDA not available - will use CPU")

def test_easyocr_gpu():
    print("\n=== EasyOCR GPU Test ===")
    try:
        # Configure GPU 1 before importing EasyOCR
        if torch.cuda.is_available() and torch.cuda.device_count() > 1:
            torch.cuda.set_device(1)
            os.environ['CUDA_VISIBLE_DEVICES'] = '1'
        
        import easyocr
        print("Creating EasyOCR reader with GPU 1...")
        reader = easyocr.Reader(['en'], gpu=True)
        print("✅ EasyOCR reader created successfully on GPU 1!")
        
    except Exception as e:
        print(f"❌ Error creating EasyOCR reader: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_gpu_setup()
    test_easyocr_gpu()