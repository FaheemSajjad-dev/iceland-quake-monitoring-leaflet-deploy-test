"""Safely synchronize MPGV source revisions and rebuild the derived catalogue.

Dry-run is the default. It runs the complete cleanup against a temporary copy
of the selected SQLite database. --apply requires a new backup path and updates
source-current metadata plus the merged catalogue in one data transaction.
Historical MPGV snapshots and all IMO raw rows are preserved.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile


EVENT_START = "2026-07-27 00:36:14"
EVENT_END = "2026-07-27 00:36:20"
RECONCILE_START = "2020-06-01 00:00:00"


def sqlite_backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db)


def read_snapshot(database: Path) -> dict:
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        counts = {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("earthquake", "earthquake_s_raw", "earthquake_merged")
        }
        exact = {}
        for table in ("earthquake", "earthquake_s_raw", "earthquake_merged"):
            exact[table] = [
                dict(row)
                for row in conn.execute(
                    f"SELECT * FROM {table} "
                    "WHERE date_time BETWEEN ? AND ? ORDER BY id",
                    (EVENT_START, EVENT_END),
                )
            ]
        mixed = conn.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT date_time
                FROM earthquake_merged
                GROUP BY date_time
                HAVING SUM(status = 'matched') > 0
                   AND SUM(status = 'v_only') > 0
            )
            """
        ).fetchone()[0]
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(earthquake)")
        }
        current_count = None
        if {"source_id", "is_current"}.issubset(columns):
            current_count = conn.execute(
                "SELECT COUNT(*) FROM earthquake WHERE is_current = 1"
            ).fetchone()[0]
        return {
            "tables": sorted(tables),
            "counts": counts,
            "current_mpgv": current_count,
            "mixed_status_duplicate_seconds": mixed,
            "event": exact,
        }


def execute_cleanup(database: Path) -> dict:
    os.environ["DISABLE_SCHEDULER"] = "1"
    os.environ["MPGV_DATABASE_PATH"] = str(database)

    from app import Earthquake, EarthquakeMerged, EarthquakeSRaw, app, db
    from reconcile import match_and_merge
    from scrape import fetch_authoritative_catalogue, sync_authoritative_rows

    try:
        authoritative = fetch_authoritative_catalogue()
        end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        with app.app_context():
            try:
                source_summary = sync_authoritative_rows(
                    authoritative,
                    commit=False,
                )
                reconcile_summary = match_and_merge(
                    RECONCILE_START,
                    end,
                    min_mag=3.0,
                    commit=False,
                )

                current_ids = [
                    source_id
                    for (source_id,) in db.session.query(Earthquake.source_id)
                    .filter(Earthquake.is_current.is_(True))
                    .all()
                ]
                merged_ids = [
                    source_id
                    for (source_id,) in db.session.query(EarthquakeMerged.v_src_key)
                    .all()
                ]
                if len(current_ids) != len(set(current_ids)):
                    raise ValueError("Current MPGV source identities are not unique")
                if None in merged_ids or len(merged_ids) != len(set(merged_ids)):
                    raise ValueError("Merged MPGV source identities are not unique")
                if EarthquakeSRaw.query.count() < 1:
                    raise ValueError("IMO raw source table unexpectedly empty")

                db.session.commit()
            except Exception:
                db.session.rollback()
                raise

        return {
            "source": source_summary,
            "reconcile": reconcile_summary,
            "authoritative_source_ids": len(authoritative),
        }
    finally:
        with app.app_context():
            db.session.remove()
            db.engine.dispose()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply to --database; default is a temporary-copy dry-run.",
    )
    parser.add_argument(
        "--backup",
        type=Path,
        help="Required non-existing backup path when --apply is used.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    database = args.database.resolve()
    if not database.is_file():
        raise SystemExit(f"Database not found: {database}")

    before = read_snapshot(database)
    temporary = None
    if args.apply:
        if args.backup is None:
            raise SystemExit("--backup is required with --apply")
        backup = args.backup.resolve()
        if backup.exists():
            raise SystemExit(f"Refusing to overwrite backup: {backup}")
        sqlite_backup(database, backup)
        working_database = database
    else:
        temporary = tempfile.TemporaryDirectory(
            prefix="mpgv-cleanup-",
            ignore_cleanup_errors=True,
        )
        working_database = Path(temporary.name) / database.name
        sqlite_backup(database, working_database)

    try:
        operation = execute_cleanup(working_database)
        after = read_snapshot(working_database)
        report = {
            "mode": "apply" if args.apply else "dry-run",
            "database": str(database),
            "backup": str(args.backup.resolve()) if args.apply else None,
            "before": before,
            "operation": operation,
            "after": after,
        }
        print(json.dumps(report, indent=2, sort_keys=True))
    finally:
        if temporary is not None:
            temporary.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
