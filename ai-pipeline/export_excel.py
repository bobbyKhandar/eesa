import os
import json5
import pandas as pd
from pathlib import Path

# === CONFIG ===
INPUT_ROOT = Path("C:/project/miniproject/outputs/bloomsAnatomyFinal")  # your actual input folder
OUTPUT_ROOT = Path("C:/project/miniproject/outputs/excel_exports")  # change if needed
SKIP_LOG = OUTPUT_ROOT / "skipped_files.log"

# === JSON5 PARSER ===
def parse_question_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json5.load(f)

        rows = []

        if isinstance(data, dict):
            for subject, q_str in data.items():
                try:
                    questions = json5.loads(q_str)
                    for q in questions:
                        if isinstance(q, dict) and "question" in q and "level" in q:
                            rows.append({
                                "question": str(q["question"]).strip(),
                                "subject": subject.strip(),
                                "level": str(q["level"]).strip()
                            })
                except Exception as inner_e:
                    log_error(file_path, f"Nested parse failed: {inner_e}")
        elif isinstance(data, list):
            for q in data:
                if isinstance(q, dict) and "question" in q and "level" in q:
                    rows.append({
                        "question": str(q["question"]).strip(),
                        "subject": "Unknown",
                        "level": str(q["level"]).strip()
                    })

        return rows

    except Exception as e:
        log_error(file_path, f"Top-level parse failed: {e}")
        return []

def log_error(file_path, error_msg):
    with open(SKIP_LOG, "a", encoding="utf-8") as f:
        f.write(f"⚠️ Skipped: {file_path} → {error_msg}\n")

def collect_branch_data(branch_dir):
    all_rows = []
    for file in branch_dir.glob("*.txt"):
        all_rows.extend(parse_question_file(file))
    for file in branch_dir.glob("*.json"):
        all_rows.extend(parse_question_file(file))
    return all_rows

def export_to_excel(branch_name, rows):
    if not rows:
        print(f"⚠️ No valid data for branch: {branch_name}")
        return
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    safe_name = branch_name.replace(":", "_").replace("/", "_").replace("\\", "_")
    out_path = OUTPUT_ROOT / f"{safe_name}.xlsx"
    df.to_excel(out_path, index=False)
    print(f"✅ Exported {branch_name} → {out_path}")

def main():
    if not INPUT_ROOT.exists():
        raise FileNotFoundError(f"❌ Input path not found: {INPUT_ROOT}")
    for branch_dir in INPUT_ROOT.iterdir():
        if branch_dir.is_dir():
            print(f"\n🔁 Processing branch: {branch_dir.name}")
            data = collect_branch_data(branch_dir)
            export_to_excel(branch_dir.name, data)

if __name__ == "__main__":
    main()
