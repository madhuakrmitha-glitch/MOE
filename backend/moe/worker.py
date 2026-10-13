import asyncio
import logging

from .application import create_app
from .config import Settings


async def main():
    settings = Settings(worker_enabled=False)
    app = create_app(settings)
    await app.state.runner.loop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
