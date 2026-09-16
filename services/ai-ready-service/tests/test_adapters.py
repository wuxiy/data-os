"""RustFSAdapter 契约（G20）：双落对拍、最新版本探测、空产物口径。"""
import io
import types

from botocore.exceptions import ClientError

from adapters import RustFSAdapter


class StubS3:
    """最小 S3 客户端：objects 键值即对象体；head/get 未命中抛 ClientError。"""

    def __init__(self, objects: dict[str, bytes]):
        self._objects = objects
        self.exceptions = types.SimpleNamespace(ClientError=ClientError)

    def head_object(self, Bucket: str, Key: str):
        if Key not in self._objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")

    def get_object(self, Bucket: str, Key: str):
        if Key not in self._objects:
            raise ClientError({"Error": {"Code": "404"}}, "GetObject")
        return {"Body": io.BytesIO(self._objects[Key])}


class StubDorisQuery:
    def __init__(self, count: int):
        self._count = count

    def query(self, sql: str, args: tuple):
        assert sql.startswith("SELECT COUNT(*) FROM dataos_ai.chunks_ep")
        return [(self._count,)]


CHECK = {"requires_table": "dataos_ai.chunks_ep", "bucket": "b", "prefix": "p/x"}


def _adapter(objects: dict[str, bytes], count: int) -> RustFSAdapter:
    return RustFSAdapter(None, StubDorisQuery(count), client_factory=lambda: StubS3(objects))


def _jsonl(n: int) -> bytes:
    return ("\n".join(f'{{"chunk_id": "c{i}"}}' for i in range(n)) + "\n").encode("utf-8")


def test_row_counts_match_yields_one():
    objects = {"p/x/v1.0.0/manifest.yaml": b"", "p/x/v1.0.0/data/chunks.jsonl": _jsonl(3)}
    assert _adapter(objects, 3).artifact_availability(CHECK) == 1.0


def test_row_count_mismatch_yields_zero():
    objects = {"p/x/v1.0.0/manifest.yaml": b"", "p/x/v1.0.0/data/chunks.jsonl": _jsonl(4)}
    assert _adapter(objects, 3).artifact_availability(CHECK) == 0.0


def test_latest_version_is_picked_not_first():
    # 对拍目标 = 探测链的最后一个在册版本（next_version 同口径按 patch 位递增：
    # v1.0.0 -> v1.0.1 -> ...）；v1.0.0 是陈旧版本
    objects = {"p/x/v1.0.0/manifest.yaml": b"", "p/x/v1.0.0/data/chunks.jsonl": _jsonl(10),
               "p/x/v1.0.1/manifest.yaml": b"", "p/x/v1.0.1/data/chunks.jsonl": _jsonl(7)}
    assert _adapter(objects, 7).artifact_availability(CHECK) == 1.0


def test_no_object_version_yields_zero():
    # Doris 在册但对象面无任何版本：双落缺面
    assert _adapter({}, 3).artifact_availability(CHECK) == 0.0


def test_empty_artifact_table_yields_zero():
    # 空产物是真缺陷（对齐 G17 空表判缺口径），即使对象面同为空也不给满分
    objects = {"p/x/v1.0.0/manifest.yaml": b"", "p/x/v1.0.0/data/chunks.jsonl": _jsonl(0)}
    assert _adapter(objects, 0).artifact_availability(CHECK) == 0.0
