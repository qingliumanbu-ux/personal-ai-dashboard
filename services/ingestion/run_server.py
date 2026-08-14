from app.config import IngestionConfig
from app.main import create_app
import os
import uvicorn


def main() -> None:
    config = IngestionConfig.from_environment()
    uvicorn.run(
        create_app(
            config,
            start_worker=os.environ.get(
                "PERSONAL_DASHBOARD_INGESTION_START_WORKER",
                "true",
            ).lower() != "false",
        ),
        host=config.host,
        port=config.port,
        access_log=False,
    )


if __name__ == "__main__":
    main()
