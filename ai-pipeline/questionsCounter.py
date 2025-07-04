import os
import json5

def count_questions_in_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json5.load(f)
            if isinstance(data, list):
                return len([item for item in data if isinstance(item, dict) and 'question' in item])
    except Exception as e:
        print(f"Error in {file_path}: {e}")
    return 0

def count_all_questions(root_dir):
    total_questions = 0
    for subdir, _, files in os.walk(root_dir):
        for file in files:
            if file.endswith(".json") or file.endswith(".txt"):
                file_path = os.path.join(subdir, file)
                total_questions += count_questions_in_file(file_path)
    return total_questions

if __name__ == "__main__":
    base_dir = "C:/project/miniproject/questionPapers"  # Change this to your root folder
    total = count_all_questions(base_dir)
    print(f"\nTotal questions found: {total}")
