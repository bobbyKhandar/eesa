"""
Pipeline Database Viewer - Interactive SQLite explorer for manual pipeline

Usage:
    python db_viewer.py                    # Interactive mode
    python db_viewer.py --summary          # Quick summary
    python db_viewer.py --failed           # Show failed jobs
    python db_viewer.py --job JOB_ID       # Show specific job
    python db_viewer.py --sql "SELECT..."  # Run raw SQL
"""

import sqlite3
import argparse
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

# Database path
BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "manual_pipeline_data" / "pipeline.db"


def get_connection():
    """Get database connection"""
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        print("Run 'python manual_pipeline.py status' to initialize.")
        return None
    return sqlite3.connect(DB_PATH)


def print_table(headers, rows, max_width=None):
    """Pretty print a table"""
    if not rows:
        print("No data.")
        return
    
    # Calculate column widths
    widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            val_str = str(val) if val is not None else ""
            if max_width and len(val_str) > max_width:
                val_str = val_str[:max_width-3] + "..."
            widths[i] = max(widths[i], len(val_str))
    
    # Print header
    header_line = " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-" * len(header_line))
    
    # Print rows
    for row in rows:
        row_vals = []
        for i, val in enumerate(row):
            val_str = str(val) if val is not None else ""
            if max_width and len(val_str) > max_width:
                val_str = val_str[:max_width-3] + "..."
            row_vals.append(val_str.ljust(widths[i]))
        print(" | ".join(row_vals))


def show_summary():
    """Show database summary"""
    conn = get_connection()
    if not conn:
        return
    
    cursor = conn.cursor()
    
    print("\n" + "="*60)
    print("PIPELINE DATABASE SUMMARY")
    print("="*60)
    
    # Total jobs
    cursor.execute("SELECT COUNT(*) FROM jobs")
    total = cursor.fetchone()[0]
    print(f"\nTotal Jobs: {total}")
    
    # By phase
    print("\n--- By Phase ---")
    cursor.execute("""
        SELECT current_phase, COUNT(*) as cnt,
               SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
               SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
        FROM jobs GROUP BY current_phase ORDER BY 
        CASE current_phase
            WHEN 'upload' THEN 1
            WHEN 'ocr' THEN 2
            WHEN 'parse' THEN 3
            WHEN 'enrich' THEN 4
            WHEN 'organize' THEN 5
            WHEN 'complete' THEN 6
        END
    """)
    print_table(
        ["Phase", "Total", "Success", "Failed", "Pending"],
        cursor.fetchall()
    )
    
    # Questions/Exams
    cursor.execute("SELECT SUM(questions_count), SUM(exams_count) FROM jobs")
    row = cursor.fetchone()
    print(f"\nTotal Questions: {row[0] or 0}")
    print(f"Total Exams: {row[1] or 0}")
    
    # Recent errors
    print("\n--- Recent Errors (last 5) ---")
    cursor.execute("""
        SELECT j.filename, e.phase, e.error_type, 
               substr(e.error_message, 1, 50), e.occurred_at
        FROM error_log e
        JOIN jobs j ON e.job_id = j.job_id
        WHERE e.is_resolved = 0
        ORDER BY e.occurred_at DESC
        LIMIT 5
    """)
    print_table(
        ["Filename", "Phase", "Type", "Message", "When"],
        cursor.fetchall(),
        max_width=50
    )
    
    conn.close()
    print("\n" + "="*60)


def show_failed():
    """Show failed jobs"""
    conn = get_connection()
    if not conn:
        return
    
    cursor = conn.cursor()
    
    print("\n--- Failed Jobs ---")
    cursor.execute("""
        SELECT job_id, filename, error_phase, retry_count,
               substr(error_message, 1, 60)
        FROM jobs
        WHERE status = 'failed'
        ORDER BY updated_at DESC
    """)
    
    print_table(
        ["Job ID", "Filename", "Phase", "Retries", "Error"],
        cursor.fetchall(),
        max_width=60
    )
    
    # Count by phase
    cursor.execute("""
        SELECT error_phase, COUNT(*) 
        FROM jobs 
        WHERE status='failed' 
        GROUP BY error_phase
    """)
    rows = cursor.fetchall()
    if rows:
        print("\n--- Failures by Phase ---")
        for phase, count in rows:
            print(f"  {phase}: {count}")
    
    conn.close()


def show_job(job_id: str):
    """Show detailed job info"""
    conn = get_connection()
    if not conn:
        return
    
    cursor = conn.cursor()
    cursor.row_factory = sqlite3.Row
    
    # Find job (supports partial ID)
    cursor.execute("""
        SELECT * FROM jobs WHERE job_id LIKE ?
    """, (f"{job_id}%",))
    
    rows = cursor.fetchall()
    if not rows:
        print(f"No job found matching: {job_id}")
        return
    
    if len(rows) > 1:
        print(f"Multiple jobs match '{job_id}':")
        for row in rows:
            print(f"  {row['job_id']} - {row['filename']}")
        return
    
    job = dict(rows[0])
    
    print("\n" + "="*60)
    print("JOB DETAILS")
    print("="*60)
    
    for key, value in job.items():
        if value:
            print(f"{key}: {value}")
    
    # Get errors
    cursor.execute("""
        SELECT phase, error_type, error_message, occurred_at, retry_attempt
        FROM error_log
        WHERE job_id = ?
        ORDER BY occurred_at DESC
    """, (job['job_id'],))
    
    errors = cursor.fetchall()
    if errors:
        print("\n--- Error History ---")
        for err in errors:
            print(f"\n  [{err['retry_attempt']}] {err['phase']} @ {err['occurred_at']}")
            print(f"      Type: {err['error_type']}")
            print(f"      Message: {err['error_message'][:100]}")
    
    conn.close()


def run_sql(query: str):
    """Run raw SQL query"""
    conn = get_connection()
    if not conn:
        return
    
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        
        if query.strip().upper().startswith("SELECT"):
            headers = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            print_table(headers, rows, max_width=50)
        else:
            conn.commit()
            print(f"Rows affected: {cursor.rowcount}")
            
    except Exception as e:
        print(f"SQL Error: {e}")
    
    conn.close()


def interactive_mode():
    """Interactive database explorer"""
    conn = get_connection()
    if not conn:
        return
    
    print("\n" + "="*60)
    print("PIPELINE DATABASE EXPLORER")
    print("="*60)
    print("\nCommands:")
    print("  summary     - Show summary")
    print("  failed      - Show failed jobs")
    print("  job <id>    - Show job details")
    print("  phase <p>   - List jobs in phase")
    print("  sql <query> - Run SQL")
    print("  tables      - Show tables")
    print("  quit        - Exit")
    print()
    
    cursor = conn.cursor()
    
    while True:
        try:
            cmd = input("db> ").strip()
        except (KeyboardInterrupt, EOFError):
            break
        
        if not cmd:
            continue
        
        parts = cmd.split(None, 1)
        action = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""
        
        if action in ('quit', 'exit', 'q'):
            break
        elif action == 'summary':
            show_summary()
        elif action == 'failed':
            show_failed()
        elif action == 'job' and arg:
            show_job(arg)
        elif action == 'phase' and arg:
            cursor.execute("""
                SELECT job_id, filename, status, error_message
                FROM jobs WHERE current_phase = ?
                ORDER BY created_at DESC LIMIT 20
            """, (arg,))
            print_table(
                ["Job ID", "Filename", "Status", "Error"],
                cursor.fetchall(),
                max_width=40
            )
        elif action == 'sql' and arg:
            run_sql(arg)
        elif action == 'tables':
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            for row in cursor.fetchall():
                print(f"  {row[0]}")
                cursor.execute(f"PRAGMA table_info({row[0]})")
                for col in cursor.fetchall():
                    print(f"    - {col[1]} ({col[2]})")
        else:
            print(f"Unknown command: {action}")
    
    conn.close()
    print("\nGoodbye!")


def main():
    parser = argparse.ArgumentParser(description="Pipeline Database Viewer")
    parser.add_argument('--summary', action='store_true', help='Show summary')
    parser.add_argument('--failed', action='store_true', help='Show failed jobs')
    parser.add_argument('--job', help='Show specific job by ID')
    parser.add_argument('--sql', help='Run raw SQL query')
    
    args = parser.parse_args()
    
    if args.summary:
        show_summary()
    elif args.failed:
        show_failed()
    elif args.job:
        show_job(args.job)
    elif args.sql:
        run_sql(args.sql)
    else:
        interactive_mode()


if __name__ == '__main__':
    main()
