"""Enrichment must keep continuation markers so exams merge across chunks."""

import importlib.util
import os
import unittest


def _load_chunk_merger():
    """Load the merger without importing src/__init__.py (that pulls in cv2)."""
    module_path = os.path.join(os.path.dirname(__file__), "..", "src", "chunk_merger.py")
    spec = importlib.util.spec_from_file_location("chunk_merger", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load chunk merger from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_chunk_merger = _load_chunk_merger()
build_enriched_chunk = _chunk_merger.build_enriched_chunk
merge_chunk_exams = _chunk_merger.merge_chunk_exams
merge_chunks = _chunk_merger.merge_chunks


def _question(number, text):
    return {
        "question_number": number,
        "question_text": text,
        "questionType": "text",
        "marks": "10",
    }


def _parsed_chunk(chunk_id, questions, *, continuation, start_question, subject, subjects):
    """Shape a parsed chunk the way parsing_pipeline actually writes it.

    Continuation lives under ``chunk_metadata``. There is no top-level
    ``is_continuation`` and no ``metadata`` key.
    """
    return {
        "chunk_id": chunk_id,
        "parsing_cost": 0.01,
        "chunk_metadata": {
            "text": "raw ocr text that enrichment does not need to re-store",
            "chunk_id": chunk_id,
            "start_question": start_question,
            "end_question": start_question + len(questions) - 1,
            "is_continuation": continuation,
            "has_metadata": chunk_id == 0,
            "char_count": 120,
            "boundaries": [{"question_number": start_question}],
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


class TestMergeAcrossChunkBoundary(unittest.TestCase):
    def test_merges_exam_that_spans_a_chunk_boundary(self):
        base = _parsed_chunk(
            0,
            [
                _question("Q1", "What is an operating system?"),
                _question("Q2", "Explain the difference between a process and a thread."),
            ],
            continuation=False,
            start_question=1,
            subject="Operating Systems",
            subjects=["Operating Systems"],
        )
        continuation = _parsed_chunk(
            1,
            [
                _question("Q3", "What is deadlock?"),
                _question("Q4", "Explain CPU scheduling."),
            ],
            continuation=True,
            start_question=3,
            subject="",
            subjects=[],
        )

        enriched = [
            build_enriched_chunk(base, base["exams"], 0),
            build_enriched_chunk(continuation, continuation["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        self.assertEqual(len(merged["exams"]), 1)
        exam = merged["exams"][0]
        self.assertEqual(exam["subject"], "Operating Systems")
        self.assertEqual(
            [question["question_number"] for question in exam["questions"]],
            ["Q1", "Q2", "Q3", "Q4"],
        )
        self.assertIn("Operating Systems", merged["subjectsCreated"])
        self.assertTrue(enriched[1]["is_continuation"])
        self.assertEqual(enriched[1]["starts_at_question"], 3)
        self.assertTrue(enriched[1]["chunk_metadata"]["is_continuation"])
        self.assertNotIn("text", enriched[1]["chunk_metadata"])
        self.assertNotIn("boundaries", enriched[1]["chunk_metadata"])
        self.assertNotIn("metadata", enriched[1])

    def test_keeps_separate_exams_when_chunk_metadata_is_not_a_continuation(self):
        first = _parsed_chunk(
            0,
            [_question("Q1", "Define a process.")],
            continuation=False,
            start_question=1,
            subject="Operating Systems",
            subjects=["Operating Systems"],
        )
        second = _parsed_chunk(
            1,
            [_question("Q1", "Define a relation.")],
            continuation=False,
            start_question=1,
            subject="Database Management Systems",
            subjects=["Database Management Systems"],
        )
        # The wrong key must not be treated as a continuation marker.
        second["metadata"] = {"is_continuation": True, "starts_at_question": 2}

        enriched = [
            build_enriched_chunk(first, first["exams"], 0),
            build_enriched_chunk(second, second["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        self.assertFalse(enriched[1]["is_continuation"])
        self.assertEqual(len(merged["exams"]), 2)
        self.assertEqual(
            [exam["subject"] for exam in merged["exams"]],
            ["Operating Systems", "Database Management Systems"],
        )

    def test_uses_parsed_continuation_when_chunk_metadata_omits_the_flag(self):
        base = _parsed_chunk(
            0,
            [_question("Q1", "What is an operating system?")],
            continuation=False,
            start_question=1,
            subject="Operating Systems",
            subjects=["Operating Systems"],
        )
        continuation = _parsed_chunk(
            1,
            [_question("Q2", "Explain scheduling.")],
            continuation=False,
            start_question=2,
            subject="",
            subjects=[],
        )
        del continuation["chunk_metadata"]["is_continuation"]
        del continuation["chunk_metadata"]["start_question"]
        continuation["is_continuation"] = True
        continuation["starts_at_question"] = 2

        enriched = [
            build_enriched_chunk(base, base["exams"], 0),
            build_enriched_chunk(continuation, continuation["exams"], 1),
        ]
        merged = merge_chunks(enriched)

        self.assertTrue(enriched[1]["is_continuation"])
        self.assertEqual(enriched[1]["starts_at_question"], 2)
        self.assertEqual(len(merged["exams"]), 1)
        self.assertEqual(
            [question["question_number"] for question in merged["exams"][0]["questions"]],
            ["Q1", "Q2"],
        )


class TestMergeChunkExams(unittest.TestCase):
    """Chunk payloads merge only after every chunk parsed.

    A continuation payload continues the exam already collected, a question
    the boundary split is merged once, and extra exams inside a payload
    stay separate so no parsed question is dropped.
    """

    def test_continuation_payload_joins_the_exam_already_collected(self):
        base = {
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q1", "What is an operating system?")],
            }],
            "subjectsCreated": ["Operating Systems"],
        }
        continuation = {
            "is_continuation": True,
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q2", "Explain CPU scheduling.")],
            }],
        }

        merged = merge_chunk_exams([base, continuation])

        self.assertEqual(len(merged["exams"]), 1)
        self.assertEqual(
            [question["question_number"] for question in merged["exams"][0]["questions"]],
            ["Q1", "Q2"],
        )
        self.assertEqual(merged["subjectsCreated"], ["Operating Systems"])

    def test_boundary_split_question_is_merged_once(self):
        base = {
            "exams": [{
                "subject": "Operating Systems",
                "questions": [
                    _question("Q1", "What is an operating system?"),
                    _question("Q2", "Explain CPU scheduling and its"),
                ],
            }]
        }
        continuation = {
            "is_continuation": True,
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q2", "common algorithms.")],
            }],
        }

        merged = merge_chunk_exams([base, continuation])

        questions = merged["exams"][0]["questions"]
        self.assertEqual(len(questions), 2)
        self.assertEqual(
            questions[1]["question_text"],
            "Explain CPU scheduling and its common algorithms.",
        )

    def test_second_exam_inside_a_continuation_payload_is_kept(self):
        base = {
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q1", "What is an operating system?")],
            }]
        }
        continuation = {
            "is_continuation": True,
            "exams": [
                {
                    "subject": "Operating Systems",
                    "questions": [_question("Q2", "Explain CPU scheduling.")],
                },
                {
                    "subject": "Database Management Systems",
                    "questions": [_question("Q1", "Define normalization.")],
                },
            ],
        }

        merged = merge_chunk_exams([base, continuation])

        self.assertEqual(
            [exam["subject"] for exam in merged["exams"]],
            ["Operating Systems", "Database Management Systems"],
        )
        self.assertEqual(
            [len(exam["questions"]) for exam in merged["exams"]], [2, 1]
        )

    def test_continuation_flag_from_chunk_metadata_is_honored(self):
        base = {
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q1", "What is an operating system?")],
            }]
        }
        continuation = {
            "chunk_metadata": {"is_continuation": True, "start_question": 2},
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q2", "Explain CPU scheduling.")],
            }],
        }

        merged = merge_chunk_exams([base, continuation])

        self.assertEqual(len(merged["exams"]), 1)
        self.assertEqual(
            [question["question_number"] for question in merged["exams"][0]["questions"]],
            ["Q1", "Q2"],
        )

    def test_different_subject_starts_a_new_exam(self):
        base = {
            "exams": [{
                "subject": "Operating Systems",
                "questions": [_question("Q1", "What is an operating system?")],
            }]
        }
        continuation = {
            "is_continuation": True,
            "exams": [{
                "subject": "Database Management Systems",
                "questions": [_question("Q1", "Define normalization.")],
            }],
        }

        merged = merge_chunk_exams([base, continuation])

        self.assertEqual(
            [exam["subject"] for exam in merged["exams"]],
            ["Operating Systems", "Database Management Systems"],
        )


if __name__ == "__main__":
    unittest.main()
