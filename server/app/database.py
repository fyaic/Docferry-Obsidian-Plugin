from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import Settings

Base = declarative_base()


def make_engine(database_url: str) -> Engine:
    kwargs: dict[str, object] = {"future": True}
    if database_url.startswith("sqlite"):
        sqlite_database = make_url(database_url).database
        if sqlite_database and sqlite_database != ":memory:":
            Path(sqlite_database).parent.mkdir(parents=True, exist_ok=True)
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in database_url:
            kwargs["poolclass"] = StaticPool
    return create_engine(database_url, **kwargs)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


def init_database(engine: Engine, settings: Settings) -> None:
    from .models import User

    Base.metadata.create_all(bind=engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        existing = session.execute(select(User).where(User.id == "usr_local")).scalar_one_or_none()
        if existing:
            return
        user = User(id="usr_local", email=None, display_name="Local developer")
        session.add(user)
        session.commit()


def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
