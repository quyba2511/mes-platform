"""Client gọi 中介庫  EXEC intf.api @action, @body  (account fuburg_intf_<uat|prd>_mes).
Mật khẩu KHÔNG ghi vào code/file: đọc từ biến môi trường INTF_PASSWORD (hoặc secret store)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ERR = {e["code"]: e for e in json.loads((Path(__file__).with_name("error_codes.json")).read_text(encoding="utf-8"))}

# Lỗi tạm thời ngoài danh sách 51000 (mất kết nối, deadlock…) → gửi lại NGUYÊN body
TRANSIENT_SQL = (1205, 1222, -2, 233, 10054, 10060, 40613)


class IntfError(Exception):
    """code = mã lỗi intf (THROW 51000) hoặc 'TRANSPORT'. category theo error_codes.json:
    RETRY → gửi lại y nguyên sau; DATA/STATE/PERMISSION/CONFLICT/MANUAL → dừng, cần người xử lý."""

    def __init__(self, code: str, raw: str = ""):
        super().__init__(f"{code} {raw}".strip())
        self.code = code
        self.raw = raw
        e = ERR.get(code)
        self.category = "RETRY" if code == "TRANSPORT" else (e["category"] if e else "UNKNOWN")
        self.meaning = e["meaning"] if e else ""

    @property
    def retryable(self) -> bool:
        # *_UPDATE_PENDING: intf còn event ORDER/MASTER chưa ack → worker pull+ack trước, rồi gửi lại nguyên body là qua
        return self.category == "RETRY" or self.code in AUTO_RETRY_STATE


AUTO_RETRY_STATE = {"ORDER_UPDATE_PENDING", "MATERIAL_UPDATE_PENDING"}


def parse_51000(msg: str) -> str | None:
    m = re.search(r"\b([A-Z][A-Z0-9_]{3,})\b", msg.split("DB-Lib")[0])
    return m.group(1) if m else None


class SqlServerIntf:
    """Transport thật (pymssql). Kết nối qua SSH tunnel tới 127.0.0.1:14330 ở UAT."""

    def __init__(self, host=None, port=None, database=None, user=None, password=None):
        import pymssql  # pip install pymssql
        self._pymssql = pymssql
        self.args = dict(server=host or os.environ.get("INTF_HOST", "127.0.0.1"), port=int(port or os.environ.get("INTF_PORT", "14330")),
                         database=database or os.environ["INTF_DB"], user=user or os.environ["INTF_USER"],
                         password=password or os.environ["INTF_PASSWORD"], autocommit=True, login_timeout=10, timeout=30, charset="UTF-8")
        self.conn = None

    def _c(self):
        if self.conn is None:
            self.conn = self._pymssql.connect(**self.args)
        return self.conn

    def call(self, action: str, body: dict) -> dict:
        try:
            cur = self._c().cursor()
            cur.execute("EXEC intf.api @action=%s, @body=%s", (action, json.dumps(body, ensure_ascii=False)))
            row = cur.fetchone()
            while cur.nextset():
                pass
            return json.loads(row[0]) if row and row[0] else {}
        except self._pymssql.DatabaseError as ex:
            num = ex.args[0] if ex.args and isinstance(ex.args[0], int) else None
            raw = ex.args[1] if len(ex.args) > 1 else str(ex)
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", "replace")
            if num == 51000:
                raise IntfError(parse_51000(raw) or "UNKNOWN", raw)
            self.conn = None
            if num in TRANSIENT_SQL or num is None:
                raise IntfError("TRANSPORT", raw)
            raise IntfError(f"SQL_{num}", raw)
        except (self._pymssql.InterfaceError, OSError) as ex:
            self.conn = None
            raise IntfError("TRANSPORT", str(ex))
