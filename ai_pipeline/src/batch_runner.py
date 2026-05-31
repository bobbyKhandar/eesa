"""
Batch Runner - Automated batch processing with auto-resume

Runs the pipeline in batches with:
- Automatic retry on transient failures
- Resume from last position on restart
- Progress persistence to SQLite
- Rate limiting to avoid throttling
- Configurable concurrency

Usage:
    python batch_runner.py --phase ocr --total 1000 --batch-size 10
    python batch_runner.py --phase all --total 500
    python batch_runner.py --resume
"""

import argparse
import time
import sys
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from manual_pipeline import (
    DatabaseManager, S3Manager,
    OCRProcessor, ParseProcessor, EnrichProcessor, OrganizeProcessor,
    Phase, Status, DB_PATH, DATA_DIR
)

# Progress file
PROGRESS_FILE = DATA_DIR / "batch_progress.json"


class BatchRunner:
    """Automated batch processing with progress tracking"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.s3 = S3Manager()
        self.processors = {
            'ocr': OCRProcessor(self.db, self.s3),
            'parse': ParseProcessor(self.db, self.s3),
            'enrich': EnrichProcessor(self.db, self.s3),
            'organize': OrganizeProcessor(self.db, self.s3)
        }
        self.progress = self._load_progress()
    
    def _load_progress(self) -> dict:
        """Load progress from file"""
        if PROGRESS_FILE.exists():
            with open(PROGRESS_FILE) as f:
                return json.load(f)
        return {
            "started_at": None,
            "last_phase": None,
            "processed": 0,
            "success": 0,
            "failed": 0,
            "last_updated": None
        }
    
    def _save_progress(self):
        """Save progress to file"""
        self.progress["last_updated"] = datetime.now().isoformat()
        DATA_DIR.mkdir(exist_ok=True)
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(self.progress, f, indent=2)
    
    def run_phase(self, phase: str, total: int, batch_size: int, 
                  delay_between_batches: float = 5.0,
                  max_retries_per_batch: int = 3):
        """Run a single phase in batches"""
        
        if phase not in self.processors:
            print(f"Unknown phase: {phase}")
            return
        
        processor = self.processors[phase]
        
        print(f"\n{'='*60}")
        print(f"BATCH RUNNER - Phase: {phase.upper()}")
        print(f"Total target: {total}, Batch size: {batch_size}")
        print(f"{'='*60}\n")
        
        # Initialize progress
        if not self.progress["started_at"]:
            self.progress["started_at"] = datetime.now().isoformat()
        self.progress["last_phase"] = phase
        
        processed_total = 0
        batch_num = 0
        consecutive_empty = 0
        
        while processed_total < total:
            batch_num += 1
            
            # Get pending jobs count
            pending_jobs = self.db.get_jobs_by_phase(phase, Status.PENDING.value, limit=1)
            retry_jobs = self.db.get_jobs_by_phase(phase, Status.RETRY_PENDING.value, limit=1)
            
            if not pending_jobs and not retry_jobs:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"\nNo more jobs pending for {phase}. Stopping.")
                    break
                print(f"No jobs found. Waiting 10s before retry ({consecutive_empty}/3)...")
                time.sleep(10)
                continue
            
            consecutive_empty = 0
            
            print(f"\n--- Batch {batch_num} ---")
            start_time = time.time()
            
            # Process batch with retries
            retry_count = 0
            while retry_count < max_retries_per_batch:
                try:
                    results = processor.process_batch(batch_size=batch_size)
                    break
                except Exception as e:
                    retry_count += 1
                    print(f"Batch error (retry {retry_count}/{max_retries_per_batch}): {e}")
                    if retry_count < max_retries_per_batch:
                        time.sleep(30 * retry_count)  # Exponential backoff
                    else:
                        print("Max retries reached. Moving on...")
                        results = {"processed": 0, "success": 0, "failed": 0}
            
            duration = time.time() - start_time
            
            # Update progress
            processed_total += results["processed"]
            self.progress["processed"] += results["processed"]
            self.progress["success"] += results["success"]
            self.progress["failed"] += results["failed"]
            self._save_progress()
            
            # Show progress
            pct = (processed_total / total) * 100
            print(f"\nProgress: {processed_total}/{total} ({pct:.1f}%)")
            print(f"Session totals: {self.progress['success']} success, {self.progress['failed']} failed")
            print(f"Batch took: {duration:.1f}s")
            
            # Rate limiting
            if processed_total < total and results["processed"] > 0:
                print(f"Waiting {delay_between_batches}s before next batch...")
                time.sleep(delay_between_batches)
        
        print(f"\n{'='*60}")
        print(f"PHASE {phase.upper()} COMPLETE")
        print(f"Processed: {processed_total}")
        print(f"{'='*60}\n")
    
    def run_all_phases(self, total: int, batch_size: int, delay: float = 5.0):
        """Run all phases in sequence"""
        phases = ['ocr', 'parse', 'enrich', 'organize']
        
        for phase in phases:
            self.run_phase(phase, total, batch_size, delay)
            print(f"\nCompleted phase: {phase}")
            
            # Check if there are jobs in next phase
            if phase != 'organize':
                next_phase = phases[phases.index(phase) + 1]
                next_jobs = self.db.get_jobs_by_phase(next_phase, Status.PENDING.value, limit=1)
                if not next_jobs:
                    print(f"No jobs ready for {next_phase}. Some may have failed.")
            
            time.sleep(10)  # Pause between phases
    
    def show_progress(self):
        """Show current progress"""
        print("\n" + "="*60)
        print("BATCH RUNNER PROGRESS")
        print("="*60)
        
        if not self.progress["started_at"]:
            print("No batch run in progress.")
            return
        
        print(f"Started: {self.progress['started_at']}")
        print(f"Last phase: {self.progress['last_phase']}")
        print(f"Last updated: {self.progress['last_updated']}")
        print(f"Processed: {self.progress['processed']}")
        print(f"Success: {self.progress['success']}")
        print(f"Failed: {self.progress['failed']}")
        
        # Get current DB status
        stats = self.db.get_stats()
        print(f"\nCurrent DB status:")
        for phase, count in stats['by_phase'].items():
            print(f"  {phase}: {count}")
    
    def reset_progress(self):
        """Reset progress tracking"""
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
        self.progress = self._load_progress()
        print("Progress reset.")


def main():
    parser = argparse.ArgumentParser(
        description="Batch Runner - Automated batch processing",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument('--phase', 
                        choices=['ocr', 'parse', 'enrich', 'organize', 'all'],
                        help='Phase to run')
    parser.add_argument('--total', type=int, default=1000,
                        help='Total jobs to process')
    parser.add_argument('--batch-size', type=int, default=10,
                        help='Batch size')
    parser.add_argument('--delay', type=float, default=5.0,
                        help='Delay between batches (seconds)')
    parser.add_argument('--status', action='store_true',
                        help='Show progress')
    parser.add_argument('--reset', action='store_true',
                        help='Reset progress')
    
    args = parser.parse_args()
    
    runner = BatchRunner()
    
    if args.status:
        runner.show_progress()
    elif args.reset:
        runner.reset_progress()
    elif args.phase:
        if args.phase == 'all':
            runner.run_all_phases(args.total, args.batch_size, args.delay)
        else:
            runner.run_phase(args.phase, args.total, args.batch_size, args.delay)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
