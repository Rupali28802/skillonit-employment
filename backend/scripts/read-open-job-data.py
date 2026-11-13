import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.request import urlopen

import pyarrow as arrow
import pyarrow.parquet as parquet

REPO = "scholarweave/Jobs-Dataset-v2"
HUB = "https://huggingface.co"
BASE = f"{HUB}/datasets/{REPO}"


def emit(row):
    print(json.dumps(row, default=str, ensure_ascii=True), flush=True)


def get_json(url):
    with urlopen(url, timeout=60) as response:
        return json.load(response)


def rows(path, revision, checksum=None):
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "jobs.parquet"
        with urlopen(f"{BASE}/resolve/{revision}/{path}", timeout=120) as response, file.open("wb") as out:
            shutil.copyfileobj(response, out)
        if checksum:
            with file.open("rb") as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != checksum:
                    raise ValueError("OpenJobData checksum mismatch")
        yield from local_rows(file)


def local_rows(file, columns=None):
    for batch in parquet.ParquetFile(file).iter_batches(batch_size=500, columns=columns):
        columns = [
            column.cast(arrow.string()) if arrow.types.is_timestamp(column.type) else column
            for column in batch.columns
        ]
        yield from arrow.RecordBatch.from_arrays(columns, names=batch.schema.names).to_pylist()


def run_files(revision, kind, entry):
    date, run = entry["date"], entry["run_id"]
    if not re.fullmatch(r"\d{4}-\d\d-\d\d", date) or not re.fullmatch(r"[\w-]+", run):
        raise ValueError("Invalid dataset run identifier")
    folder = f"data/{kind}/minimal/date={date}/run_id={run}"
    files = get_json(f"{HUB}/api/datasets/{REPO}/tree/{revision}/{folder}")
    if not files or len(files) >= 1000:
        raise ValueError("Dataset run is missing files")
    for item in sorted(files, key=lambda item: item["path"]):
        if not re.fullmatch(re.escape(folder) + r"/part-\d+\.parquet", item["path"]):
            raise ValueError("Unexpected dataset run path")
        yield item["path"], item["lfs"]["oid"]


def open_job_data(cursor):
    revision = get_json(f"{HUB}/api/datasets/{REPO}")["sha"]
    manifest = get_json(f"{BASE}/raw/{revision}/data/manifests/current.json")
    latest = max(entry["run_id"] for entry in manifest["runs"])
    if latest <= cursor:
        return
    companies = {row["id"]: row["name"] for row in rows(manifest["companies"][-1], revision)}
    if not cursor:
        # The snapshot already includes the changes through the manifest run.
        for item in manifest["active"]["minimal"]["shards"].values():
            for row in rows(item["path"], revision, item["sha256"]):
                job_data_row(row, companies)
        emit({"checkpoint": latest})
        return
    if not any(entry["run_id"] == cursor for entry in manifest["runs"]):
        raise ValueError("Saved cursor is outside retained history. Reconcile the current snapshot before resuming.")
    events = {}
    for kind in ("changes", "closed"):
        for entry in manifest[kind]:
            if entry["run_id"] > cursor:
                events.setdefault(entry["run_id"], []).append((kind, entry))
    for run, entries in sorted(events.items()):
        # Apply closures last if the same lifecycle occurs in both files.
        for kind, entry in sorted(entries, key=lambda item: item[0]):
            for path, checksum in run_files(revision, kind, entry):
                for row in rows(path, revision, checksum):
                    if kind == "closed":
                        emit({"closed": row["lifecycle_id"]})
                    else:
                        job_data_row(row, companies)
        emit({"checkpoint": run})
    if max(events, default=cursor) != latest:
        raise ValueError("Latest manifest run is missing changes and closures")


def job_data_row(row, companies):
    emit(dict(id=row["lifecycle_id"], title=row["title"],
              company=companies.get(row["company_id"]), url=row["apply_url"],
              country=row["location_country_code"] or row["country"],
              city=row["location_city"], state=row["location_region"],
              mode="Remote" if row["is_remote"] else row["workplace_type"],
              type=row["employment_type"], posted=row["posted_at"],
              seen=row["last_seen_at"]))


def github_open_jobs(folder):
    files = sorted(folder.glob("*.parquet"))
    if not files or len(files) >= 1000:
        raise ValueError("Supply the extracted Open Jobs job Parquet files")
    for file in files:
        columns = ["ats", "slug", "id", "title", "url", "org", "location", "published_at", "last_seen_at", "is_open"]
        for row in local_rows(file, columns):
            if row.get("is_open") is False:
                continue
            org = row.get("org")
            company = org if isinstance(org, str) else None
            emit(dict(id=f'{row["ats"]}/{row["slug"]}#{row["id"]}', title=row["title"],
                      company=company or row["slug"], url=row["url"],
                      city=row.get("location"), posted=row.get("published_at"),
                      seen=row.get("last_seen_at")))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", choices=["openjobdata", "open-jobs"])
    parser.add_argument("--cursor", default="")
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    if args.source == "openjobdata":
        open_job_data(args.cursor)
    elif args.snapshot:
        github_open_jobs(args.snapshot)
    else:
        parser.error("open-jobs requires --snapshot")
