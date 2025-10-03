#!/usr/bin/env python3
"""
Quick test to check if GPU 1 is being used correctly
"""

import torch
import os

def quick_gpu_test():
    print("=== Quick GPU Test ===")
    
    if torch.cuda.is_available():
        device_count = torch.cuda.device_count()
        print(f"Found {device_count} CUDA devices")
        
        for i in range(device_count):
            print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
        
        if device_count > 1:
            # Test setting GPU 1
            torch.cuda.set_device(1)
            os.environ['CUDA_VISIBLE_DEVICES'] = '1'
            current_device = torch.cuda.current_device()
            print(f"\nSet to use GPU 1")
            print(f"Current device: {current_device}")
            print(f"Device name: {torch.cuda.get_device_name(current_device)}")
            print("✅ GPU 1 configuration successful!")
        else:
            print("⚠️  Only one GPU available")
    else:
        print("❌ CUDA not available")

if __name__ == "__main__":
    quick_gpu_test()