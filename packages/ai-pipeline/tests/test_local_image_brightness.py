"""Local OCR brightness correction must move images toward the target.

The gamma lookup table applied the reciprocal of the derived gamma, so already
dark pages were darkened and already-bright pages were brightened. These tests
lock the correction direction, the closeness to target, and the endpoint guards.
"""

import importlib.util
import os
import sys
import types
import unittest

import numpy as np

_SRC = os.path.join(os.path.dirname(__file__), "..", "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)


def _load_module(name, filename):
    path = os.path.join(_SRC, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _stub_cv2():
    """Minimal cv2 stand-in so tests run without the heavy local OCR extras."""
    module = types.ModuleType("cv2")
    module.COLOR_BGR2GRAY = 6
    module.CV_64F = 7
    module.INTER_AREA = 3
    module.INTER_CUBIC = 2
    module.BORDER_CONSTANT = 0
    module.THRESH_BINARY = 0
    module.THRESH_OTSU = 8

    def cvtColor(image, code):
        if code != module.COLOR_BGR2GRAY or len(image.shape) != 3:
            return image
        b, g, r = image[:, :, 0], image[:, :, 1], image[:, :, 2]
        return (0.114 * b + 0.587 * g + 0.299 * r).astype(np.uint8)

    def Laplacian(image, ddepth):
        img = image.astype(np.float64)
        neighbors = (
            np.roll(img, 1, axis=0) + np.roll(img, -1, axis=0)
            + np.roll(img, 1, axis=1) + np.roll(img, -1, axis=1)
        )
        return 4 * img - neighbors

    def LUT(source, lut):
        return np.asarray(lut)[np.asarray(source)]

    module.cvtColor = cvtColor
    module.Laplacian = Laplacian
    module.LUT = LUT
    module.Canny = lambda *args, **kwargs: None
    module.HoughLines = lambda *args, **kwargs: None
    module.bilateralFilter = lambda img, *a, **k: img
    module.GaussianBlur = lambda img, *a, **k: img
    module.addWeighted = lambda *sources, **k: sources[0]
    module.resize = lambda img, size, *a, **k: np.repeat(
        np.repeat(img, max(1, size[1] // img.shape[0]), axis=0),
        max(1, size[0] // img.shape[1]), axis=1,
    )
    module.warpAffine = lambda img, *a, **k: img
    module.getRotationMatrix2D = lambda *a, **k: np.eye(2, 3, dtype=np.float32)
    module.threshold = lambda img, *a, **k: (0, img)
    module.findContours = lambda img, *a, **k: ([], None)
    module.bitwise_not = lambda img: 255 - img
    module.createCLAHE = lambda **k: types.SimpleNamespace(apply=lambda img: img)
    return module


if importlib.util.find_spec("cv2") is None:
    sys.modules["cv2"] = _stub_cv2()

image_processor_pipeline = _load_module(
    "local_image_processor_pipeline", "local_image_processor_pipeline.py"
)
ImageProcessor = image_processor_pipeline.ImageProcessor

# Images at least 600px wide skip the resizing phase and stay untouched by it.
DARKNESS = 40.0
BRIGHTNESS = 220.0
TARGET = 127


def _uniform(value):
    return np.full((700, 600), value, dtype=np.uint8)


def _document_image(background, ink, ink_fraction):
    """A page-sized scan: light/dark background with dark/light text rows."""
    image = np.full((700, 600), background, dtype=np.uint8)
    ink_width = int(600 * ink_fraction)
    image[:, :ink_width] = ink
    return image


class TestBrightnessCorrectionDirection(unittest.TestCase):
    """The correction must counter the detected exposure problem."""

    def setUp(self):
        self.processor = ImageProcessor()

    def test_dark_uniform_image_is_brightened(self):
        before = _uniform(DARKNESS).mean()
        result = self.processor._adjust_brightness(_uniform(DARKNESS), target=TARGET)
        after = result.mean()

        self.assertGreater(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))

    def test_bright_uniform_image_is_darkened(self):
        before = _uniform(BRIGHTNESS).mean()
        result = self.processor._adjust_brightness(_uniform(BRIGHTNESS), target=TARGET)
        after = result.mean()

        self.assertLess(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))

    def test_dark_document_moves_toward_target(self):
        dark_page = _document_image(background=70, ink=20, ink_fraction=0.5)
        before = dark_page.mean()

        result = self.processor._adjust_brightness(dark_page, target=TARGET)
        after = result.mean()

        self.assertGreater(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))

    def test_bright_document_moves_toward_target(self):
        bright_page = _document_image(background=250, ink=30, ink_fraction=0.2)
        before = bright_page.mean()

        result = self.processor._adjust_brightness(bright_page, target=TARGET)
        after = result.mean()

        self.assertLess(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))


class TestBrightnessEndpointGuards(unittest.TestCase):
    """Endpoint means must not run through the logarithmic gamma derivation."""

    def setUp(self):
        self.processor = ImageProcessor()

    def test_black_image_is_unchanged(self):
        black = np.zeros((700, 600), dtype=np.uint8)

        result = self.processor._adjust_brightness(black, target=TARGET)

        np.testing.assert_array_equal(result, black)

    def test_white_image_is_unchanged(self):
        white = np.full((700, 600), 255, dtype=np.uint8)

        result = self.processor._adjust_brightness(white, target=TARGET)

        np.testing.assert_array_equal(result, white)

    def test_near_black_image_is_unchanged(self):
        near_black = np.zeros((700, 600), dtype=np.uint8)
        near_black[0, 0] = 50  # mean 50/420000 < 1

        result = self.processor._adjust_brightness(near_black, target=TARGET)

        np.testing.assert_array_equal(result, near_black)


class TestPreprocessBrightnessCorrection(unittest.TestCase):
    """The auto-detected path must also move images toward the target."""

    def setUp(self):
        self.processor = ImageProcessor()

    def _corrected_mean(self, image):
        result = self.processor.preprocess_image(image)
        self.assertIn("brightness_correction", self.processor.last_applied_steps)
        return result.mean()

    def test_preprocess_brightens_dark_image(self):
        before = _document_image(background=70, ink=20, ink_fraction=0.5).mean()

        after = self._corrected_mean(_document_image(background=70, ink=20, ink_fraction=0.5))

        self.assertGreater(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))

    def test_preprocess_darkens_bright_image(self):
        before = _document_image(background=250, ink=30, ink_fraction=0.2).mean()

        after = self._corrected_mean(_document_image(background=250, ink=30, ink_fraction=0.2))

        self.assertLess(after, before)
        self.assertLess(abs(after - TARGET), abs(before - TARGET))


if __name__ == "__main__":
    unittest.main(verbosity=2)
