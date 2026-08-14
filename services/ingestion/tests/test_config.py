import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import IngestionConfig


class IngestionConfigTests(unittest.TestCase):
    def test_database_path_can_be_overridden_independently_of_runtime_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime_root = root / "runtime"
            database_path = root / "existing" / "workbench.db"

            with patch.dict(
                os.environ,
                {
                    "PERSONAL_DASHBOARD_INGESTION_RUNTIME_ROOT": str(runtime_root),
                    "PERSONAL_DASHBOARD_INGESTION_DATABASE_PATH": str(database_path),
                },
                clear=False,
            ):
                config = IngestionConfig.from_environment()

            self.assertEqual(config.database_path, database_path)
            self.assertEqual(config.runs_dir, runtime_root / "Runs")


if __name__ == "__main__":
    unittest.main()
