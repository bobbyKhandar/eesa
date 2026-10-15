"""Chunk merging must preserve distinct OR alternative questions.

Parsing emits each OR choice as a distinct object with question_number
"OR". The merger must not collapse them by number alone: deduplication
is allowed only for proven overlaps (same number plus matching or
overlapping content), and preservation counts are validated.
"""

import importlib.util
import os
import unittest


def _load_chunk_merger():
    """Load the merger without importing src/__init__.py (that pulls in cv2)."""
    module_path = os.path.join(os.path.dirname(__file__), "..", "src", "chunk_merger.py")
    spec = importlib.util.spec_from_file_location("chunk_merger_or_test", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load chunk merger from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_chunk_merger = _load_chunk_merger()
build_enriched_chunk = _chunk_merger.build_enriched_chunk
merge_chunk_exams = _chunk_merger.merge_chunk_exams
merge_chunks = _chunk_merger.merge_chunks
validate_merge_result = _chunk_merger.validate_merge_result


def _question(number, text):
    return {
        "question_number": number,
        "question_text": text,
        "questionType": "text",
        "marks": "10",
    }


def _parsed_chunk(chunk_id, questions, *, continuation, subject, subjects):
    return {
        "chunk_id": chunk_id,
        "parsing_cost": 0.01,
        "chunk_metadata": {
            "chunk_id": chunk_id,
            "is_continuation": continuation,
            "has_metadata": chunk_id == 0,
            "char_count": 120,
        },
        "exams": [
            {
                "subject": subject,
                "max_marks": "100",
                "year": "2023",
                "semester": "V",
                "branch": "IT",
                "examType": "main",
                "questions": questions,
            }
        ],
        "subjectsCreated": subjects,
    }


class TestOrPreservationAcrossChunks(unittest.TestCase):
    def test_preserves_multiple_or_blocks_across_a_continuation_boundary(self):
        base = _parsed_chunk(
            0,
            [
                _question("Q1", "What is inertia?"),
                _question("OR", "Explain momentum in detail with examples."),
                _question("OR", "Explain energy conservation in detail."),
            ],
            continuation=False,
            subject="Physics",
            subjects=["Physics"],
        )
        continuation = _parsed_chunk(
            1,
            [
                _question("OR", "Describe rotational motion with diagrams."),
                _question("OR", "Describe gravitation and Kepler laws."),
                _question("Q2", "Define force."),
            ],
            continuation=True,
            subject="",
            subjects=[],
        )
        enriched = [
            build_enriched_chunk(base, base["exams"], 0),
            build_enriched_chunk(continuation, continuation["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        self.assertEqual(len(merged["exams"]), 1)
        questions = merged["exams"][0]["questions"]
        self.assertEqual(len(questions), 6)
        self.assertEqual(
            [q["question_number"] for q in questions],
            ["Q1", "OR", "OR", "OR", "OR", "Q2"],
        )
        stats = merged["merge_stats"]
        self.assertEqual(stats["input_or_alternatives"], 4)
        self.assertEqual(stats["output_or_alternatives"], 4)
        self.assertEqual(stats["input_questions"], stats["output_questions"])
        validation = validate_merge_result(merged)
        self.assertTrue(validation["valid"], validation["warnings"])

    def test_preserves_or_alternatives_within_one_exam(self):
        chunk = _parsed_chunk(
            0,
            [
                _question("Q1", "What is inertia?"),
                _question("OR", "First alternative for the Q2 OR block."),
                _question("OR", "Second alternative for the Q2 OR block."),
                _question("Q3", "Define force."),
                _question("OR", "First alternative for the Q4 OR block."),
                _question("OR", "Second alternative for the Q4 OR block."),
            ],
            continuation=False,
            subject="Physics",
            subjects=["Physics"],
        )
        other = _parsed_chunk(
            1,
            [_question("Q5", "State Newton laws.")],
            continuation=False,
            subject="Chemistry",
            subjects=["Chemistry"],
        )
        enriched = [
            build_enriched_chunk(chunk, chunk["exams"], 0),
            build_enriched_chunk(other, other["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        first_exam = next(
            exam for exam in merged["exams"] if exam["subject"] == "Physics"
        )
        self.assertEqual(len(first_exam["questions"]), 6)
        self.assertEqual(
            [q["question_number"] for q in first_exam["questions"]],
            ["Q1", "OR", "OR", "Q3", "OR", "OR"],
        )

    def test_preserves_distinct_questions_sharing_a_display_number(self):
        chunk = _parsed_chunk(
            0,
            [
                _question("Q1", "First distinct question about inertia?"),
                _question("Q1", "Second distinct question about momentum?"),
            ],
            continuation=False,
            subject="Physics",
            subjects=["Physics"],
        )
        other = _parsed_chunk(
            1,
            [_question("Q2", "Third question about force.")],
            continuation=False,
            subject="Chemistry",
            subjects=["Chemistry"],
        )
        enriched = [
            build_enriched_chunk(chunk, chunk["exams"], 0),
            build_enriched_chunk(other, other["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        physics = next(
            exam for exam in merged["exams"] if exam["subject"] == "Physics"
        )
        self.assertEqual(len(physics["questions"]), 2)
        self.assertEqual(
            [q["question_text"] for q in physics["questions"]],
            [
                "First distinct question about inertia?",
                "Second distinct question about momentum?",
            ],
        )

    def test_deduplicates_only_proven_exact_overlaps(self):
        base = _parsed_chunk(
            0,
            [_question("Q1", "What is an operating system in detail?")],
            continuation=False,
            subject="Operating Systems",
            subjects=["Operating Systems"],
        )
        continuation = _parsed_chunk(
            1,
            [
                _question("Q1", "What is an operating system in detail?"),
                _question("Q2", "Explain CPU scheduling."),
            ],
            continuation=True,
            subject="",
            subjects=[],
        )
        enriched = [
            build_enriched_chunk(base, base["exams"], 0),
            build_enriched_chunk(continuation, continuation["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        questions = merged["exams"][0]["questions"]
        self.assertEqual(
            [q["question_number"] for q in questions], ["Q1", "Q2"]
        )
        self.assertEqual(
            questions[0]["question_text"],
            "What is an operating system in detail?",
        )

    def test_split_question_across_boundary_still_merges_once(self):
        base = _parsed_chunk(
            0,
            [
                _question("Q1", "What is an operating system?"),
                _question("Q2", "Explain CPU scheduling and its"),
            ],
            continuation=False,
            subject="Operating Systems",
            subjects=["Operating Systems"],
        )
        continuation = _parsed_chunk(
            1,
            [_question("Q2", "common algorithms.")],
            continuation=True,
            subject="",
            subjects=[],
        )
        enriched = [
            build_enriched_chunk(base, base["exams"], 0),
            build_enriched_chunk(continuation, continuation["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        questions = merged["exams"][0]["questions"]
        self.assertEqual(len(questions), 2)
        self.assertEqual(
            questions[1]["question_text"],
            "Explain CPU scheduling and its common algorithms.",
        )


class TestOrPreservationInChunkExams(unittest.TestCase):
    def test_distinct_or_at_continuation_boundary_stays_separate(self):
        base = {
            "exams": [{
                "subject": "Physics",
                "questions": [
                    _question("Q1", "What is inertia?"),
                    _question("OR", "First alternative about momentum."),
                ],
            }],
            "subjectsCreated": ["Physics"],
        }
        continuation = {
            "is_continuation": True,
            "exams": [{
                "subject": "Physics",
                "questions": [
                    _question("OR", "Second alternative about energy."),
                    _question("Q2", "Define force."),
                ],
            }],
        }

        merged = merge_chunk_exams([base, continuation])

        self.assertEqual(len(merged["exams"]), 1)
        questions = merged["exams"][0]["questions"]
        self.assertEqual(len(questions), 4)
        self.assertEqual(
            [q["question_number"] for q in questions],
            ["Q1", "OR", "OR", "Q2"],
        )
        stats = merged["merge_stats"]
        self.assertEqual(stats["input_or_alternatives"], 2)
        self.assertEqual(stats["output_or_alternatives"], 2)

    def test_validation_flags_a_dropped_or_alternative(self):
        result = {
            "exams": [{
                "subject": "Physics",
                "questions": [_question("OR", "Only one kept.")],
            }],
            "subjectsCreated": ["Physics"],
            "merge_stats": {
                "input_questions": 3,
                "output_questions": 1,
                "duplicates_removed": 0,
                "boundary_merges": 0,
                "input_or_alternatives": 2,
                "output_or_alternatives": 1,
            },
        }

        validation = validate_merge_result(result)

        self.assertFalse(validation["valid"])
        self.assertTrue(
            any("OR" in warning for warning in validation["warnings"]),
            validation["warnings"],
        )


if __name__ == "__main__":
    unittest.main()
