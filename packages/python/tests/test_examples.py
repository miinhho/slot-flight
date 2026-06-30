import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"


class ExampleTest(unittest.TestCase):
    def test_example_filenames_do_not_shadow_imported_packages(self):
        package_names = {"langchain", "openai", "pydantic", "slot_flight"}
        example_names = {path.stem for path in EXAMPLES.glob("*.py")}

        self.assertFalse(example_names & package_names)

    def test_examples_import_without_running_remote_calls(self):
        for path in sorted(EXAMPLES.glob("*.py")):
            with self.subTest(example=path.name):
                _import_example(path)


def _import_example(path: Path) -> None:
    name = f"_slot_flight_example_{path.stem}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Could not load example module: {path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        del sys.modules[name]


if __name__ == "__main__":
    unittest.main()
