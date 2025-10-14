import unittest

class TestStringMethods(unittest.TestCase):

    # 1. Positive test for equality
    def test_positive_equal(self):
        text = "I have done unit testing"
        self.assertEqual(text, "I have done unit testing")

    # 2. Negative test for equality
    def test_negative_equal(self):
        text = "I have done unit testing"
        self.assertNotEqual(text, "I have not done unit testing")

    # 3. Test for string uppercase conversion
    def test_uppercase(self):
        self.assertEqual("python".upper(), "PYTHON")

    # 4. Test for lowercase conversion
    def test_lowercase(self):
        self.assertEqual("PYTHON".lower(), "python")

    # 5. Test if string starts with specific word
    def test_startswith(self):
        self.assertTrue("unit testing is important".startswith("unit"))

    # 6. Test if string ends with specific word
    def test_endswith(self):
        self.assertTrue("learn pytest".endswith("pytest"))

    # 7. Test for substring presence
    def test_contains(self):
        self.assertIn("test", "unit test cases")

    # 8. Test for substring absence
    def test_not_contains(self):
        self.assertNotIn("java", "python unit testing")

    # 9. Test string length
    def test_length(self):
        self.assertEqual(len("unit"), 4)

    # 10. Test split function
    def test_split(self):
        self.assertEqual("a b c".split(), ["a", "b", "c"])

if __name__ == '__main__':
    unittest.main()