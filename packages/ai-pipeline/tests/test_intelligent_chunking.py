"""OCR chunking must honor the configured character maximum.

Question boundaries are the preferred split. When a document has none, or one
section is longer than the maximum, the chunker falls back to paragraph
breaks, then line breaks, then a hard character cut. Every piece stays within
the max. Continuation pieces keep ``is_continuation`` on the chunk dict that
parsing stores as ``chunk_metadata`` (#60), and each piece keeps a distinct
``chunk_id`` so ``failed_chunks`` can name it (#61).
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from intelligent_chunking import chunk_ocr_text


def _joined(chunks):
    return "".join(chunk["text"] for chunk in chunks)


class TestOcrChunkMaxSize(unittest.TestCase):
    def assert_within_max(self, chunks, limit, source):
        self.assertGreaterEqual(len(chunks), 1)
        self.assertEqual(_joined(chunks), source)
        self.assertEqual(
            [chunk["chunk_id"] for chunk in chunks],
            list(range(len(chunks))),
        )
        for chunk in chunks:
            self.assertLessEqual(chunk["char_count"], limit)
            self.assertEqual(chunk["char_count"], len(chunk["text"]))
            self.assertIn("is_continuation", chunk)
            self.assertIsInstance(chunk["is_continuation"], bool)
            self.assertNotIn("_fallback_continuation", chunk)
            if source:
                self.assertTrue(chunk["text"])

    def test_no_boundaries_splits_and_marks_continuations(self):
        limit = 40
        first = "Intro paragraph about the course."
        second = "Second paragraph continues the notes."
        third = "Z" * 90
        source = f"{first}\n\n{second}\n\n{third}"

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertGreater(len(chunks), 1)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(all(chunk["is_continuation"] for chunk in chunks[1:]))
        self.assertTrue(all(chunk["start_question"] is None for chunk in chunks))
        self.assertTrue(all(chunk["end_question"] is None for chunk in chunks))
        self.assertTrue(all(chunk["has_metadata"] is False for chunk in chunks))
        self.assertTrue(
            all(chunk.get("warning") == "No question boundaries detected" for chunk in chunks)
        )
        self.assertNotIn("single_chunk", chunks[0])

    def test_paragraph_break_is_preferred_over_cutting_a_paragraph(self):
        limit = 40
        first = "A" * 30
        second = "B" * 30
        source = f"{first}\n\n{second}"

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertEqual(chunks[0]["text"], f"{first}\n\n")
        self.assertEqual(chunks[1]["text"], second)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(chunks[1]["is_continuation"])

    def test_overlong_paragraph_splits_on_lines(self):
        limit = 50
        lines = ["L" * 20, "M" * 20, "N" * 20]
        source = "\n".join(lines)

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertEqual(chunks[0]["text"], "L" * 20 + "\n" + "M" * 20 + "\n")
        self.assertEqual(chunks[1]["text"], "N" * 20)

    def test_overlong_line_is_hard_split_on_characters(self):
        limit = 40
        source = "Z" * 100

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertEqual([chunk["text"] for chunk in chunks], ["Z" * 40, "Z" * 40, "Z" * 20])

    def test_overlong_question_is_split_without_dropping_continuation_metadata(self):
        limit = 80
        question = "Question 1: " + ("alpha beta\n\n" * 12) + ("Q" * 200)
        source = question + "\nQuestion 2: tail\n"

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertGreater(len(source), limit)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertEqual(chunks[0]["start_question"], 1)
        self.assertTrue(chunks[0]["has_metadata"])
        self.assertTrue(any(chunk["is_continuation"] for chunk in chunks[1:]))
        for chunk in chunks:
            self.assertEqual(chunk["start_question"], 1)
            self.assertIn("end_question", chunk)
        for chunk in chunks[1:]:
            self.assertTrue(chunk["is_continuation"])
            self.assertFalse(chunk["has_metadata"])

    def test_overlong_middle_question_stays_a_continuation_of_the_exam(self):
        limit = 100
        first = "Question 1: short answer here\n"
        middle = "Question 2: " + ("para words here.\n\n" * 8) + ("Y" * 180) + "\n"
        last = "Question 3: tail of the paper\n"
        source = first + middle + last

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertGreater(len(chunks), 2)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(chunks[0]["has_metadata"])
        self.assertEqual(chunks[0]["start_question"], 1)
        self.assertTrue(all(chunk["is_continuation"] for chunk in chunks[1:]))
        self.assertTrue(all(chunk["has_metadata"] is False for chunk in chunks[1:]))
        self.assertIn("Question 1:", chunks[0]["text"])
        self.assertTrue(any("Question 2:" in chunk["text"] for chunk in chunks))
        self.assertTrue(any("Question 3:" in chunk["text"] for chunk in chunks))
        self.assertNotIn("warning", chunks[0])

    def test_sections_that_fit_still_split_on_question_boundaries(self):
        def question(number, body):
            return f"Question {number}: {body}\n"

        parts = [question(number, character * 20) for number, character in enumerate("abcd", start=1)]
        source = "".join(parts)
        limit = 70

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assert_within_max(chunks, limit, source)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["text"], parts[0] + parts[1])
        self.assertEqual(chunks[1]["text"], parts[2] + parts[3])
        # The boundary at the cut stays on the earlier chunk, which is the
        # existing grouping result when every section fits in the maximum.
        self.assertEqual(chunks[0]["start_question"], 1)
        self.assertEqual(chunks[0]["end_question"], 3)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(chunks[0]["has_metadata"])
        self.assertEqual(chunks[1]["start_question"], 4)
        self.assertEqual(chunks[1]["end_question"], 4)
        self.assertTrue(chunks[1]["is_continuation"])
        self.assertFalse(chunks[1]["has_metadata"])
        self.assertNotIn("warning", chunks[0])

    def test_configured_20000_maximum_is_enforced_for_unstructured_ocr(self):
        limit = 20000
        source = "plain text " * 4000

        chunks = chunk_ocr_text(source, max_chars_per_chunk=limit)

        self.assertGreater(len(source), limit)
        self.assert_within_max(chunks, limit, source)
        self.assertGreater(len(chunks), 1)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(chunks[1]["is_continuation"])

    def test_text_within_the_maximum_stays_a_single_chunk(self):
        source = "Question 1: short enough to parse together\n"
        chunks = chunk_ocr_text(source, max_chars_per_chunk=20000)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["text"], source)
        self.assertFalse(chunks[0]["is_continuation"])
        self.assertTrue(chunks[0]["single_chunk"])
        self.assertEqual(chunks[0]["char_count"], len(source))
