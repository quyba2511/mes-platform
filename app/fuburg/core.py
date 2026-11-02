"""Lõi action của MES app – cùng triết lý với intf.api của 中介庫:
  * Một cửa duy nhất:  api(action, body) -> dict
  * Lỗi = MesError(code)  (giống THROW 51000 '<CODE>')
  * Mỗi lần gọi = 1 giao dịch DB; lỗi thì rollback toàn bộ
  * Idempotency: body có `request_id` → gửi lại y nguyên trả kết quả cũ + duplicate:true;
    cùng request_id khác nội dung → REQUEST_CONFLICT
  * Action ghi mới ghi audit; action chỉ đọc (readonly=True) không ghi audit
"""
from __future__ import annotations

import hashlib
import json
from contextvars import ContextVar
from .storage import Database
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable



class MesError(Exception):
    def __init__(self, code: str, detail: str | None = None):
        super().__init__(code if detail is None else f"{code}: {detail}")
        self.code = code
        self.detail = detail


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    """UUID cho mọi định danh gửi intf (completion_id, pp_txn_id, command_id …). Chữ hoa giống SQL Server."""
    return str(uuid.uuid4()).upper()


def canon(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------- cấu hình nhà máy
_CONFIG = ContextVar("fuburg_config")


def plant_cfg(plant: str) -> dict:
    current = _CONFIG.get(None)
    if current is None or current[0] != plant:
        raise MesError("MODULE_NOT_CONFIGURED", plant)
    return current[1]


def one(conn, sql, *args):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def rows(conn, sql, *args):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


# ---------------------------------------------------------------- registry
@dataclass
class ActionDef:
    name: str
    fn: Callable
    roles: tuple[str, ...]
    readonly: bool
    required: tuple[str, ...]
    doc: str


ACTIONS: dict[str, ActionDef] = {}


def action(name: str, *, roles=("MES",), readonly=False, required=()):
    def deco(fn):
        ACTIONS[name] = ActionDef(name, fn, tuple(roles), readonly, ("plant",) + tuple(required), (fn.__doc__ or "").strip())
        return fn
    return deco


@dataclass
class Ctx:
    conn: Database
    role: str
    user: str
    plant: str

    def enqueue(self, intf_action: str, body: dict, ref_kind: str, ref_id: str, depends_on: str | None = None) -> str:
        """Ghi 1 message vào outbox (cùng giao dịch với dữ liệu MES). Body bị đóng băng – worker gửi lại y nguyên."""
        msg_id = new_id()
        self.conn.execute(
            "INSERT INTO outbox(msg_id,plant,intf_action,body,depends_on,ref_kind,ref_id,state,created_at) VALUES(?,?,?,?,?,?,?,'NEW',?)",
            (msg_id, self.plant, intf_action, canon(body), depends_on, ref_kind, ref_id, now()))
        return msg_id

    def track_txn(self, txn_id: str, txn_type: str, ref_kind: str, ref_id: str):
        self.conn.execute("INSERT INTO txn_ref(txn_id,plant,txn_type,ref_kind,ref_id,sap_state,updated_at) VALUES(?,?,?,?,?,'PENDING',?)",
                          (txn_id, self.plant, txn_type, ref_kind, ref_id, now()))

    def msg_for(self, ref_kind: str, ref_id: str) -> str | None:
        r = one(self.conn, "SELECT msg_id FROM outbox WHERE ref_kind=? AND ref_id=? ORDER BY seq DESC LIMIT 1", ref_kind, ref_id)
        return r["msg_id"] if r else None


def api(conn: Database, action_name: str, body: dict, *, role="MES", user="system") -> dict:
    """One local transaction for validation, domain writes, audit and frozen outbox."""
    if not isinstance(body, dict):
        raise MesError("INVALID_REQUEST")
    a = ACTIONS.get(action_name)
    if a is None:
        raise MesError("UNKNOWN_ACTION", action_name)
    if role not in a.roles and role != "ADMIN" and not (role == "VIEWER" and a.readonly):
        raise MesError("ROLE_NOT_ALLOWED")
    missing = [k for k in a.required if body.get(k) in (None, "", [])]
    if missing:
        raise MesError("FIELD_REQUIRED", ",".join(missing))
    plant = str(body["plant"])
    # Same plant mutex is used by the worker and every write. PostgreSQL row locks;
    # SQLite serializes writes. Different PostgreSQL plants remain independent.
    with conn.transaction(plant, write=not a.readonly):
        cfg = one(conn, "SELECT settings FROM fb_config WHERE plant=?", plant)
        if not cfg:
            raise MesError("MODULE_NOT_CONFIGURED", plant)
        token = _CONFIG.set((plant, json.loads(cfg["settings"])))
        try:
            if a.readonly:
                return a.fn(Ctx(conn, role, user, plant), body)
            rid = body.get("request_id")
            h = hashlib.sha256(canon({"action": action_name, "user": user, "body": body}).encode()).hexdigest()
            # Scope retry keys to actor and plant; IDs never disclose another user's response.
            scoped = hashlib.sha256(canon([plant, user, rid]).encode()).hexdigest() if rid else None
            if scoped:
                old = one(conn, "SELECT action, body_hash, response FROM mes_request WHERE request_id=?", scoped)
                if old:
                    if old["action"] != action_name or old["body_hash"] != h:
                        raise MesError("REQUEST_CONFLICT")
                    return dict(json.loads(old["response"]), duplicate=True)
            validate_body(body)
            res = a.fn(Ctx(conn, role, user, plant), body) or {}
            if scoped:
                conn.execute("INSERT INTO mes_request VALUES(?,?,?,?,?)", (scoped, action_name, h, canon(res), now()))
            conn.execute("INSERT INTO mes_audit(action,actor,plant,request_id,body,result,at) VALUES(?,?,?,?,?,?,?)",
                         (action_name, user, plant, scoped, canon(body), canon(res), now()))
            return res
        except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
            raise MesError("INVALID_REQUEST", "Check field types and numeric values") from exc
        finally:
            _CONFIG.reset(token)


# ---------------------------------------------------------------- tiện ích nghiệp vụ dùng chung
SHIFTS = ("A", "B", "C")


def need_shift(v):
    if v not in SHIFTS:
        raise MesError("INVALID_SHIFT", str(v))


def int_str(v, code="PIECE_INTEGER_REQUIRED", allow_zero=True) -> int:
    s = str(v)
    if not s.isdigit():
        raise MesError(code, s)
    n = int(s)
    if n == 0 and not allow_zero:
        raise MesError(code, s)
    return n


def qty3(v, code="QUANTITY_INVALID"):
    """Số lượng tối đa 3 số lẻ, > 0. Trả Decimal."""
    from decimal import Decimal, InvalidOperation
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        raise MesError(code, str(v))
    if not d.is_finite() or d <= 0 or d != d.quantize(Decimal("0.001")):
        raise MesError(code, str(v))
    return d


def get_open_order(conn, plant, order_no) -> dict:
    o = one(conn, "SELECT * FROM work_order WHERE plant=? AND order_no=?", plant, order_no)
    if not o:
        raise MesError("ORDER_NOT_FOUND", order_no)
    if not o["released"] or o["closed"] or o["deleted"]:
        raise MesError("ORDER_NOT_OPEN", order_no)
    return o


def pieces_per(conn, plant: str, order: dict, uom: str) -> int:
    """Số EA cho 1 đơn vị `uom` của thành phẩm lệnh.
    Đơn vị lệnh → order_uom_rate (AFPO, v10). Đơn vị khác → MARM (material_uom). Phải là số nguyên > 1."""
    if uom == "EA":
        return 1
    if uom == order["order_uom"] and order["order_uom_num"]:
        n, d = order["order_uom_num"], order["order_uom_den"]
    else:
        r = (next((rate for rate in order["material_rates"] if rate["uom"] == uom), None)
             if "material_rates" in order else one(conn, "SELECT numerator, denominator FROM material_uom WHERE plant=? AND material=? AND uom=?", plant, order["material"], uom))
        if not r:
            raise MesError("PACKAGE_RATE_OR_VERSION", f"không có quy đổi {uom}")
        n, d = r["numerator"], r["denominator"]
    if not n or not d or d <= 0 or n <= d or n % d:
        raise MesError("PACKAGE_RATE_OR_VERSION", f"{uom}={n}/{d}")
    return n // d


def check_sloc_not_asrs(plant: str, sloc: str, allowed: list[str] | None = None):
    if sloc.startswith("2") and sloc not in (allowed or []):
        raise MesError("ASRS_MANAGED_SLOC", sloc)


def validate_body(body):
    """Reject malformed field values before any business mutation."""
    from datetime import date
    for key in ('production_date', 'posting_date'):
        if key in body:
            date.fromisoformat(body[key])
    for key in ('started_at', 'finished_at'):
        if key in body:
            timestamp = datetime.fromisoformat(body[key])
            if timestamp.tzinfo is None:
                raise MesError('TIMESTAMP_TIMEZONE_REQUIRED')
    for key in ('line','order_no','storage_location','material','evidence_ref','approval_ref','lot_no'):
        if key in body and (not isinstance(body[key], str) or not body[key].strip() or len(body[key]) > 160):
            raise MesError('INVALID_REQUEST', key)
    for labor in body.get('labor') or []:
        int_str(labor['headcount'], allow_zero=False)
        int_str(labor['labor_minutes'])
    if 'run_ids' in body and (not isinstance(body['run_ids'], list) or not 1 <= len(body['run_ids']) <= 200):
        raise MesError('INVALID_REQUEST', 'run_ids')
