from __future__ import annotations

import argparse

from app.config import Settings
from app.database import make_engine, make_session_factory
from app.models import User, UserToken, utc_now
from app.security import generate_prefixed_id, hash_cloud_token, make_cloud_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue a DocFerry Cloud token.")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--label", default=None)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    settings = Settings.from_env()
    active_share_limit = args.limit if args.limit is not None else settings.default_active_share_limit
    token = make_cloud_token()
    token_hash = hash_cloud_token(token, settings)
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    now = utc_now()

    with session_factory() as session:
        user = session.get(User, args.user_id)
        if not user:
            user = User(id=args.user_id, email=None, display_name=args.user_id, created_at=now, updated_at=now)
            session.add(user)
        user_token = UserToken(
            id=generate_prefixed_id("tok"),
            user_id=args.user_id,
            token_hash=token_hash,
            label=args.label,
            active_share_limit=active_share_limit,
            created_at=now,
            updated_at=now,
        )
        session.add(user_token)
        session.commit()

    print("Cloud token created.")
    print(f"User: {args.user_id}")
    print(f"Label: {args.label or ''}")
    print(f"Limit: {active_share_limit} active shares")
    print(f"Token: {token}")
    print("Store this token now. It will not be shown again.")


if __name__ == "__main__":
    main()
